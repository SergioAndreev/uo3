import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { parse } from 'yaml';
import { ConfigError } from '../shared/index.js';

/**
 * Читает переопределение правил шарда. Проверку содержимого выполняет `@duskmarch/rules`:
 * зависимость `config → rules` запрещена матрицей границ.
 */
export function readRulesetOverride(file: string | undefined): unknown {
  if (file === undefined) return {};
  const fail = (message: string): never => {
    throw new ConfigError([
      { code: 'CONFIG_VALIDATION_FAILED', key: 'SHARD_RULESET_FILE', message },
    ]);
  };
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    fail(`файл ${file} не читается`);
  }
  const ext = extname(file).toLowerCase();
  try {
    if (ext === '.json') return JSON.parse(text) as unknown;
    if (ext === '.yaml' || ext === '.yml') return (parse(text) as unknown) ?? {};
  } catch (error) {
    fail(`${file}: ошибка разбора: ${(error as Error).message}`);
  }
  return fail(`${file}: ожидается .json, .yaml или .yml`);
}
