import { DomainError, DomainErrorCode, Race } from "@uo3/domain";
import { describe, expect, it } from "vitest";
import {
  FeatureFlagsValidator,
  getCanonicalUorProfile,
  getRulesetPreset,
  RULESET_PRESETS,
  RULESET_SCHEMA_VERSION,
  UOR_CANONICAL_PROFILE,
} from "../index.js";

function expectDomainCode(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("domain/ruleset-profile — UOR Canonical Profile, Constants, FeatureFlags & Presets", () => {
  it("matches every canonical UO:Renaissance constant from docs/ARCHITECTURE.md", () => {
    const p = getCanonicalUorProfile();
    expect(p).toBe(UOR_CANONICAL_PROFILE);
    expect(p.meta).toEqual({
      schemaVersion: RULESET_SCHEMA_VERSION,
      era: "uor",
      presetId: "uor",
      nonProductionOnly: false,
    });

    // Geometry
    expect(p.geometry).toEqual({
      tileWidthPx: 44,
      tileHeightPx: 44,
      zStepPx: 4,
      sectorSizeTiles: 16,
      personHeight: 16,
      stepHeight: 2,
    });

    // Network & Simulation
    expect(p.network).toEqual({
      aoiRadiusTiles: 18,
      multiAoiRadiusTiles: 31,
      simTickMs: 50,
      patchIntervalMs: 50,
      moveSequenceMax: 255,
      maxUnackedMoves: 4,
    });

    // Movement delays
    expect(p.movement).toEqual({
      walkFootMs: 400,
      runFootMs: 200,
      walkMountedMs: 200,
      runMountedMs: 100,
    });

    // Time
    expect(p.time).toEqual({
      gameHourRealMs: 300_000,
      shardEpochOffsetMs: 0,
    });

    // Character & Inventory
    expect(p.character).toEqual({
      statCap: 225,
      minSingleStat: 10,
      maxSingleStat: 100,
      skillCapTenths: 7000,
      maxSingleSkillTenths: 1000,
      skillCount: 49,
      enabledRaces: [Race.Human],
    });
    expect(p.inventory).toEqual({
      backpackMaxItems: 125,
      backpackMaxWeightStones: 400,
    });

    // PvP, Speech & Lifecycle
    expect(p.pvp).toEqual({
      criminalDurationMs: 120_000,
      murdererShortTermThreshold: 5,
      shortTermMurderDecaySec: 28_800,
      longTermMurderDecaySec: 144_000,
    });
    expect(p.speech).toEqual({
      whisperRangeTiles: 1,
      normalRangeTiles: 15,
      yellRangeTiles: 18,
    });
    expect(p.lifecycle).toEqual({
      itemDecayMs: 3_600_000,
      unsafeLogoutDelayMs: 300_000,
      safeLogoutDelayMs: 0,
    });
  });

  it("sets UO:R default feature flags, rejects unknown feature flags, and deeply freezes canonical profile", () => {
    const f = UOR_CANONICAL_PROFILE.features;
    expect(FeatureFlagsValidator.Check(f)).toBe(true);
    expect(f.feluccaEnabled).toBe(true);
    expect(f.trammelEnabled).toBe(true);
    expect(f.murderCountDecayOnlineOnly).toBe(true);
    expect(f.mountSpeedBonus).toBe(true);
    expect(f.precastMagic).toBe(true);

    expect(f.aosItemProperties).toBe(false);
    expect(f.aosTooltips).toBe(false);
    expect(f.itemInsurance).toBe(false);
    expect(f.powerScrolls).toBe(false);
    expect(f.necromancy).toBe(false);
    expect(f.chivalry).toBe(false);
    expect(f.ilshenarEnabled).toBe(false);
    expect(f.elvesEnabled).toBe(false);
    expect(f.gargoylesEnabled).toBe(false);

    expect(FeatureFlagsValidator.Check({ ...f, flyingMountsEnabled: true })).toBe(false);

    expect(() => {
      (UOR_CANONICAL_PROFILE.network as { aoiRadiusTiles: number }).aoiRadiusTiles = 99;
    }).toThrow(TypeError);
    expect(getCanonicalUorProfile().network.aoiRadiusTiles).toBe(18);
  });

  it("provides uor, uor-felucca-only, and uor-dev-fast presets and rejects unknown preset IDs", () => {
    expect(Object.keys(RULESET_PRESETS).sort()).toEqual([
      "uor",
      "uor-dev-fast",
      "uor-felucca-only",
    ]);

    const felOnly = getRulesetPreset("uor-felucca-only");
    expect(felOnly.features.feluccaEnabled).toBe(true);
    expect(felOnly.features.trammelEnabled).toBe(false);
    expect(felOnly.meta.nonProductionOnly).toBe(false);

    const devFast = getRulesetPreset("uor-dev-fast");
    expect(devFast.meta.nonProductionOnly).toBe(true);
    expect(devFast.time.gameHourRealMs).toBeLessThan(300_000);

    expectDomainCode(
      () => getRulesetPreset("aos-custom"),
      DomainErrorCode.ERR_UNKNOWN_RULESET_PRESET,
    );
  });
});
