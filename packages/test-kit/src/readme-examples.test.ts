import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("@uo3/test-kit — README.md code examples typecheck (task 14.7)", () => {
  it("compiles every TypeScript code fence in packages/test-kit/README.md with zero diagnostics", () => {
    const pkgDir = resolve(import.meta.dirname, "..");
    const readmeText = readFileSync(join(pkgDir, "README.md"), "utf8");
    const blocks: string[] = [];
    const regex = /```ts\r?\n([\s\S]*?)```/g;
    let match = regex.exec(readmeText);
    while (match !== null) {
      blocks.push(match[1]!);
      match = regex.exec(readmeText);
    }

    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const tempDir = mkdtempSync(join(pkgDir, ".tmp-readme-check-"));
    try {
      const files: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const filePath = join(tempDir, `example-${i}.ts`);
        writeFileSync(filePath, blocks[i]!, "utf8");
        files.push(filePath);
      }

      const program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        baseUrl: pkgDir,
        paths: {
          "@uo3/test-kit": ["./src/index.ts"],
          "@uo3/test-kit/clock": ["./src/clock/index.ts"],
          "@uo3/test-kit/rng": ["./src/rng/index.ts"],
          "@uo3/test-kit/fixtures": ["./src/fixtures/index.ts"],
        },
      });

      const diagnostics = ts.getPreEmitDiagnostics(program);
      const formatted = diagnostics.map((d) =>
        ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      );
      expect(formatted).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
