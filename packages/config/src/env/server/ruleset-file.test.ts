import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../shared/errors.js";
import { loadRawShardRulesetFile } from "./ruleset-file.js";

describe("@uo3/config — loadRawShardRulesetFile", () => {
  it("returns undefined for blank file paths", () => {
    expect(loadRawShardRulesetFile("")).toBeUndefined();
    expect(loadRawShardRulesetFile("   ")).toBeUndefined();
  });

  it("parses valid YAML ruleset files into raw untyped objects", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-config-ruleset-"));
    try {
      const filePath = join(dir, "shard-ruleset.yaml");
      writeFileSync(
        filePath,
        "preset: uor\noverrides:\n  network:\n    aoiRadiusTiles: 20\n",
        "utf8",
      );

      const parsed = loadRawShardRulesetFile(filePath);
      expect(parsed).toEqual({
        preset: "uor",
        overrides: {
          network: {
            aoiRadiusTiles: 20,
          },
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws ConfigError when file is missing or contains invalid YAML", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-config-ruleset-err-"));
    try {
      expect(() => loadRawShardRulesetFile(join(dir, "missing.yaml"))).toThrow(ConfigError);

      const badFile = join(dir, "bad.yaml");
      writeFileSync(badFile, "preset: [\n  unclosed", "utf8");
      expect(() => loadRawShardRulesetFile(badFile)).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
