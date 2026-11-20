import {
  DomainError,
  DomainErrorCode,
  FACET_FELUCCA,
  FACET_ILSHENAR,
  FACET_INTERNAL,
  FACET_MALAS,
  FACET_TERMUR,
  FACET_TOKUNO,
  FACET_TRAMMEL,
  Race,
  SkillId,
} from "@uo3/domain";
import { describe, expect, it } from "vitest";
import {
  assertValidRulesetProfile,
  calcBaseMaxHits,
  calcBaseMaxMana,
  calcBaseMaxStam,
  calcMaxCarryWeight,
  calcStepDelayMs,
  canonicalJsonStringify,
  ClientRulesetSnapshotValidator,
  isFacetEnabled,
  isRaceEnabled,
  isSkillEnabled,
  resolveRulesetFromConfig,
  resolveRulesetProfile,
  sha256Hex,
  toClientRulesetSnapshot,
  UOR_CANONICAL_PROFILE,
  type RulesetValidationIssue,
} from "../index.js";

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

describe("domain/ruleset-profile — Resolver, Invariants, SHA-256 Digest, Snapshot & Core Formulas", () => {
  it("merges partial overrides immutably and rejects unknown keys/feature flags with exact paths", () => {
    const resolved = resolveRulesetProfile({
      preset: "uor",
      overrides: {
        features: { trammelEnabled: false },
        network: { aoiRadiusTiles: 22 },
        character: { skillCapTenths: 7200 },
      },
    });

    expect(resolved.features.trammelEnabled).toBe(false);
    expect(resolved.network.aoiRadiusTiles).toBe(22);
    expect(resolved.character.skillCapTenths).toBe(7200);
    expect(resolved.movement.walkFootMs).toBe(400);
    expect(UOR_CANONICAL_PROFILE.features.trammelEnabled).toBe(true);

    const unknownFlagErr = expectDomainError(
      () => resolveRulesetProfile({ overrides: { features: { flyingMountsEnabled: true } } }),
      DomainErrorCode.ERR_UNKNOWN_FEATURE_FLAG,
    );
    expect(unknownFlagErr.fieldPath).toBe("features.flyingMountsEnabled");

    const unknownTopErr = expectDomainError(
      () => resolveRulesetProfile({ overrides: { customGoldMultiplier: 2 } }),
      DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
    );
    expect(unknownTopErr.fieldPath).toBe("customGoldMultiplier");

    const unknownNestedErr = expectDomainError(
      () => resolveRulesetProfile({ overrides: { pvp: { unknownField: 1 } } }),
      DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
    );
    expect(unknownNestedErr.fieldPath).toBe("pvp.unknownField");
  });

  it("blocks nonProductionOnly presets in production and allows them in development/test", () => {
    expectDomainError(
      () => resolveRulesetProfile({ preset: "uor-dev-fast", environment: "production" }),
      DomainErrorCode.ERR_NON_PROD_PRESET_FORBIDDEN,
    );

    const dev = resolveRulesetProfile({ preset: "uor-dev-fast", environment: "development" });
    expect(dev.meta.presetId).toBe("uor-dev-fast");
    expect(dev.meta.nonProductionOnly).toBe(true);
  });

  it("validates numeric parameter ranges and aggregates multiple violations in one pass", () => {
    // Boundary valid values accepted
    const boundary = resolveRulesetProfile({
      overrides: {
        network: { aoiRadiusTiles: 24, multiAoiRadiusTiles: 48, simTickMs: 20 },
        movement: { runMountedMs: 50 },
        time: { gameHourRealMs: 1000 },
      },
    });
    expect(boundary.network.aoiRadiusTiles).toBe(24);
    expect(boundary.movement.runMountedMs).toBe(50);

    // Multiple invalid values collected together
    const multiErr = expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: {
            network: { aoiRadiusTiles: 26, multiAoiRadiusTiles: 60, simTickMs: 150 },
            movement: { runMountedMs: 30 },
            time: { gameHourRealMs: 500 },
            character: { statCap: 20, skillCapTenths: 500 },
          },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );
    const issues = multiErr.details?.["issues"] as RulesetValidationIssue[];
    const paths = issues.map((i) => i.fieldPath);
    expect(paths).toContain("network.aoiRadiusTiles");
    expect(paths).toContain("movement.runMountedMs");
    expect(paths).toContain("time.gameHourRealMs");
  });

  it("enforces all 7 cross-field invariants", () => {
    // 1. multiAoi < aoi
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: { network: { aoiRadiusTiles: 22, multiAoiRadiusTiles: 20 } },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    // 2. Movement order violation (runFootMs > walkFootMs)
    expectDomainError(
      () => resolveRulesetProfile({ overrides: { movement: { runFootMs: 500, walkFootMs: 400 } } }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    // 3. statCap > maxSingleStat * 3
    expectDomainError(
      () =>
        resolveRulesetProfile({ overrides: { character: { statCap: 350, maxSingleStat: 100 } } }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    // 4. maxSingleSkillTenths > skillCapTenths
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: { character: { maxSingleSkillTenths: 1500, skillCapTenths: 1200 } },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    // 5. yellRange > aoiRadiusTiles
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: { network: { aoiRadiusTiles: 14 }, speech: { yellRangeTiles: 18 } },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    // 6. shortTermMurderDecaySec > longTermMurderDecaySec
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: {
            pvp: { shortTermMurderDecaySec: 200_000, longTermMurderDecaySec: 144_000 },
          },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    // 7. All gameplay facets disabled
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: { features: { feluccaEnabled: false, trammelEnabled: false } },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );
  });

  it("matches NIST FIPS 180-4 SHA-256 vectors, produces key-order-independent digest, and strips internal fields from ClientRulesetSnapshot", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );

    const p1 = resolveRulesetProfile({
      overrides: {
        features: { trammelEnabled: false },
        character: { statCap: 225, skillCapTenths: 7200 },
      },
    });
    const p2 = resolveRulesetProfile({
      overrides: {
        character: { skillCapTenths: 7200, statCap: 225 },
        features: { trammelEnabled: false },
      },
    });
    const p3 = resolveRulesetProfile({
      overrides: {
        character: { skillCapTenths: 7200, statCap: 230 },
        features: { trammelEnabled: false },
      },
    });

    expect(p1.profileDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(p1.profileDigest).toBe(p2.profileDigest);
    expect(p1.profileDigest).not.toBe(p3.profileDigest);

    const snapshot = toClientRulesetSnapshot(p1);
    expect(ClientRulesetSnapshotValidator.Check(snapshot)).toBe(true);
    expect(snapshot.profileDigest).toBe(p1.profileDigest);
    expect("internal" in snapshot).toBe(false);
  });

  it("computes core deterministic formulas accurately and rejects invalid stats", () => {
    expect(calcBaseMaxHits(100)).toBe(100);
    expect(calcBaseMaxStam(85)).toBe(85);
    expect(calcBaseMaxMana(40)).toBe(40);
    expect(calcMaxCarryWeight(100)).toBe(390);

    expect(calcBaseMaxHits(65)).toBe(82);
    expect(calcMaxCarryWeight(65)).toBe(267);

    expect(calcStepDelayMs(UOR_CANONICAL_PROFILE, { isMounted: false, isRunning: false })).toBe(
      400,
    );
    expect(calcStepDelayMs(UOR_CANONICAL_PROFILE, { isMounted: false, isRunning: true })).toBe(200);
    expect(calcStepDelayMs(UOR_CANONICAL_PROFILE, { isMounted: true, isRunning: false })).toBe(200);
    expect(calcStepDelayMs(UOR_CANONICAL_PROFILE, { isMounted: true, isRunning: true })).toBe(100);

    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_FELUCCA)).toBe(true);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_TRAMMEL)).toBe(true);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_ILSHENAR)).toBe(false);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_MALAS)).toBe(false);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_TOKUNO)).toBe(false);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_TERMUR)).toBe(false);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, FACET_INTERNAL)).toBe(true);
    expect(isFacetEnabled(UOR_CANONICAL_PROFILE, 200)).toBe(true);

    expect(canonicalJsonStringify({ b: [1, null, { y: 2, x: 1, z: undefined }], a: true })).toBe(
      '{"a":true,"b":[1,null,{"x":1,"y":2}]}',
    );
    expect(canonicalJsonStringify(42)).toBe("42");

    expectDomainError(
      () => assertValidRulesetProfile({ invalid: true }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );
    expectDomainError(
      () => assertValidRulesetProfile("not-a-profile"),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expect(isRaceEnabled(UOR_CANONICAL_PROFILE, Race.Human)).toBe(true);
    expect(isRaceEnabled(UOR_CANONICAL_PROFILE, Race.Elf)).toBe(false);
    expect(isSkillEnabled(UOR_CANONICAL_PROFILE, SkillId.Magery)).toBe(true);
    expect(isSkillEnabled(UOR_CANONICAL_PROFILE, 49)).toBe(false);

    expectDomainError(() => calcMaxCarryWeight(-10), DomainErrorCode.ERR_INVALID_STAT_VALUE);
    expectDomainError(() => calcMaxCarryWeight(50.5), DomainErrorCode.ERR_INVALID_STAT_VALUE);
  });

  it("resolves shard ruleset via resolveRulesetFromConfig with preset and raw overrides", () => {
    const resolved = resolveRulesetFromConfig(
      undefined,
      {
        preset: "uor",
        overrides: {
          features: { trammelEnabled: false },
          network: { aoiRadiusTiles: 22 },
          character: { skillCapTenths: 7200 },
        },
      },
      "production",
    );
    expect(resolved.features.trammelEnabled).toBe(false);
    expect(resolved.network.aoiRadiusTiles).toBe(22);
    expect(resolved.character.skillCapTenths).toBe(7200);

    expectDomainError(
      () =>
        resolveRulesetFromConfig(
          undefined,
          { preset: "uor", overrides: { bogusKey: 123 } },
          "development",
        ),
      DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
    );

    expectDomainError(
      () => resolveRulesetFromConfig("uor", "not-an-object", "development"),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expect(resolveRulesetFromConfig(undefined, undefined, "development").meta.presetId).toBe("uor");
    expect(resolveRulesetFromConfig(undefined, { environment: "production" }).meta.presetId).toBe(
      "uor",
    );
    expect(resolveRulesetFromConfig(undefined, { environment: "development" }).meta.presetId).toBe(
      "uor",
    );
    expect(resolveRulesetFromConfig(undefined, { environment: "test" }).meta.presetId).toBe("uor");
    expect(
      resolveRulesetFromConfig(undefined, { environment: "other" }, "test").meta.presetId,
    ).toBe("uor");
    expect(
      resolveRulesetFromConfig(
        undefined,
        { preset: "uor", environment: "staging", overrides: { character: { enabledRaces: [0] } } },
        "development",
      ).character.enabledRaces,
    ).toEqual([0]);

    // Check remaining numeric bounds (low bounds + high bounds)
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: {
            network: { aoiRadiusTiles: 5, multiAoiRadiusTiles: 10, simTickMs: 10 },
            character: { statCap: 950, skillCapTenths: 60_000 },
          },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );
    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: {
            speech: { whisperRangeTiles: 16, normalRangeTiles: 15, yellRangeTiles: 18 },
          },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expectDomainError(
      () => resolveRulesetFromConfig("uor", { unknownRoot: true }, "development"),
      DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
    );

    expectDomainError(
      () => resolveRulesetProfile({ overrides: ["not-an-object"] }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expectDomainError(
      () => resolveRulesetProfile({ overrides: { network: "bad" } }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expectDomainError(
      () => resolveRulesetProfile({ overrides: { network: { aoiRadiusTiles: "22" } } }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expectDomainError(
      () =>
        resolveRulesetProfile({
          overrides: { movement: { walkMountedMs: 500, walkFootMs: 400 } },
        }),
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
    );

    expect(
      resolveRulesetProfile({ overrides: { network: undefined } }).network.aoiRadiusTiles,
    ).toBe(18);
  });
});
