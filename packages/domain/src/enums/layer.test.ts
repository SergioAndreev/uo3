import { describe, expect, it } from "vitest";
import { DomainError, DomainErrorCode } from "../errors/domain-error.js";
import {
  asBodyId,
  asGender,
  asHue,
  asLayer,
  asRace,
  assertHairHue,
  assertRaceEnabled,
  assertSkinHue,
  BODY_ELF_FEMALE,
  BODY_ELF_FEMALE_GHOST,
  BODY_ELF_MALE,
  BODY_ELF_MALE_GHOST,
  BODY_EMPTY,
  BODY_GARGOYLE_FEMALE,
  BODY_GARGOYLE_FEMALE_GHOST,
  BODY_GARGOYLE_MALE,
  BODY_GARGOYLE_MALE_GHOST,
  BODY_HUMAN_FEMALE,
  BODY_HUMAN_FEMALE_GHOST,
  BODY_HUMAN_MALE,
  BODY_HUMAN_MALE_GHOST,
  BODY_STAFF_ROBE,
  BodyIdValidator,
  classifyBody,
  decodeHue,
  encodeHue,
  Gender,
  GenderValidator,
  getConflictingLayers,
  getLayerMetadata,
  HueValidator,
  isEmptyBody,
  isFemaleBody,
  isGhostBody,
  isHumanBody,
  Layer,
  LAYER_DRAW_ORDER,
  LAYER_MAX,
  LAYER_METADATA,
  LAYER_MIN,
  LayerValidator,
  Race,
  RaceValidator,
  readHueBE,
  resolveCharacterBody,
  writeHueBE,
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

describe("domain/core-enumerations — Layer, Body, Hue, Race & Gender", () => {
  it("covers all 30 Layer codes 0x00..0x1D, metadata, conflicts, and canonical draw order", () => {
    for (let code = LAYER_MIN; code <= LAYER_MAX; code += 1) {
      expect(asLayer(code)).toBe(code);
      expect(LayerValidator.Check(code)).toBe(true);
      expect(LAYER_METADATA[code as Layer].code).toBe(code);
    }

    expectDomainCode(() => asLayer(0x1e, "layer"), DomainErrorCode.ERR_INVALID_LAYER);
    expectDomainCode(() => asLayer(-1), DomainErrorCode.ERR_INVALID_LAYER);
    expect(LayerValidator.Check(0x1e)).toBe(false);

    expect(getLayerMetadata(Layer.OneHanded)).toMatchObject({
      visible: true,
      draggable: true,
      conflicts: [Layer.TwoHanded],
    });
    expect(getConflictingLayers(Layer.OneHanded)).toEqual([Layer.TwoHanded]);
    expect(getConflictingLayers(Layer.TwoHanded)).toEqual([Layer.OneHanded]);
    expect(getConflictingLayers(Layer.Ring)).toEqual([]);

    expect(getLayerMetadata(Layer.Backpack).draggable).toBe(false);
    expect(getLayerMetadata(Layer.Hair).draggable).toBe(false);

    const idx = (l: Layer) => LAYER_DRAW_ORDER.indexOf(l);
    expect(idx(Layer.Shirt)).toBeLessThan(idx(Layer.InnerTorso));
    expect(idx(Layer.InnerTorso)).toBeLessThan(idx(Layer.MiddleTorso));
    expect(idx(Layer.MiddleTorso)).toBeLessThan(idx(Layer.OuterTorso));
    expect(idx(Layer.OuterTorso)).toBeLessThan(idx(Layer.Cloak));
  });

  it("validates and classifies BodyId (Empty, Human, Ghost, Female, Sea, Animal, Monster, Equipment)", () => {
    expect(classifyBody(BODY_EMPTY)).toBe("Empty");
    expect(isEmptyBody(0)).toBe(true);
    expect(isEmptyBody(400)).toBe(false);

    for (const id of [
      BODY_HUMAN_MALE,
      BODY_HUMAN_FEMALE,
      BODY_HUMAN_MALE_GHOST,
      BODY_HUMAN_FEMALE_GHOST,
      BODY_STAFF_ROBE,
    ]) {
      expect(classifyBody(id)).toBe("Human");
      expect(isHumanBody(id)).toBe(true);
    }
    expect(isGhostBody(402)).toBe(true);
    expect(isGhostBody(403)).toBe(true);
    expect(isGhostBody(400)).toBe(false);
    expect(isFemaleBody(401)).toBe(true);
    expect(isFemaleBody(403)).toBe(true);
    expect(isFemaleBody(400)).toBe(false);

    expect(classifyBody(16)).toBe("Sea");
    expect(classifyBody(210)).toBe("Animal");
    expect(classifyBody(1)).toBe("Monster");
    expect(classifyBody(1200)).toBe("Equipment");

    for (const bad of [-5, 70000, Number.NaN, 1.5]) {
      expectDomainCode(() => asBodyId(bad, "body"), DomainErrorCode.ERR_INVALID_BODY);
    }
    expect(BodyIdValidator.Check(400)).toBe(true);
    expect(BodyIdValidator.Check(70000)).toBe(false);
  });

  it("encodes/decodes Hue with PartialHue & Translucent flags, skin/hair ranges, and 2-byte BE codec", () => {
    expect(decodeHue(0x844e)).toEqual({ index: 1102, partialHue: true, translucent: false });
    expect(encodeHue({ index: 1102, partialHue: true })).toBe(0x844e);
    expect(decodeHue(encodeHue({ index: 500, partialHue: true, translucent: true }))).toEqual({
      index: 500,
      partialHue: true,
      translucent: true,
    });

    expect(assertSkinHue(1002)).toBe(1002);
    expect(assertSkinHue(1058)).toBe(1058);
    expectDomainCode(() => assertSkinHue(1059), DomainErrorCode.ERR_HUE_OUT_OF_ALLOWED_RANGE);
    expectDomainCode(() => assertSkinHue(1001), DomainErrorCode.ERR_HUE_OUT_OF_ALLOWED_RANGE);

    expect(assertHairHue(1102)).toBe(1102);
    expect(assertHairHue(1149)).toBe(1149);
    expectDomainCode(() => assertHairHue(1150), DomainErrorCode.ERR_HUE_OUT_OF_ALLOWED_RANGE);

    expectDomainCode(() => asHue(-1, "hue"), DomainErrorCode.ERR_INVALID_HUE);
    expectDomainCode(() => asHue(0x10000), DomainErrorCode.ERR_INVALID_HUE);
    expectDomainCode(() => encodeHue({ index: 0x4000 }), DomainErrorCode.ERR_INVALID_HUE);

    const bytes = writeHueBE(0x844e);
    expect(Array.from(bytes)).toEqual([0x84, 0x4e]);
    expect(readHueBE(bytes)).toBe(0x844e);
    expectDomainCode(() => readHueBE(new Uint8Array(1)), DomainErrorCode.ERR_INVALID_HUE);
    expectDomainCode(() => writeHueBE(0, new Uint8Array(1)), DomainErrorCode.ERR_INVALID_HUE);
    expect(HueValidator.Check(0x844e)).toBe(true);
    expect(HueValidator.Check(0x10000)).toBe(false);
  });

  it("maps Race and Gender deterministically to canonical BodyId and enforces era restrictions", () => {
    expect(resolveCharacterBody(Race.Human, Gender.Male, false)).toBe(BODY_HUMAN_MALE);
    expect(resolveCharacterBody(Race.Human, Gender.Female, false)).toBe(BODY_HUMAN_FEMALE);
    expect(resolveCharacterBody(Race.Human, Gender.Male, true)).toBe(BODY_HUMAN_MALE_GHOST);
    expect(resolveCharacterBody(Race.Human, Gender.Female, true)).toBe(BODY_HUMAN_FEMALE_GHOST);

    expectDomainCode(
      () => resolveCharacterBody(Race.Elf, Gender.Male, false),
      DomainErrorCode.ERR_RACE_DISABLED_IN_ERA,
    );
    expectDomainCode(
      () => assertRaceEnabled(Race.Gargoyle),
      DomainErrorCode.ERR_RACE_DISABLED_IN_ERA,
    );
    expectDomainCode(() => asRace(99), DomainErrorCode.ERR_RACE_DISABLED_IN_ERA);
    expectDomainCode(() => asGender(2, "gender"), DomainErrorCode.ERR_INVALID_GENDER);
    expectDomainCode(() => asGender(-1), DomainErrorCode.ERR_INVALID_GENDER);

    const allRaces = [Race.Human, Race.Elf, Race.Gargoyle];
    expect(resolveCharacterBody(Race.Elf, Gender.Male, false, allRaces)).toBe(BODY_ELF_MALE);
    expect(resolveCharacterBody(Race.Elf, Gender.Female, false, allRaces)).toBe(BODY_ELF_FEMALE);
    expect(resolveCharacterBody(Race.Elf, Gender.Male, true, allRaces)).toBe(BODY_ELF_MALE_GHOST);
    expect(resolveCharacterBody(Race.Elf, Gender.Female, true, allRaces)).toBe(
      BODY_ELF_FEMALE_GHOST,
    );
    expect(resolveCharacterBody(Race.Gargoyle, Gender.Male, false, allRaces)).toBe(
      BODY_GARGOYLE_MALE,
    );
    expect(resolveCharacterBody(Race.Gargoyle, Gender.Female, false, allRaces)).toBe(
      BODY_GARGOYLE_FEMALE,
    );
    expect(resolveCharacterBody(Race.Gargoyle, Gender.Male, true, allRaces)).toBe(
      BODY_GARGOYLE_MALE_GHOST,
    );
    expect(resolveCharacterBody(Race.Gargoyle, Gender.Female, true, allRaces)).toBe(
      BODY_GARGOYLE_FEMALE_GHOST,
    );

    expect(RaceValidator.Check(0)).toBe(true);
    expect(RaceValidator.Check(3)).toBe(false);
    expect(GenderValidator.Check(1)).toBe(true);
    expect(GenderValidator.Check(2)).toBe(false);
  });
});
