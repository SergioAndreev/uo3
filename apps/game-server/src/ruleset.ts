import { readRulesetOverride } from '@duskmarch/config/env/server';
import { isDomainError } from '@duskmarch/domain';
import { buildProfile, fingerprint, type Preset, type Profile } from '@duskmarch/rules';

export interface RulesetConfig {
  SHARD_RULESET_PRESET: Preset;
  SHARD_RULESET_FILE?: string | undefined;
}

export type RulesetResult =
  { ok: true; profile: Profile; fingerprint: string } | { ok: false; errors: string[] };

/** Профиль правил шарда: пресет, файл переопределения, проверка в `@duskmarch/rules`. */
export function loadRuleset(config: RulesetConfig): RulesetResult {
  try {
    const profile = buildProfile(
      config.SHARD_RULESET_PRESET,
      readRulesetOverride(config.SHARD_RULESET_FILE),
    );
    return { ok: true, profile, fingerprint: fingerprint(profile) };
  } catch (error) {
    if (isDomainError(error)) {
      const violations = error.details['violations'] as
        { path: string; message: string }[] | undefined;
      return {
        ok: false,
        errors: violations?.map((v) => `[${error.code}] ${v.path}: ${v.message}`) ?? [
          error.message,
        ],
      };
    }
    return { ok: false, errors: [(error as Error).message] };
  }
}
