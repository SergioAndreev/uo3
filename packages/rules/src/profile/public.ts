import { cloneJson } from './clone.js';
import { deepFreeze, type DeepReadonly } from '@duskmarch/domain';
import { fingerprint } from '../fingerprint/index.js';
import type { RulesetProfile } from './schema.js';
import type { Profile } from './presets.js';

/** Поля, которые клиент не получает. */
export const SERVER_ONLY = ['reputation', 'limits'] as const;
export type PublicProfile = DeepReadonly<Omit<RulesetProfile, (typeof SERVER_ONLY)[number]>> & {
  readonly fingerprint: string;
};

export function publicProfile(profile: Profile): PublicProfile {
  const copy = cloneJson(profile) as Partial<RulesetProfile>;
  for (const key of SERVER_ONLY) delete copy[key];
  return deepFreeze({ ...copy, fingerprint: fingerprint(profile) }) as PublicProfile;
}
