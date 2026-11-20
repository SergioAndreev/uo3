import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRawShardRulesetFile } from "@uo3/config/env/server";
import { DomainError, DomainErrorCode } from "@uo3/domain";
import {
  ClientRulesetSnapshotValidator,
  resolveRulesetFromConfig,
  toClientRulesetSnapshot,
} from "@uo3/rules";
import { describe, expect, it } from "vitest";

function expectDomainError(fn: () => unknown, code: DomainErrorCode): DomainError {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    const domainErr = err as DomainError;
    expect(domainErr.code).toBe(code);
    return domainErr;
  }
}

describe("config -> rules pipeline (tasks 10.8, 10.9, 15.5)", () => {
  it("validates the YAML example from packages/rules/docs/ruleset-profile.md and builds ClientRulesetSnapshot without internal fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-ruleset-pipeline-"));
    try {
      const docPath = resolve(import.meta.dirname, "../../rules/docs/ruleset-profile.md");
      const docText = readFileSync(docPath, "utf8");
      const yamlMatch = /```yaml\r?\n([\s\S]*?)```/.exec(docText);
      expect(yamlMatch).not.toBeNull();

      const validFile = join(dir, "shard-ruleset.yaml");
      writeFileSync(validFile, yamlMatch![1]!, "utf8");

      const rawValid = loadRawShardRulesetFile(validFile);
      const resolved = resolveRulesetFromConfig(undefined, rawValid, "production");
      expect(resolved.features.trammelEnabled).toBe(false);
      expect(resolved.network.aoiRadiusTiles).toBe(22);
      expect(resolved.character.skillCapTenths).toBe(7200);

      const snapshot = toClientRulesetSnapshot(resolved);
      expect(ClientRulesetSnapshotValidator.Check(snapshot)).toBe(true);
      expect("internal" in snapshot).toBe(false);

      const uor = resolveRulesetFromConfig("uor", undefined, "production");
      expect(uor.meta.presetId).toBe("uor");

      const feluccaOnly = resolveRulesetFromConfig("uor-felucca-only", undefined, "production");
      expect(feluccaOnly.features.trammelEnabled).toBe(false);
      expect(feluccaOnly.features.feluccaEnabled).toBe(true);

      expectDomainError(
        () => resolveRulesetFromConfig("uor-dev-fast", undefined, "production"),
        DomainErrorCode.ERR_NON_PROD_PRESET_FORBIDDEN,
      );

      const invalidFile = join(dir, "invalid-ruleset.yaml");
      writeFileSync(invalidFile, "preset: uor\noverrides:\n  bogusKey: 123\n", "utf8");
      const rawInvalid = loadRawShardRulesetFile(invalidFile);
      expectDomainError(
        () => resolveRulesetFromConfig(undefined, rawInvalid, "development"),
        DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
