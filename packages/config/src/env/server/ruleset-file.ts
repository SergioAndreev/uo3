import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ConfigError, ConfigErrorCode } from "../shared/errors.js";

export function loadRawShardRulesetFile(filePath: string): unknown {
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(trimmed, "utf8");
  } catch (err) {
    throw new ConfigError(
      [
        {
          key: "SHARD_RULESET_FILE",
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          message: `Не удалось прочитать файл правил шарда "${trimmed}": ${String(err)}`,
        },
      ],
      "game-server",
    );
  }

  try {
    return parseYaml(content) as unknown;
  } catch (err) {
    throw new ConfigError(
      [
        {
          key: "SHARD_RULESET_FILE",
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          message: `Ошибка синтаксиса YAML в файле правил шарда "${trimmed}": ${String(err)}`,
        },
      ],
      "game-server",
    );
  }
}
