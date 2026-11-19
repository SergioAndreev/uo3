import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AdminEnvSchema, ClientEnvSchema, loadClientConfig } from "@uo3/config/env/client";
import {
  ApiEnvSchema,
  AssetToolEnvSchema,
  BotClientEnvSchema,
  GameServerEnvSchema,
  loadServerConfig,
  parseDotEnvContent,
  RootInfraEnvSchema,
} from "@uo3/config/env/server";
import { checkDockerDaemon } from "./bootstrap.js";
import { checkNodeVersion } from "./check-node-version.js";

export interface DoctorCheckResult {
  readonly name: string;
  readonly status: "PASS" | "FAIL";
  readonly details: string;
  readonly hint?: string;
}

export function probeTcp(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export function probeValkeyPing(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    let buffer = "";
    const done = (ok: boolean) => {
      socket.destroy();
      resolvePromise(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("error", () => done(false));
    socket.once("connect", () => {
      socket.write("*1\r\n$4\r\nPING\r\n");
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes("+PONG")) {
        done(true);
      }
    });
  });
}

export async function probeNatsHealth(host: string, monitorPort: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await fetch(`http://${host}:${monitorPort}/jsz`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function checkPnpm9(): DoctorCheckResult {
  const res = spawnSync("pnpm", ["-v"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 5_000,
  });
  const ver = res.stdout.trim();
  if (res.status === 0 && ver.startsWith("9.")) {
    return { name: "pnpm", status: "PASS", details: `pnpm v${ver}` };
  }
  return {
    name: "pnpm",
    status: "FAIL",
    details: `Обнаружен pnpm "${ver || "none"}", требуется 9.x`,
    hint: "Выполните `corepack enable && corepack prepare pnpm@9.15.9 --activate`.",
  };
}

function checkEnvFiles(rootDir: string): DoctorCheckResult {
  const targets = [
    { id: "root", path: ".env", kind: "server" as const, schema: RootInfraEnvSchema },
    { id: "apps/api", path: "apps/api/.env", kind: "server" as const, schema: ApiEnvSchema },
    {
      id: "apps/game-server",
      path: "apps/game-server/.env",
      kind: "server" as const,
      schema: GameServerEnvSchema,
    },
    {
      id: "apps/client",
      path: "apps/client/.env",
      kind: "client" as const,
      schema: ClientEnvSchema,
    },
    { id: "apps/admin", path: "apps/admin/.env", kind: "client" as const, schema: AdminEnvSchema },
    {
      id: "apps/asset-tool",
      path: "apps/asset-tool/.env",
      kind: "server" as const,
      schema: AssetToolEnvSchema,
    },
    {
      id: "apps/bot-client",
      path: "apps/bot-client/.env",
      kind: "server" as const,
      schema: BotClientEnvSchema,
    },
  ];

  const errors: string[] = [];
  for (const t of targets) {
    const full = join(rootDir, t.path);
    if (!existsSync(full)) {
      errors.push(`${t.path} отсутствует`);
      continue;
    }
    const parsed = parseDotEnvContent(readFileSync(full, "utf8"));
    try {
      if (t.kind === "client") {
        loadClientConfig(t.schema, parsed, t.id);
      } else {
        loadServerConfig(t.schema, { env: parsed, loadDotEnv: false, appName: t.id });
      }
    } catch (err) {
      errors.push(`${t.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    return {
      name: "env-files",
      status: "FAIL",
      details: errors.join("; "),
      hint: "Выполните `pnpm bootstrap` для генерации отсутствующих .env из .env.example.",
    };
  }

  return {
    name: "env-files",
    status: "PASS",
    details: "Все 7 .env файлов валидны по схемам @uo3/config.",
  };
}

export interface DoctorProbes {
  readonly checkNode?: () => { readonly ok: boolean; readonly message: string };
  readonly checkPnpm?: () => DoctorCheckResult;
  readonly checkDocker?: () => { readonly ok: boolean; readonly message: string };
  readonly checkEnv?: (rootDir: string) => DoctorCheckResult;
  readonly probePostgres?: (host: string, port: number) => Promise<boolean>;
  readonly probeValkey?: (host: string, port: number) => Promise<boolean>;
  readonly probeNats?: (host: string, monitorPort: number) => Promise<boolean>;
}

export async function runDoctor(
  rootDir: string,
  env: Record<string, string | undefined> = process.env,
  probes: DoctorProbes = {},
): Promise<{ readonly ok: boolean; readonly results: readonly DoctorCheckResult[] }> {
  const rootEnvPath = join(rootDir, ".env");
  const dotEnv = existsSync(rootEnvPath)
    ? parseDotEnvContent(readFileSync(rootEnvPath, "utf8"))
    : {};
  const merged = { ...dotEnv, ...env };

  const pgPort = Number.parseInt(merged["PG_PORT"] ?? "5432", 10);
  const valkeyPort = Number.parseInt(merged["VALKEY_PORT"] ?? "6379", 10);
  const natsMonitorPort = Number.parseInt(merged["NATS_MONITOR_PORT"] ?? "8222", 10);

  const results: DoctorCheckResult[] = [];

  const nodeRes = (probes.checkNode ?? (() => checkNodeVersion()))();
  results.push({
    name: "node",
    status: nodeRes.ok ? "PASS" : "FAIL",
    details: nodeRes.message,
    ...(!nodeRes.ok ? { hint: "Установите Node.js 22 LTS (см. .nvmrc)." } : {}),
  });

  results.push((probes.checkPnpm ?? checkPnpm9)());

  const dockerRes = (probes.checkDocker ?? (() => checkDockerDaemon(5_000)))();
  results.push({
    name: "docker",
    status: dockerRes.ok ? "PASS" : "FAIL",
    details: dockerRes.message,
    ...(!dockerRes.ok ? { hint: "Запустите Docker Desktop / Docker Engine." } : {}),
  });

  results.push((probes.checkEnv ?? checkEnvFiles)(rootDir));

  const pgOk = await (probes.probePostgres ?? probeTcp)("127.0.0.1", pgPort);
  results.push({
    name: "postgres",
    status: pgOk ? "PASS" : "FAIL",
    details: pgOk
      ? `PostgreSQL 17 доступен на 127.0.0.1:${pgPort}`
      : `PostgreSQL недоступен на 127.0.0.1:${pgPort}`,
    ...(!pgOk ? { hint: "Запустите `docker compose --profile core up -d postgres`." } : {}),
  });

  const valkeyOk = await (probes.probeValkey ?? probeValkeyPing)("127.0.0.1", valkeyPort);
  results.push({
    name: "valkey",
    status: valkeyOk ? "PASS" : "FAIL",
    details: valkeyOk
      ? `Valkey 8 отвечает PONG на 127.0.0.1:${valkeyPort}`
      : `Valkey недоступен на 127.0.0.1:${valkeyPort}`,
    ...(!valkeyOk ? { hint: "Запустите `docker compose --profile core up -d valkey`." } : {}),
  });

  const natsOk = await (probes.probeNats ?? probeNatsHealth)("127.0.0.1", natsMonitorPort);
  results.push({
    name: "nats",
    status: natsOk ? "PASS" : "FAIL",
    details: natsOk
      ? `NATS JetStream отвечает 200 на 127.0.0.1:${natsMonitorPort}/jsz`
      : `NATS JetStream недоступен на 127.0.0.1:${natsMonitorPort}/jsz`,
    ...(!natsOk ? { hint: "Запустите `docker compose --profile core up -d nats`." } : {}),
  });

  return {
    ok: results.every((r) => r.status === "PASS"),
    results,
  };
}

export function formatDoctorReport(results: readonly DoctorCheckResult[]): string {
  return results
    .map((r) => {
      const base = `[${r.status}] ${r.name}: ${r.details}`;
      return r.hint ? `${base}\n       → Исправление: ${r.hint}` : base;
    })
    .join("\n");
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  runDoctor(rootDir)
    .then(({ ok, results }) => {
      process.stdout.write(`${formatDoctorReport(results)}\n`);
      process.exit(ok ? 0 : 1);
    })
    .catch((err: unknown) => {
      process.stderr.write(`Doctor error: ${String(err)}\n`);
      process.exit(1);
    });
}
