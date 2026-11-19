import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDotEnvContent } from "@uo3/config/env/server";

export const ALLOWED_LOCAL_DB_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
]);

export function assertLocalDatabaseUrl(databaseUrl: string): {
  readonly ok: boolean;
  readonly hostname: string;
  readonly message: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return {
      ok: false,
      hostname: "",
      message: "Невалидный DATABASE_URL: невозможно проверить безопасность хоста.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOCAL_DB_HOSTS.has(host)) {
    return {
      ok: false,
      hostname: host,
      message: `БЛОКИРОВКА БЕЗОПАСНОСТИ: env:reset запрещён для нелокального хоста БД "${host}". Разрешены только: localhost, 127.0.0.1, ::1, postgres.`,
    };
  }

  return {
    ok: true,
    hostname: host,
    message: `Хост БД "${host}" подтверждён как локальный.`,
  };
}

export interface EnvResetDeps {
  readonly rootDir: string;
  readonly argv: readonly string[];
  readonly env: Record<string, string | undefined>;
  readonly runCommand?: (cmd: string, args: readonly string[]) => number;
  readonly log?: (msg: string) => void;
  readonly errLog?: (msg: string) => void;
}

export function runEnvReset(deps: EnvResetDeps): number {
  const log = deps.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const errLog = deps.errLog ?? ((m: string) => process.stderr.write(`${m}\n`));

  const rootEnvPath = join(deps.rootDir, ".env");
  const dotEnv = existsSync(rootEnvPath)
    ? parseDotEnvContent(readFileSync(rootEnvPath, "utf8"))
    : {};
  const mergedEnv = { ...dotEnv, ...deps.env };

  const dbUrl =
    mergedEnv["DATABASE_URL"] ?? "postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@localhost:5432/uo3_dev";
  const hostCheck = assertLocalDatabaseUrl(dbUrl);
  if (!hostCheck.ok) {
    errLog(hostCheck.message);
    return 1;
  }

  if (mergedEnv["TEST_DATABASE_URL"]) {
    const testHostCheck = assertLocalDatabaseUrl(mergedEnv["TEST_DATABASE_URL"]);
    if (!testHostCheck.ok) {
      errLog(testHostCheck.message);
      return 1;
    }
  }

  if (!deps.argv.includes("--yes")) {
    errLog(
      "Для сброса локального окружения требуется явное подтверждение флагом `--yes` (например: `pnpm env:reset --yes`).",
    );
    return 1;
  }

  const execStep =
    deps.runCommand ??
    ((cmd: string, args: readonly string[]) => {
      const res = spawnSync(cmd, args, {
        cwd: deps.rootDir,
        stdio: "inherit",
        shell: process.platform === "win32" && cmd === "pnpm",
      });
      return res.status ?? 1;
    });

  log(`Сброс локального стенда (хост БД: ${hostCheck.hostname})...`);
  if (execStep("docker", ["compose", "--profile", "core", "down", "-v"]) !== 0) {
    errLog("Не удалось остановить контейнеры и удалить тома Docker.");
    return 1;
  }
  if (execStep("docker", ["compose", "--profile", "core", "up", "-d", "--wait"]) !== 0) {
    errLog("Не удалось повторно поднять базовые контейнеры.");
    return 1;
  }
  if (execStep("pnpm", ["db:migrate"]) !== 0) {
    errLog("Ошибка повторного применения миграций.");
    return 1;
  }
  if (execStep("pnpm", ["db:seed"]) !== 0) {
    errLog("Ошибка повторного выполнения seed.");
    return 1;
  }

  log("Локальное окружение чисто пересоздано.");
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const code = runEnvReset({ rootDir, argv: process.argv.slice(2), env: process.env });
  process.exit(code);
}
