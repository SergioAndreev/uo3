import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  AccessLevel,
  AccessLevelValidator,
  asAccessLevel,
  asLockState,
  asNotoriety,
  asSkillTenths,
  asStatId,
  asUorSkillId,
  canStaffTarget,
  displayToTenths,
  getNotorietyMetadata,
  hasAtLeastAccess,
  isStaffAccess,
  LockState,
  LockStateValidator,
  Notoriety,
  NOTORIETY_METADATA,
  NotorietyValidator,
  parseAccessLevel,
  SkillId,
  SkillIdValidator,
  StatId,
  StatIdValidator,
  tenthsToDisplay,
  UOR_SKILL_CATALOG,
  UOR_SKILL_COUNT,
} from "./index.js";

function expectDomainCode(fn: () => unknown, code: DomainErrorCode): void {
  try {
    fn();
    expect.unreachable(`Expected DomainError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
  }
}

describe("domain/core-enumerations — Notoriety, AccessLevel & 49 UO:R Skills/Stats", () => {
  it("validates all 7 Notoriety codes and semantics", () => {
    for (let code = 1; code <= 7; code += 1) {
      expect(asNotoriety(code)).toBe(code);
      expect(NotorietyValidator.Check(code)).toBe(true);
      expect(NOTORIETY_METADATA[code as Notoriety].code).toBe(code);
    }

    expect(getNotorietyMetadata(Notoriety.Innocent)).toMatchObject({
      colorToken: "blue",
      isCriminalToAttack: true,
      canReceiveDamage: true,
    });
    expect(getNotorietyMetadata(Notoriety.Criminal)).toMatchObject({
      colorToken: "gray",
      isCriminalToAttack: false,
      canReceiveDamage: true,
    });
    expect(getNotorietyMetadata(Notoriety.Murderer)).toMatchObject({
      colorToken: "red",
      isCriminalToAttack: false,
      canReceiveDamage: true,
    });
    expect(getNotorietyMetadata(Notoriety.Invulnerable)).toMatchObject({
      colorToken: "yellow",
      canReceiveDamage: false,
    });

    for (const bad of [0, 8, -1, 1.5]) {
      expectDomainCode(() => asNotoriety(bad, "notoriety"), DomainErrorCode.ERR_INVALID_NOTORIETY);
    }
    expect(NotorietyValidator.Check(0)).toBe(false);
    expect(NotorietyValidator.Check(8)).toBe(false);
  });

  it("enforces AccessLevel hierarchy, 7x7 subordination matrix, and case-insensitive parsing", () => {
    expect(isStaffAccess(AccessLevel.Player)).toBe(false);
    expect(isStaffAccess(AccessLevel.Counselor)).toBe(true);
    expect(isStaffAccess(AccessLevel.GameMaster)).toBe(true);

    expect(hasAtLeastAccess(AccessLevel.Player, AccessLevel.Counselor)).toBe(false);
    expect(hasAtLeastAccess(AccessLevel.Counselor, AccessLevel.Counselor)).toBe(true);
    expect(hasAtLeastAccess(AccessLevel.GameMaster, AccessLevel.Counselor)).toBe(true);

    // Full 7x7 subordination matrix
    for (let actor = 0; actor <= 6; actor += 1) {
      for (let target = 0; target <= 6; target += 1) {
        const expected = actor === AccessLevel.Owner || actor > target;
        expect(canStaffTarget(actor as AccessLevel, target as AccessLevel)).toBe(expected);
      }
    }

    expect(parseAccessLevel("gamemaster")).toBe(AccessLevel.GameMaster);
    expect(parseAccessLevel("Owner")).toBe(AccessLevel.Owner);
    expectDomainCode(
      () => parseAccessLevel("SuperAdmin", "role"),
      DomainErrorCode.ERR_INVALID_ACCESS_LEVEL,
    );
    expectDomainCode(() => asAccessLevel(7, "level"), DomainErrorCode.ERR_INVALID_ACCESS_LEVEL);
    expect(AccessLevelValidator.Check(6)).toBe(true);
    expect(AccessLevelValidator.Check(7)).toBe(false);
  });

  it("defines exactly 49 sequential UO:R skills (0..48), 3 stats, 3 lock states, and integer SkillTenths", () => {
    expect(UOR_SKILL_CATALOG).toHaveLength(UOR_SKILL_COUNT);
    expect(UOR_SKILL_COUNT).toBe(49);

    const seenIds = new Set<number>();
    const seenKeys = new Set<string>();
    for (let i = 0; i < 49; i += 1) {
      const entry = UOR_SKILL_CATALOG[i]!;
      expect(entry.id).toBe(i);
      expect(asUorSkillId(i)).toBe(i);
      expect(SkillIdValidator.Check(i)).toBe(true);
      seenIds.add(entry.id);
      seenKeys.add(entry.key);
    }
    expect(seenIds.size).toBe(49);
    expect(seenKeys.size).toBe(49);

    expect(SkillId.Alchemy).toBe(0);
    expect(SkillId.Magery).toBe(25);
    expect(SkillId.Swords).toBe(40);
    expect(SkillId.Meditation).toBe(46);
    expect(SkillId.Stealth).toBe(47);
    expect(SkillId.RemoveTrap).toBe(48);

    expectDomainCode(() => asUorSkillId(49, "skill"), DomainErrorCode.ERR_INVALID_SKILL_ID);
    expectDomainCode(() => asUorSkillId(-1), DomainErrorCode.ERR_INVALID_SKILL_ID);
    expect(SkillIdValidator.Check(49)).toBe(false);

    expect(asStatId(StatId.Strength)).toBe(0);
    expect(asStatId(StatId.Dexterity)).toBe(1);
    expect(asStatId(StatId.Intelligence)).toBe(2);
    expectDomainCode(() => asStatId(3, "stat"), DomainErrorCode.ERR_INVALID_STAT_ID);
    expect(StatIdValidator.Check(2)).toBe(true);
    expect(StatIdValidator.Check(3)).toBe(false);

    expect(asLockState(LockState.Up)).toBe(0);
    expect(asLockState(LockState.Down)).toBe(1);
    expect(asLockState(LockState.Locked)).toBe(2);
    expectDomainCode(() => asLockState(3, "lock"), DomainErrorCode.ERR_INVALID_LOCK_STATE);
    expect(LockStateValidator.Check(2)).toBe(true);
    expect(LockStateValidator.Check(3)).toBe(false);

    // Exact tenths integer arithmetic (no float64 drift)
    expect(asSkillTenths(705)).toBe(705);
    expect(tenthsToDisplay(705)).toBe("70.5");
    expect(tenthsToDisplay(1000)).toBe("100.0");
    expect(displayToTenths("70.5")).toBe(705);
    expect(displayToTenths("100")).toBe(1000);
    expectDomainCode(() => asSkillTenths(-1), DomainErrorCode.ERR_INVALID_STAT_VALUE);
    expectDomainCode(() => asSkillTenths(1001), DomainErrorCode.ERR_INVALID_STAT_VALUE);
    expectDomainCode(() => displayToTenths("70.55"), DomainErrorCode.ERR_INVALID_STAT_VALUE);
  });
});
