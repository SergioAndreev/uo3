import { describe, expect, it } from "vitest";
import { ASSET_TOOL_VERSION, runAssetToolCli } from "./index.js";

describe("@uo3/asset-tool CLI unit tests", () => {
  it("prints version and linked packages on --version", () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runAssetToolCli(
      ["--version"],
      {},
      { stdout: (m) => out.push(m), stderr: (m) => err.push(m) },
      false,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(ASSET_TOOL_VERSION);
    expect(out.join("\n")).toContain("@uo3/uo-formats");
    expect(err).toHaveLength(0);
  });

  it("validates configuration on check-env and exits with 78 on invalid env", () => {
    const okOut: string[] = [];
    const okCode = runAssetToolCli(
      ["check-env"],
      { NODE_ENV: "development", LOG_LEVEL: "info", SYNTHETIC_OUTPUT_DIR: "./out" },
      { stdout: (m) => okOut.push(m), stderr: () => undefined },
      false,
    );
    expect(okCode).toBe(0);
    expect(okOut.join("\n")).toContain('"status":"ok"');

    const badErr: string[] = [];
    const badCode = runAssetToolCli(
      ["check-env"],
      { NODE_ENV: "development", LOG_LEVEL: "invalid-level" },
      { stdout: () => undefined, stderr: (m) => badErr.push(m) },
      false,
    );
    expect(badCode).toBe(78);
    expect(badErr.join("\n")).toContain("LOG_LEVEL");
  });

  it("returns exit code 2 on unknown command and supports default stdout/stderr handlers", () => {
    const err: string[] = [];
    const code = runAssetToolCli(
      ["unknown-cmd"],
      {},
      { stdout: () => undefined, stderr: (m) => err.push(m) },
      false,
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("unknown-cmd");

    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(runAssetToolCli([], {}, undefined, false)).toBe(0);
      expect(runAssetToolCli(["bad-flag"], {}, undefined, false)).toBe(2);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  });
});
