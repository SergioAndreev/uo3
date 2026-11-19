import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const TSCONFIG_DIR = resolve(import.meta.dirname, "../../tsconfig");

function compileFixture(
  presetFile: string,
  fileName: string,
  sourceCode: string,
): readonly ts.Diagnostic[] {
  const dir = mkdtempSync(join(tmpdir(), "uo3-tsc-fixture-"));
  try {
    const tsconfigPath = join(dir, "tsconfig.json");
    const sourcePath = join(dir, fileName);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture", private: true, type: "module" }),
      "utf8",
    );
    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          extends: join(TSCONFIG_DIR, presetFile),
          compilerOptions: {
            noEmit: true,
            composite: false,
            types: [],
          },
          include: [fileName],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(sourcePath, sourceCode, "utf8");

    const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (readResult.error) {
      return [readResult.error];
    }
    const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, dir);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    return ts.getPreEmitDiagnostics(program);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TypeScript strict presets", () => {
  it("compiles clean fixtures under all 5 profiles (base, isomorphic, node, nestjs, react)", () => {
    expect(
      compileFixture("base.json", "ok.ts", "export const sum = (a: number, b: number) => a + b;\n"),
    ).toHaveLength(0);

    expect(
      compileFixture(
        "isomorphic.json",
        "ok.ts",
        "export interface Coord { readonly x: number; readonly y: number; }\n",
      ),
    ).toHaveLength(0);

    expect(compileFixture("node.json", "ok.ts", "export const value: number = 22;\n")).toHaveLength(
      0,
    );

    expect(
      compileFixture(
        "nestjs.json",
        "ok.ts",
        "function Injectable(): ClassDecorator { return () => undefined; }\n@Injectable()\nexport class SampleService {}\n",
      ),
    ).toHaveLength(0);

    expect(
      compileFixture(
        "react.json",
        "ok.ts",
        "export const hasWindow = typeof window !== 'undefined';\n",
      ),
    ).toHaveLength(0);
  }, 25_000);

  it("rejects implicit any and unchecked array indexing under base.json", () => {
    const implicitAny = compileFixture(
      "base.json",
      "bad-any.ts",
      "export function f(x) { return x; }\n",
    );
    expect(implicitAny.some((d) => d.code === 7006)).toBe(true);

    const uncheckedIndex = compileFixture(
      "base.json",
      "bad-index.ts",
      "export function firstLen(items: string[]): number { return items[0].length; }\n",
    );
    expect(uncheckedIndex.some((d) => d.code === 2532)).toBe(true);
  });

  it("rejects DOM globals (window / document) under isomorphic.json", () => {
    const domDiag = compileFixture(
      "isomorphic.json",
      "bad-dom.ts",
      "export const title = document.title;\n",
    );
    expect(domDiag.length).toBeGreaterThan(0);
  });
});
