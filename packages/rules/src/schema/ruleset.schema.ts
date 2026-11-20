import { Type, type Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

export const RULESET_SCHEMA_VERSION = "1.0.0" as const;

export const FeatureFlagsSchema = Type.Object(
  {
    feluccaEnabled: Type.Boolean(),
    trammelEnabled: Type.Boolean(),
    ilshenarEnabled: Type.Boolean(),
    malasEnabled: Type.Boolean(),
    tokunoEnabled: Type.Boolean(),
    terMurEnabled: Type.Boolean(),
    aosItemProperties: Type.Boolean(),
    aosTooltips: Type.Boolean(),
    itemInsurance: Type.Boolean(),
    powerScrolls: Type.Boolean(),
    necromancy: Type.Boolean(),
    chivalry: Type.Boolean(),
    elvesEnabled: Type.Boolean(),
    gargoylesEnabled: Type.Boolean(),
    murderCountDecayOnlineOnly: Type.Boolean(),
    mountSpeedBonus: Type.Boolean(),
    precastMagic: Type.Boolean(),
    autoOpenDoors: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type FeatureFlags = Static<typeof FeatureFlagsSchema>;

export const RulesetMetaSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RULESET_SCHEMA_VERSION),
    era: Type.Literal("uor"),
    presetId: Type.String({ minLength: 1 }),
    nonProductionOnly: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const RulesetGeometrySchema = Type.Object(
  {
    tileWidthPx: Type.Integer({ minimum: 1 }),
    tileHeightPx: Type.Integer({ minimum: 1 }),
    zStepPx: Type.Integer({ minimum: 1 }),
    sectorSizeTiles: Type.Integer({ minimum: 1 }),
    personHeight: Type.Integer({ minimum: 1 }),
    stepHeight: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const RulesetNetworkSchema = Type.Object(
  {
    aoiRadiusTiles: Type.Integer(),
    multiAoiRadiusTiles: Type.Integer(),
    simTickMs: Type.Integer(),
    patchIntervalMs: Type.Integer(),
    moveSequenceMax: Type.Integer({ minimum: 1, maximum: 255 }),
    maxUnackedMoves: Type.Integer({ minimum: 1, maximum: 16 }),
  },
  { additionalProperties: false },
);

export const RulesetMovementSchema = Type.Object(
  {
    walkFootMs: Type.Integer(),
    runFootMs: Type.Integer(),
    walkMountedMs: Type.Integer(),
    runMountedMs: Type.Integer(),
  },
  { additionalProperties: false },
);

export const RulesetTimeSchema = Type.Object(
  {
    gameHourRealMs: Type.Integer(),
    shardEpochOffsetMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const RulesetCharacterSchema = Type.Object(
  {
    statCap: Type.Integer(),
    minSingleStat: Type.Integer({ minimum: 1 }),
    maxSingleStat: Type.Integer({ minimum: 1 }),
    skillCapTenths: Type.Integer(),
    maxSingleSkillTenths: Type.Integer({ minimum: 100 }),
    skillCount: Type.Integer({ minimum: 1, maximum: 64 }),
    enabledRaces: Type.Array(Type.Integer({ minimum: 0, maximum: 2 }), { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const RulesetInventorySchema = Type.Object(
  {
    backpackMaxItems: Type.Integer({ minimum: 1 }),
    backpackMaxWeightStones: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const RulesetPvpSchema = Type.Object(
  {
    criminalDurationMs: Type.Integer({ minimum: 1000 }),
    murdererShortTermThreshold: Type.Integer({ minimum: 1 }),
    shortTermMurderDecaySec: Type.Integer({ minimum: 1 }),
    longTermMurderDecaySec: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const RulesetSpeechSchema = Type.Object(
  {
    whisperRangeTiles: Type.Integer({ minimum: 0 }),
    normalRangeTiles: Type.Integer({ minimum: 1 }),
    yellRangeTiles: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const RulesetLifecycleSchema = Type.Object(
  {
    itemDecayMs: Type.Integer({ minimum: 1000 }),
    unsafeLogoutDelayMs: Type.Integer({ minimum: 0 }),
    safeLogoutDelayMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const RulesetInternalSchema = Type.Object(
  {
    serialWarnPercent80: Type.Integer({ minimum: 1, maximum: 99 }),
    serialWarnPercent95: Type.Integer({ minimum: 1, maximum: 99 }),
    antiCheatSpeedToleranceMs: Type.Integer({ minimum: 0 }),
    maxTickDriftMs: Type.Integer({ minimum: 50 }),
  },
  { additionalProperties: false },
);

export const RulesetProfileSchema = Type.Object(
  {
    meta: RulesetMetaSchema,
    features: FeatureFlagsSchema,
    geometry: RulesetGeometrySchema,
    network: RulesetNetworkSchema,
    movement: RulesetMovementSchema,
    time: RulesetTimeSchema,
    character: RulesetCharacterSchema,
    inventory: RulesetInventorySchema,
    pvp: RulesetPvpSchema,
    speech: RulesetSpeechSchema,
    lifecycle: RulesetLifecycleSchema,
    internal: RulesetInternalSchema,
  },
  { additionalProperties: false },
);

export type RulesetProfile = Static<typeof RulesetProfileSchema>;

export const ShardRulesetOverrideSchema = Type.Object(
  {
    features: Type.Optional(Type.Partial(FeatureFlagsSchema, { additionalProperties: false })),
    geometry: Type.Optional(Type.Partial(RulesetGeometrySchema, { additionalProperties: false })),
    network: Type.Optional(Type.Partial(RulesetNetworkSchema, { additionalProperties: false })),
    movement: Type.Optional(Type.Partial(RulesetMovementSchema, { additionalProperties: false })),
    time: Type.Optional(Type.Partial(RulesetTimeSchema, { additionalProperties: false })),
    character: Type.Optional(Type.Partial(RulesetCharacterSchema, { additionalProperties: false })),
    inventory: Type.Optional(Type.Partial(RulesetInventorySchema, { additionalProperties: false })),
    pvp: Type.Optional(Type.Partial(RulesetPvpSchema, { additionalProperties: false })),
    speech: Type.Optional(Type.Partial(RulesetSpeechSchema, { additionalProperties: false })),
    lifecycle: Type.Optional(Type.Partial(RulesetLifecycleSchema, { additionalProperties: false })),
    internal: Type.Optional(Type.Partial(RulesetInternalSchema, { additionalProperties: false })),
  },
  { additionalProperties: false },
);

export type ShardRulesetOverride = Static<typeof ShardRulesetOverrideSchema>;

export const ClientRulesetSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(RULESET_SCHEMA_VERSION),
    profileDigest: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    era: Type.Literal("uor"),
    presetId: Type.String({ minLength: 1 }),
    features: FeatureFlagsSchema,
    geometry: RulesetGeometrySchema,
    network: RulesetNetworkSchema,
    movement: RulesetMovementSchema,
    time: RulesetTimeSchema,
    character: RulesetCharacterSchema,
    inventory: RulesetInventorySchema,
    pvp: RulesetPvpSchema,
    speech: RulesetSpeechSchema,
    lifecycle: RulesetLifecycleSchema,
  },
  { additionalProperties: false },
);

export type ClientRulesetSnapshot = Static<typeof ClientRulesetSnapshotSchema>;

export const FeatureFlagsValidator = TypeCompiler.Compile(FeatureFlagsSchema);
export const RulesetProfileValidator = TypeCompiler.Compile(RulesetProfileSchema);
export const ShardRulesetOverrideValidator = TypeCompiler.Compile(ShardRulesetOverrideSchema);
export const ClientRulesetSnapshotValidator = TypeCompiler.Compile(ClientRulesetSnapshotSchema);

export const KNOWN_FEATURE_FLAG_KEYS = new Set<string>(Object.keys(FeatureFlagsSchema.properties));
export const KNOWN_OVERRIDE_SECTION_KEYS = new Set<string>(
  Object.keys(ShardRulesetOverrideSchema.properties),
);
export const KNOWN_SECTION_FIELD_KEYS: Readonly<Record<string, ReadonlySet<string>>> =
  Object.freeze({
    features: KNOWN_FEATURE_FLAG_KEYS,
    geometry: new Set(Object.keys(RulesetGeometrySchema.properties)),
    network: new Set(Object.keys(RulesetNetworkSchema.properties)),
    movement: new Set(Object.keys(RulesetMovementSchema.properties)),
    time: new Set(Object.keys(RulesetTimeSchema.properties)),
    character: new Set(Object.keys(RulesetCharacterSchema.properties)),
    inventory: new Set(Object.keys(RulesetInventorySchema.properties)),
    pvp: new Set(Object.keys(RulesetPvpSchema.properties)),
    speech: new Set(Object.keys(RulesetSpeechSchema.properties)),
    lifecycle: new Set(Object.keys(RulesetLifecycleSchema.properties)),
    internal: new Set(Object.keys(RulesetInternalSchema.properties)),
  });
