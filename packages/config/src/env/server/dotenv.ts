import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseDotEnvContent(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (const rawLine of lines) {
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
    let value = withoutExport.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
      }
    } else {
      const commentIdx = value.search(/\s+#/);
      if (commentIdx >= 0) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    result[key] = value;
  }

  return result;
}

export function loadDotEnvFiles(
  nodeEnv: string,
  cwd: string = process.cwd(),
): Record<string, string> {
  if (nodeEnv === "production") {
    return {};
  }

  const candidateFiles = [".env", ".env.local", `.env.${nodeEnv}.local`];
  const merged: Record<string, string> = {};

  for (const filename of candidateFiles) {
    const fullPath = join(cwd, filename);
    if (!existsSync(fullPath)) {
      continue;
    }
    const content = readFileSync(fullPath, "utf8");
    Object.assign(merged, parseDotEnvContent(content));
  }

  return merged;
}
