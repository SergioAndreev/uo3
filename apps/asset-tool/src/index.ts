import { pathToFileURL } from "node:url";
import { AssetToolEnvSchema, loadServerConfig } from "@uo3/config/env/server";
import { ConfigError, redactConfig } from "@uo3/config/env/shared";
import { PACKAGE_ID as CONTENT_ID } from "@uo3/content";
import { PACKAGE_ID as DOMAIN_ID } from "@uo3/domain";
import { PACKAGE_ID as UO_FORMATS_ID } from "@uo3/uo-formats";

export const ASSET_TOOL_VERSION = "0.0.1" as const;

export interface CliIo {
  readonly stdout: (msg: string) => void;
  readonly stderr: (msg: string) => void;
}

export function runAssetToolCli(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
  io?: CliIo,
  loadDotEnv = true,
): number {
  const writeOut = io ? io.stdout : (m: string) => process.stdout.write(`${m}\n`);
  const writeErr = io ? io.stderr : (m: string) => process.stderr.write(`${m}\n`);
  const command = argv[0] ?? "--version";

  if (command === "--version" || command === "-v") {
    writeOut(
      `@uo3/asset-tool v${ASSET_TOOL_VERSION} (${[DOMAIN_ID, UO_FORMATS_ID, CONTENT_ID].join(", ")})`,
    );
    return 0;
  }

  if (command === "check-env") {
    try {
      const cfg = loadServerConfig(AssetToolEnvSchema, {
        appName: "asset-tool",
        env,
        loadDotEnv,
      });
      writeOut(
        JSON.stringify({
          status: "ok",
          config: redactConfig(AssetToolEnvSchema, cfg as Record<string, unknown>),
        }),
      );
      return 0;
    } catch (err) {
      if (err instanceof ConfigError) {
        writeErr(err.formatReport());
        return err.exitCode;
      }
      writeErr(String(err));
      return 1;
    }
  }

  writeErr(`Неизвестная команда "${command}". Доступны: --version, check-env.`);
  return 2;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const code = runAssetToolCli(process.argv.slice(2));
  process.exit(code);
}
