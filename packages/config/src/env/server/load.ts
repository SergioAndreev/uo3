import type { Static, TSchema } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
  ConfigError,
  ConfigErrorCode,
  deepFreeze,
  formatIssues,
  resolveFields,
  type ConfigIssue,
  type EnvSchema,
  type RawEnv,
} from '../shared/index.js';
import { loadDotEnvFiles } from './dotenv.js';
import { checkProductionInvariants } from './prod-guards.js';
import { resolveSecretFiles } from './secret-files.js';

export interface LoadOptions {
  env?: RawEnv;
  cwd?: string;
}

/** Код `EX_CONFIG` из sysexits. */
export const CONFIG_EXIT_CODE = 78;

const check = (schema: TSchema, value: unknown): boolean =>
  TypeCompiler.Compile(schema).Check(value);

export function loadServerConfig<T extends EnvSchema>(
  schema: T,
  { env = process.env, cwd = process.cwd() }: LoadOptions = {},
): Readonly<Static<T>> {
  const dotEnv = loadDotEnvFiles(cwd, env['NODE_ENV'] || 'development');
  const secrets = resolveSecretFiles(schema, env, dotEnv);
  // NODE_ENV определяет, читать ли файлы, поэтому сам из файлов не берётся.
  const values = { ...secrets.values, NODE_ENV: env['NODE_ENV'] };
  const resolved = resolveFields(schema, values, check);
  const failed = new Set(secrets.issues.map((issue) => issue.key));
  const issues: ConfigIssue[] = [
    ...secrets.issues,
    ...resolved.issues.filter((issue) => !failed.has(issue.key)),
    ...checkProductionInvariants(schema, resolved.config),
  ];
  if (issues.length > 0) throw new ConfigError(issues);
  return deepFreeze(resolved.config) as Readonly<Static<T>>;
}

/** Загружает конфигурацию или завершает процесс с кодом 78. */
export function loadServerConfigOrExit<T extends EnvSchema>(
  schema: T,
  options: LoadOptions = {},
): Readonly<Static<T>> {
  try {
    return loadServerConfig(schema, options);
  } catch (error) {
    const report =
      error instanceof ConfigError
        ? error.message
        : formatIssues([
            {
              code: ConfigErrorCode.VALIDATION_FAILED,
              key: '*',
              message: 'не удалось прочитать источники конфигурации',
            },
          ]);
    process.stderr.write(`${report}\n`);
    process.exit(CONFIG_EXIT_CODE);
  }
}
