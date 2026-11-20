import {
  ItemTileDataValidator,
  LandTileDataValidator,
  Point3DValidator,
  tileFlagsToHex,
  unregisterSyntheticFacet,
  WorldLocationValidator,
} from "@uo3/domain";
import { RulesetProfileValidator } from "@uo3/rules";
import { describe, expect, it } from "vitest";
import { assertDeterministicRun } from "./determinism.js";
import {
  createSyntheticFacet,
  createTestItemTileData,
  createTestLandTileData,
  createTestPoint3D,
  createTestRulesetProfile,
  createTestSerialAllocator,
} from "./domain-fixtures.js";

describe("@uo3/test-kit — Domain Fixtures & assertDeterministicRun", () => {
  it("creates TypeBox-valid fixtures for allocators, rulesets, facets, points, and tile data", () => {
    const { allocator } = createTestSerialAllocator();
    const m = allocator.allocateMobile();
    const item = allocator.allocateItem();
    expect(m).toBe(0x00000001);
    expect(item).toBe(0x40000000);

    const ruleset = createTestRulesetProfile({ network: { aoiRadiusTiles: 20 } });
    // RulesetProfileSchema does not include profileDigest (added by resolver)
    const { profileDigest: _digest, ...rawProfile } = ruleset;
    expect(RulesetProfileValidator.Check(rawProfile)).toBe(true);
    expect(ruleset.network.aoiRadiusTiles).toBe(20);

    const facet = createSyntheticFacet(205);
    try {
      expect(facet.width).toBe(256);
      expect(facet.height).toBe(256);
      expect(facet.synthetic).toBe(true);

      const pt = createTestPoint3D(100, 150, 5);
      expect(Point3DValidator.Check(pt)).toBe(true);
      expect(WorldLocationValidator.Check({ facet: facet.id, ...pt })).toBe(true);
    } finally {
      unregisterSyntheticFacet(205);
    }

    const land = createTestLandTileData();
    expect(
      LandTileDataValidator.Check({
        id: land.id,
        flags: tileFlagsToHex(land.flags),
        textureId: land.textureId,
        name: land.name,
      }),
    ).toBe(true);

    const itemTile = createTestItemTileData();
    expect(
      ItemTileDataValidator.Check({
        id: itemTile.id,
        flags: tileFlagsToHex(itemTile.flags),
        weight: itemTile.weight,
        quality: itemTile.quality,
        quantity: itemTile.quantity,
        animId: itemTile.animId,
        hue: itemTile.hue,
        value: itemTile.value,
        height: itemTile.height,
        name: itemTile.name,
      }),
    ).toBe(true);
  });

  it("verifies deterministic runs and catches external non-deterministic mutations", () => {
    const report = assertDeterministicRun(
      ({ clock, rng, allocator, ruleset }) => {
        clock.advanceTicks(10);
        const serial = allocator.allocateMobile();
        const roll = rng.rollDice(2, 6, 3);
        return {
          nowMs: clock.nowMs,
          serial,
          roll,
          digest: ruleset.profileDigest,
          flags: 1n << 40n,
          bytes: rng.toBytes(),
        };
      },
      { seed: "det-check-1" },
    );
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.result.nowMs).toBe(500);

    let externalCounter = 0;
    expect(() =>
      assertDeterministicRun(() => {
        externalCounter += 1;
        return { externalCounter };
      }),
    ).toThrow(/Determinism assertion failed/);
  });
});
