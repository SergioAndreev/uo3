import {
  deepFreeze,
  PERSON_HEIGHT,
  Race,
  SECTOR_SIZE,
  STEP_HEIGHT,
  TILE_HEIGHT_PX,
  TILE_WIDTH_PX,
  UOR_SKILL_COUNT,
  Z_STEP_PX,
  type DeepReadonly,
} from "@uo3/domain";
import { RULESET_SCHEMA_VERSION, type RulesetProfile } from "../schema/ruleset.schema.js";

export const UOR_CANONICAL_PROFILE: DeepReadonly<RulesetProfile> = deepFreeze<RulesetProfile>({
  meta: {
    schemaVersion: RULESET_SCHEMA_VERSION,
    era: "uor",
    presetId: "uor",
    nonProductionOnly: false,
  },
  features: {
    feluccaEnabled: true,
    trammelEnabled: true,
    ilshenarEnabled: false,
    malasEnabled: false,
    tokunoEnabled: false,
    terMurEnabled: false,
    aosItemProperties: false,
    aosTooltips: false,
    itemInsurance: false,
    powerScrolls: false,
    necromancy: false,
    chivalry: false,
    elvesEnabled: false,
    gargoylesEnabled: false,
    murderCountDecayOnlineOnly: true,
    mountSpeedBonus: true,
    precastMagic: true,
    autoOpenDoors: true,
  },
  geometry: {
    tileWidthPx: TILE_WIDTH_PX,
    tileHeightPx: TILE_HEIGHT_PX,
    zStepPx: Z_STEP_PX,
    sectorSizeTiles: SECTOR_SIZE,
    personHeight: PERSON_HEIGHT,
    stepHeight: STEP_HEIGHT,
  },
  network: {
    aoiRadiusTiles: 18,
    multiAoiRadiusTiles: 31,
    simTickMs: 50,
    patchIntervalMs: 50,
    moveSequenceMax: 255,
    maxUnackedMoves: 4,
  },
  movement: {
    walkFootMs: 400,
    runFootMs: 200,
    walkMountedMs: 200,
    runMountedMs: 100,
  },
  time: {
    gameHourRealMs: 300_000,
    shardEpochOffsetMs: 0,
  },
  character: {
    statCap: 225,
    minSingleStat: 10,
    maxSingleStat: 100,
    skillCapTenths: 7000,
    maxSingleSkillTenths: 1000,
    skillCount: UOR_SKILL_COUNT,
    enabledRaces: [Race.Human],
  },
  inventory: {
    backpackMaxItems: 125,
    backpackMaxWeightStones: 400,
  },
  pvp: {
    criminalDurationMs: 120_000,
    murdererShortTermThreshold: 5,
    shortTermMurderDecaySec: 28_800,
    longTermMurderDecaySec: 144_000,
  },
  speech: {
    whisperRangeTiles: 1,
    normalRangeTiles: 15,
    yellRangeTiles: 18,
  },
  lifecycle: {
    itemDecayMs: 3_600_000,
    unsafeLogoutDelayMs: 300_000,
    safeLogoutDelayMs: 0,
  },
  internal: {
    serialWarnPercent80: 80,
    serialWarnPercent95: 95,
    antiCheatSpeedToleranceMs: 50,
    maxTickDriftMs: 250,
  },
});

export function getCanonicalUorProfile(): DeepReadonly<RulesetProfile> {
  return UOR_CANONICAL_PROFILE;
}
