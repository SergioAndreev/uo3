import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseDotEnvContent } from "@uo3/config/env/server";
import { checkNodeVersion } from "./check-node-version.js";

export const ENV_TEMPLATE_DIRS = [
  ".",
  "apps/api",
  "apps/game-server",
  "apps/client",
  "apps/admin",
  "apps/asset-tool",
  "apps/bot-client",
] as const;

export interface PortSpec {
  readonly envVar: string;
  readonly defaultPort: number;
  readonly service: string;
}

export const CORE_PORT_SPECS: readonly PortSpec[] = [
  { envVar: "PG_PORT", defaultPort: 5432, service: "postgres" },
  { envVar: "VALKEY_PORT", defaultPort: 6379, service: "valkey" },
  { envVar: "NATS_PORT", defaultPort: 4222, service: "nats" },
  { envVar: "NATS_MONITOR_PORT", defaultPort: 8222, service: "nats" },
];

export interface EnvCopyReport {
  readonly created: readonly string[];
  readonly preserved: readonly string[];
}

export function copyMissingEnvFiles(
  rootDir: string,
  dirs: readonly string[] = ENV_TEMPLATE_DIRS,
): EnvCopyReport {
  const created: string[] = [];
  const preserved: string[] = [];

  for (const relDir of dirs) {
    const examplePath = join(rootDir, relDir, ".env.example");
    const targetPath = join(rootDir, relDir, ".env");
    if (!existsSync(examplePath)) {
      continue;
    }
    const label = relDir === "." ? ".env" : `${relDir}/.env`;
    if (existsSync(targetPath)) {
      preserved.push(label);
    } else {
      copyFileSync(examplePath, targetPath);
      created.push(label);
    }
  }

  return { created, preserved };
}

export function checkDockerDaemon(timeoutMs = 8_000): {
  readonly ok: boolean;
  readonly message: string;
} {
  const res = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    encoding: "utf8",
    timeout: timeoutMs,
  });

  if (res.status === 0 && res.stdout.trim().length > 0) {
    return { ok: true, message: `Docker Engine ${res.stdout.trim()} доступен.` };
  }

  return {
    ok: false,
    message:
      "Docker daemon недоступен. Запустите Docker Desktop (или службу dockerd) и повторите команду `pnpm bootstrap`.",
  };
}

export function isPortFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => {
      resolvePromise(false);
    });
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, host);
  });
}

export async function checkPortConflicts(
  env: Record<string, string | undefined>,
  runningComposeServices: ReadonlySet<string> = new Set(),
  portCheck: (port: number) => Promise<boolean> = isPortFree,
): Promise<readonly string[]> {
  const conflicts: string[] = [];

  for (const spec of CORE_PORT_SPECS) {
    if (runningComposeServices.has(spec.service)) {
      continue;
    }
    const rawPort = env[spec.envVar];
    const port = rawPort ? Number.parseInt(rawPort, 10) : spec.defaultPort;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      conflicts.push(
        `Некорректный порт ${spec.envVar}="${rawPort ?? ""}" для сервиса ${spec.service}.`,
      );
      continue;
    }
    const free = await portCheck(port);
    if (!free) {
      conflicts.push(
        `Порт ${port} (${spec.service}) уже занят другим процессом. Освободите порт или переопределите переменную ${spec.envVar} (например, ${spec.envVar}=${port + 10000}).`,
      );
    }
  }

  return conflicts;
}

