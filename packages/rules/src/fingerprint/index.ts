import { canonicalJson } from '@duskmarch/domain';
import type { Profile } from '../profile/presets.js';
import { sha256 } from './sha256.js';

export { sha256 } from './sha256.js';

/** SHA-256 канонического JSON профиля. */
export const fingerprint = (profile: Profile): string => sha256(canonicalJson(profile));
