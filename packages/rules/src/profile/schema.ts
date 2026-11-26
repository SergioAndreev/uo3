import { Type, type Static } from '@sinclair/typebox';

const Int = (minimum: number, maximum: number) => Type.Integer({ minimum, maximum });
const strict = { additionalProperties: false } as const;
const LightRange = Type.Object({ min: Int(0, 100), max: Int(0, 100) }, strict);

export const FEATURE_FLAGS = [
  'realmDusk',
  'mounts',
  'housing',
  'seafaring',
  'beaconTravel',
  'playerBounties',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const RealmSchema = Type.Object(
  {
    id: Int(0, 255),
    key: Type.String({ pattern: '^[a-z][a-z0-9-]*$' }),
    name: Type.String({ minLength: 1 }),
    width: Int(1, 65_536),
    height: Int(1, 65_536),
    pvp: Type.Union([Type.Literal('consent'), Type.Literal('open')]),
    testOnly: Type.Boolean(),
  },
  strict,
);

export const RulesetProfileSchema = Type.Object(
  {
    id: Type.Literal('duskmarch'),
    version: Int(1, 1_000_000),
    preset: Type.Union([Type.Literal('standard'), Type.Literal('proving')]),
    space: Type.Object(
      { heightStepMm: Int(1, 10_000), sectorSize: Int(1, 256), chunkSize: Int(1, 256) },
      strict,
    ),
    realms: Type.Array(RealmSchema, { minItems: 1 }),
    interest: Type.Object({ radius: Int(1, 64), largeRadius: Int(1, 128) }, strict),
    movement: Type.Object(
      {
        walkMs: Int(1, 10_000),
        runMs: Int(1, 10_000),
        mountedWalkMs: Int(1, 10_000),
        mountedRunMs: Int(1, 10_000),
        window: Int(1, 32),
        sequenceModulo: Int(2, 65_536),
        heroHeightSteps: Int(1, 64),
        climbSteps: Int(0, 64),
      },
      strict,
    ),
    time: Type.Object({ tickMs: Int(1, 1_000), gameHourMs: Int(1_000, 86_400_000) }, strict),
    stats: Type.Object({ min: Int(0, 1_000), max: Int(1, 1_000), totalCap: Int(1, 3_000) }, strict),
    skills: Type.Object({ maxTenths: Int(1, 10_000), totalCapTenths: Int(1, 360_000) }, strict),
    inventory: Type.Object({ packSlots: Int(1, 1_000) }, strict),
    speech: Type.Object({ whisper: Int(0, 64), normal: Int(0, 64), shout: Int(0, 64) }, strict),
    light: Type.Record(Type.String({ pattern: '^[a-z][a-z0-9-]*$' }), LightRange),
    features: Type.Object(
      Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, Type.Boolean()])) as Record<
        FeatureFlag,
        ReturnType<typeof Type.Boolean>
      >,
      strict,
    ),
    reputation: Type.Object(
      {
        offenderMs: Int(0, 86_400_000),
        outcastKills: Int(1, 1_000),
        outcastDecayMs: Int(0, 2_592_000_000),
      },
      strict,
    ),
    limits: Type.Object(
      { groundDecayMs: Int(0, 604_800_000), logoutDelayMs: Int(0, 3_600_000) },
      strict,
    ),
  },
  strict,
);

export type RulesetProfile = Static<typeof RulesetProfileSchema>;
export type Realm = Static<typeof RealmSchema>;
