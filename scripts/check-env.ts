import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TObject, TProperties } from "@sinclair/typebox";
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
import { getSchemaProperties } from "@uo3/config/env/shared";

export interface EnvTargetSpec {
  readonly id: string;
  readonly envExamplePath: string;
  readonly kind: "server" | "client";
  readonly schema: TObject<TProperties>;
}

export interface EnvParityResult {
  readonly id: string;
  readonly envExamplePath: string;
  readonly ok: boolean;
  readonly missingInExample: readonly string[];
  readonly extraInExample: readonly string[];
  readonly duplicateKeys: readonly string[];
  readonly validationError?: string;
}

export const ENV_PARITY_REGISTRY: readonly EnvTargetSpec[] = [
  {
    id: "root",
    envExamplePath: ".env.example",
    kind: "server",
    schema: RootInfraEnvSchema as unknown as TObject<TProperties>,
  },
  {
    id: "apps/api",
    envExamplePath: "apps/api/.env.example",
    kind: "server",
    schema: ApiEnvSchema as unknown as TObject<TProperties>,
  },
  {
    id: "apps/game-server",
    envExamplePath: "apps/game-server/.env.example",
    kind: "server",
    schema: GameServerEnvSchema as unknown as TObject<TProperties>,
  },
  {
    id: "apps/client",
    envExamplePath: "apps/client/.env.example",
    kind: "client",
    schema: ClientEnvSchema as unknown as TObject<TProperties>,
  },
  {
    id: "apps/admin",
    envExamplePath: "apps/admin/.env.example",
    kind: "client",
    schema: AdminEnvSchema as unknown as TObject<TProperties>,
  },
  {
    id: "apps/asset-tool",
    envExamplePath: "apps/asset-tool/.env.example",
    kind: "server",
    schema: AssetToolEnvSchema as unknown as TObject<TProperties>,
  },
  {
    id: "apps/bot-client",
    envExamplePath: "apps/bot-client/.env.example",
    kind: "server",
    schema: BotClientEnvSchema as unknown as TObject<TProperties>,
  },
];

export function extractEnvExampleKeys(rawContent: string): {
  readonly keys: readonly string[];
  readonly duplicates: readonly string[];
} {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const keys: string[] = [];

  for (const rawLine of rawContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = withoutExport.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = withoutExport.slice(0, eqIndex).trim();
    if (seen.has(key)) {
      duplicates.add(key);
    } else {
      seen.add(key);
      keys.push(key);
    }
  }

  return { keys, duplicates: [...duplicates].sort() };
}

export function checkEnvTargetParity(rootDir: string, target: EnvTargetSpec): EnvParityResult {
  const fullPath = join(rootDir, target.envExamplePath);
  const schemaKeys = Object.keys(getSchemaProperties(target.schema)).sort();

  if (!existsSync(fullPath)) {
    return {
      id: target.id,
      envExamplePath: target.envExamplePath,
      ok: false,
      missingInExample: schemaKeys,
      extraInExample: [],
      duplicateKeys: [],
      validationError: `Файл ${target.envExamplePath} не найден.`,
    };
  }

  const rawContent = readFileSync(fullPath, "utf8");
  const { keys: exampleKeys, duplicates } = extractEnvExampleKeys(rawContent);
  const exampleSet = new Set(exampleKeys);
  const schemaSet = new Set(schemaKeys);

  const missingInExample = schemaKeys.filter((k) => !exampleSet.has(k));
  const extraInExample = exampleKeys.filter((k) => !schemaSet.has(k)).sort();

  let validationError: string | undefined;
  const parsedValues = parseDotEnvContent(rawContent);
  try {
    if (target.kind === "client") {
      loadClientConfig(target.schema, parsedValues, target.id);
    } else {
      loadServerConfig(target.schema, {
        env: parsedValues,
        loadDotEnv: false,
        appName: target.id,
      });
    }
  } catch (err) {
    validationError = err instanceof Error ? err.message : String(err);
  }

  const ok =
    missingInExample.length === 0 &&
    extraInExample.length === 0 &&
    duplicates.length === 0 &&
    validationError === undefined;

  return {
    id: target.id,
    envExamplePath: target.envExamplePath,
    ok,
    missingInExample,
    extraInExample,
    duplicateKeys: duplicates,
    ...(validationError !== undefined ? { validationError } : {}),
  };
}

export function checkAllEnvParity(
  rootDir: string,
  registry: readonly EnvTargetSpec[] = ENV_PARITY_REGISTRY,
): readonly EnvParityResult[] {
  return registry.map((target) => checkEnvTargetParity(rootDir, target));
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const results = checkAllEnvParity(rootDir);
  const failed = results.filter((r) => !r.ok);

  if (failed.length > 0) {
    process.stderr.write(`Найдены расхождения между схемами и .env.example (${failed.length}):\n`);
    for (const r of failed) {
      process.stderr.write(`  [${r.id}] ${r.envExamplePath}:\n`);
      if (r.missingInExample.length > 0) {
        process.stderr.write(
          `    - отсутствуют в .env.example: ${r.missingInExample.join(", ")}\n`,
        );
      }
      if (r.extraInExample.length > 0) {
        process.stderr.write(`    - лишние ключи в .env.example: ${r.extraInExample.join(", ")}\n`);
      }
      if (r.duplicateKeys.length > 0) {
        process.stderr.write(`    - дубликаты ключей: ${r.duplicateKeys.join(", ")}\n`);
      }
      if (r.validationError !== undefined) {
        process.stderr.write(`    - ошибка валидации: ${r.validationError}\n`);
      }
    }
    process.exit(1);
  }

  process.stdout.write(
    `Паритет всех ${results.length} шаблонов .env.example со схемами TypeBox подтверждён.\n`,
  );
}
