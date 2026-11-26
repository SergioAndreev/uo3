import { canonicalJson, sha256 } from '@duskmarch/domain';
import type { Profile } from '../profile/presets.js';

/** Реэкспорт: реализация в `@duskmarch/domain` (P02, design D6). */
export { sha256 } from '@duskmarch/domain';

/** SHA-256 канонического JSON профиля. */
export const fingerprint = (profile: Profile): string => sha256(canonicalJson(profile));
