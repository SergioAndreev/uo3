import { pathToFileURL } from "node:url";
import { BotClientEnvSchema, loadServerConfig } from "@uo3/config/env/server";
import { ConfigError } from "@uo3/config/env/shared";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PROTOCOL_VERSION } from "@uo3/protocol";
import { PACKAGE_ID as RULES_ID } from "@uo3/rules";

export const BOT_CLIENT_VERSION = "0.0.1" as const;

export interface BotCliDeps {
  readonly stdout?: (msg: string) => void;
  readonly stderr?: (msg: string) => void;
  readonly fetchImpl?: typeof fetch;
  readonly loadDotEnv?: boolean;
}

export async function runBotClientCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  deps: BotCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout;
  const stderr = deps.stderr;
  const writeOut = (m: string) => (stdout ? stdout(m) : process.stdout.write(`${m}\n`));
  const writeErr = (m: string) => (stderr ? stderr(m) : process.stderr.write(`${m}\n`));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const command = argv[0] ?? "--version";

  if (command === "--version" || command === "-v") {
    writeOut(
      `@uo3/bot-client v${BOT_CLIENT_VERSION} (protocol=${PROTOCOL_VERSION}, deps=${DOMAIN_ID},${RULES_ID})`,
    );
    return 0;
  }

  if (command === "ping-health") {
    let config;
    try {
      config = loadServerConfig(BotClientEnvSchema, {
        appName: "bot-client",
        env,
        loadDotEnv: deps.loadDotEnv ?? true,
      });
    } catch (err) {
      if (err instanceof ConfigError) {
        writeErr(err.formatReport());
        return err.exitCode;
      }
      writeErr(String(err));
      return 1;
    }

    const url = new URL("/healthz", config.TARGET_API_URL).toString();
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        writeErr(`Health ping failed (${res.status}) at ${url}`);
        return 1;
      }
      writeOut(JSON.stringify({ status: "ok", url, httpStatus: res.status }));
      return 0;
    } catch (err) {
      writeErr(`Health ping error at ${url}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  writeErr(`Неизвестная команда "${command}". Доступны: --version, ping-health.`);
  return 2;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runBotClientCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    });
}