export function getRunningCoreServices(rootDir: string): Set<string> {
  const res = spawnSync(
    "docker",
    ["compose", "--profile", "core", "ps", "--status", "running", "--services"],
    { cwd: rootDir, encoding: "utf8", timeout: 8_000 },
  );
  if (res.status !== 0) {
    return new Set();
  }
  return new Set(
    res.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export interface BootstrapDeps {
  readonly rootDir: string;
  readonly env: Record<string, string | undefined>;
  readonly checkNode?: () => { readonly ok: boolean; readonly message: string };
  readonly checkDocker?: () => { readonly ok: boolean; readonly message: string };
  readonly checkPorts?: (
    mergedEnv: Record<string, string | undefined>,
    running: ReadonlySet<string>,
  ) => Promise<readonly string[]>;
  readonly getRunningServices?: (rootDir: string) => Set<string>;
  readonly runCommand?: (cmd: string, args: readonly string[], timeoutMs?: number) => number;
  readonly log?: (msg: string) => void;
  readonly errLog?: (msg: string) => void;
}

export async function runBootstrap(deps: BootstrapDeps): Promise<number> {
  const log = deps.log ?? ((m: string) => process.stdout.write(`${m}\n`));
  const errLog = deps.errLog ?? ((m: string) => process.stderr.write(`${m}\n`));

  const nodeRes = (deps.checkNode ?? (() => checkNodeVersion()))();
  if (!nodeRes.ok) {
    errLog(`FAIL [node]: ${nodeRes.message}`);
    return 1;
  }
  log(`PASS [node]: ${nodeRes.message}`);

  const dockerRes = (deps.checkDocker ?? (() => checkDockerDaemon(8_000)))();
  if (!dockerRes.ok) {
    errLog(`FAIL [docker]: ${dockerRes.message}`);
    return 1;
  }
  log(`PASS [docker]: ${dockerRes.message}`);

  const envReport = copyMissingEnvFiles(deps.rootDir);
  if (envReport.created.length > 0) {
    log(`Созданы .env из шаблонов: ${envReport.created.join(", ")}`);
  }
  if (envReport.preserved.length > 0) {
    log(`Сохранены существующие .env (без перезаписи): ${envReport.preserved.join(", ")}`);
  }

  const rootEnvPath = join(deps.rootDir, ".env");
  const rootDotEnv = existsSync(rootEnvPath)
    ? parseDotEnvContent(readFileSync(rootEnvPath, "utf8"))
    : {};
  const mergedEnv: Record<string, string | undefined> = { ...rootDotEnv, ...deps.env };

  const running = (deps.getRunningServices ?? getRunningCoreServices)(deps.rootDir);
  const conflicts = await (deps.checkPorts ?? checkPortConflicts)(mergedEnv, running);
  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      errLog(`FAIL [ports]: ${conflict}`);
    }
    return 1;
  }

  const execStep =
    deps.runCommand ??
    ((cmd: string, args: readonly string[], timeoutMs = 120_000) => {
      const res = spawnSync(cmd, args, {
        cwd: deps.rootDir,
        stdio: "inherit",
        shell: process.platform === "win32" && cmd === "pnpm",
        timeout: timeoutMs,
      });
      return res.status ?? 1;
    });

  log("Поднятие базового стека Docker Compose (--profile core)...");
  if (execStep("docker", ["compose", "--profile", "core", "up", "-d", "--wait"], 120_000) !== 0) {
    errLog("FAIL [docker-compose]: Не удалось поднять базовые контейнеры за 120 с.");
    return 1;
  }

  log("Применение миграций PostgreSQL (db:migrate)...");
  if (execStep("pnpm", ["db:migrate"], 60_000) !== 0) {
    errLog("FAIL [db:migrate]: Ошибка применения миграций.");
    return 1;
  }

  log("Идемпотентный seed метаданных (db:seed)...");
  if (execStep("pnpm", ["db:seed"], 60_000) !== 0) {
    errLog("FAIL [db:seed]: Ошибка выполнения seed.");
    return 1;
  }

  log("Финальная диагностика окружения (doctor)...");
  if (execStep("pnpm", ["run", "doctor"], 60_000) !== 0) {
    errLog("FAIL [doctor]: Диагностика окружения обнаружила проблемы.");
    return 1;
  }

  log("Bootstrap UO3 завершён успешно.");
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  runBootstrap({ rootDir, env: process.env })
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`Bootstrap fatal error: ${String(err)}\n`);
      process.exit(1);
    });
}
