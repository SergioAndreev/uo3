import { cloneJson } from './clone.js';
import {
  BUILTIN_REALMS,
  DUSK_LIGHT,
  DAWN_LIGHT,
  deepFreeze,
  type DeepReadonly,
} from '@duskmarch/domain';
import { FEATURE_FLAGS, type RulesetProfile } from './schema.js';

export const PRESETS = ['standard', 'proving'] as const;
export type Preset = (typeof PRESETS)[number];
export type Profile = DeepReadonly<RulesetProfile>;

const realm = (key: string) => {
  const found = BUILTIN_REALMS.find((r) => r.key === key);
  if (!found) throw new Error(`план ${key} отсутствует в домене`);
  return { ...found };
};

/** Значения ARCHITECTURE §5. Любое изменение значения по умолчанию повышает `version`. */
export const STANDARD: RulesetProfile = {
  id: 'duskmarch',
  version: 2,
  preset: 'standard',
  space: { heightStepMm: 250, sectorSize: 16, chunkSize: 32 },
  realms: [realm('dawn'), realm('dusk')],
  interest: { radius: 20, largeRadius: 32 },
  movement: {
    walkMs: 360,
    runMs: 220,
    mountedWalkMs: 250,
    mountedRunMs: 150,
    window: 4,
    sequenceModulo: 256,
    heroHeightSteps: 7,
    climbSteps: 2,
  },
  time: { tickMs: 50, gameHourMs: 240_000 },
  stats: { min: 10, max: 120, totalCap: 240 },
  skills: { maxTenths: 1_000, totalCapTenths: 6_000 },
  creation: {
    statPool: 90,
    statMin: 10,
    statMax: 60,
    skillPoolTenths: 1_000,
    skillMinTenths: 100,
    skillMaxTenths: 500,
    maxStartSkills: 3,
    skillFeatures: { sailing: 'seafaring', beaconry: 'beaconTravel', taming: 'mounts' },
  },
  inventory: { packSlots: 80 },
  speech: { whisper: 2, normal: 14, shout: 24 },
  light: { dawn: { ...DAWN_LIGHT }, dusk: { ...DUSK_LIGHT } },
  features: Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag, true]),
  ) as RulesetProfile['features'],
  reputation: { offenderMs: 300_000, outcastKills: 4, outcastDecayMs: 43_200_000 },
  limits: { groundDecayMs: 2_700_000, logoutDelayMs: 120_000 },
};

/** Испытательный пресет: только план `proving`, время в 10 раз быстрее. */
export const PROVING: RulesetProfile = {
  ...STANDARD,
  preset: 'proving',
  realms: [realm('proving')],
  time: { ...STANDARD.time, gameHourMs: STANDARD.time.gameHourMs / 10 },
  light: { proving: { min: 40, max: 80 } },
  creation: { ...STANDARD.creation, skillPoolTenths: 2_000, skillMaxTenths: 1_000 },
};

export const presetProfile = (preset: Preset): RulesetProfile =>
  cloneJson(preset === 'proving' ? PROVING : STANDARD);

export const DUSKMARCH: Profile = deepFreeze(presetProfile('standard'));
