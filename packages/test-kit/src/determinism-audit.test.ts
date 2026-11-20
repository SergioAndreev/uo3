import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface DeterminismViolation {
  readonly file: string;
  readonly pattern: string;
}

const FORBIDDEN_PATTERNS: readonly { readonly name: string; readonly regex: RegExp }[] = [
  { name: "Date.now", regex: /\bDate\.now\s*\(/ },
  { name: "new Date()", regex: /\bnew\s+Date\s*\(/ },
  { name: "Math.random", regex: /\bMath\.random\s*\(/ },
  { name: "performance.now", regex: /\bperformance\.now\s*\(/ },
  { name: "process.env", regex: /\bprocess\.env\b/ },
  { name: "node:* import", regex: /["']node:[^"']+["']/ },
];

const WHITELISTED_RELATIVE_PATHS = new Set<string>(["packages/domain/src/runtime/system-clock.ts"]);

function collectTsFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      result.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      result.push(full);
    }
  }
  return result;
}

export function auditSourceForDeterminismViolations(
  relativePath: string,
  source: string,
): DeterminismViolation[] {
  const normalized = relativePath.replace(/\\/g, "/");
  if (WHITELISTED_RELATIVE_PATHS.has(normalized)) {
    return [];
  }

  const violations: DeterminismViolation[] = [];
  for (const { name, regex } of FORBIDDEN_PATTERNS) {
    if (regex.test(source)) {
      violations.push({ file: normalized, pattern: name });
    }
  }
  return violations;
}

describe("domain/deterministic-runtime — Static Purity & Determinism Audit (task 14.4)", () => {
  it("confirms zero forbidden non-deterministic APIs in packages/domain/src and packages/rules/src", () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const roots = [join(repoRoot, "packages/domain/src"), join(repoRoot, "packages/rules/src")];

    const violations: DeterminismViolation[] = [];
    for (const root of roots) {
      for (const file of collectTsFiles(root)) {
        const rel = relative(repoRoot, file).replace(/\\/g, "/");
        const content = readFileSync(file, "utf8");
        violations.push(...auditSourceForDeterminismViolations(rel, content));
      }
    }

    expect(violations).toEqual([]);
  });

  it("detects every forbidden pattern when injected into a non-whitelisted source", () => {
    expect(
      auditSourceForDeterminismViolations("packages/domain/src/bad.ts", "const x = Date.now();"),
    ).toEqual([{ file: "packages/domain/src/bad.ts", pattern: "Date.now" }]);

    expect(
      auditSourceForDeterminismViolations("packages/rules/src/bad.ts", "const r = Math.random();"),
    ).toEqual([{ file: "packages/rules/src/bad.ts", pattern: "Math.random" }]);

    expect(
      auditSourceForDeterminismViolations("packages/rules/src/bad.ts", "const e = process.env.A;"),
    ).toEqual([{ file: "packages/rules/src/bad.ts", pattern: "process.env" }]);

    expect(
      auditSourceForDeterminismViolations(
        "packages/domain/src/bad.ts",
        'import fs from "node:fs";',
      ),
    ).toEqual([{ file: "packages/domain/src/bad.ts", pattern: "node:* import" }]);

    // Whitelisted file is allowed
    expect(
      auditSourceForDeterminismViolations(
        "packages/domain/src/runtime/system-clock.ts",
        "Date.now(); performance.now();",
      ),
    ).toEqual([]);
  });
});
