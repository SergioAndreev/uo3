import { describe, expect, it } from "vitest";
import {
  checkNodeVersion,
  REQUIRED_NODE_RANGE,
  runNodeVersionPreflight,
} from "./check-node-version.js";

describe("check-node-version preflight", () => {
  it("accepts Node.js 22.12.0 with exit code 0", () => {
    const result = checkNodeVersion("22.12.0");
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.detectedVersion).toBe("22.12.0");
    expect(result.requiredRange).toBe(REQUIRED_NODE_RANGE);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = runNodeVersionPreflight("v22.12.0", {
      stdout: (m) => stdout.push(m),
      stderr: (m) => stderr.push(m),
    });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("22.12.0");
    expect(stderr).toHaveLength(0);
  });

  it("rejects Node.js 20.18.0 with non-zero exit code and diagnostic message", () => {
    const stderr: string[] = [];
    const code = runNodeVersionPreflight("20.18.0", {
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
    });
    expect(code).not.toBe(0);
    expect(stderr.join("\n")).toContain("22.x");
    expect(stderr.join("\n")).toContain("20.18.0");
  });

  it("rejects Node.js 23.0.0 with non-zero exit code and diagnostic message", () => {
    const stderr: string[] = [];
    const code = runNodeVersionPreflight("23.0.0", {
      stdout: () => undefined,
      stderr: (m) => stderr.push(m),
    });
    expect(code).not.toBe(0);
    expect(stderr.join("\n")).toContain("22.x");
    expect(stderr.join("\n")).toContain("23.0.0");
  });

  it("rejects unparseable version strings", () => {
    const result = checkNodeVersion("not-a-version");
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("22.x");
  });
});
