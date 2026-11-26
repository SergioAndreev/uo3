import { cloneJson } from '../profile/clone.js';
import { Value } from '@sinclair/typebox/value';
import { DomainError, deepFreeze } from '@duskmarch/domain';
import { FEATURE_FLAGS, RulesetProfileSchema, type RulesetProfile } from '../profile/schema.js';
import { PRESETS, presetProfile, type Preset, type Profile } from '../profile/presets.js';

export interface Violation {
  path: string;
  message: string;
}

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Объекты сливаются по ключам, массивы и значения заменяются. */
function merge(base: Plain, patch: Plain): Plain {
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = isPlain(value) && isPlain(base[key]) ? merge(base[key], value) : cloneJson(value);
  }
  return out;
}

export function invariants(p: RulesetProfile): Violation[] {
  const v: Violation[] = [];
  const need = (ok: boolean, path: string, message: string): void => {
    if (!ok) v.push({ path, message });
  };
  const m = p.movement;
  need(m.runMs < m.walkMs, 'movement.runMs', `бег ${m.runMs} мс не быстрее ходьбы ${m.walkMs} мс`);
  need(
    m.mountedRunMs < m.mountedWalkMs,
    'movement.mountedRunMs',
    'бег верхом не быстрее шага верхом',
  );
  for (const key of ['walkMs', 'runMs', 'mountedWalkMs', 'mountedRunMs'] as const) {
    need(m[key] >= p.time.tickMs, `movement.${key}`, `меньше тика ${p.time.tickMs} мс`);
  }
  const s = p.stats;
  need(s.min <= s.max, 'stats.min', 'минимум больше максимума');
  need(
    s.min * 3 <= s.totalCap && s.totalCap <= s.max * 3,
    'stats.totalCap',
    `кап ${s.totalCap} вне ${s.min * 3}..${s.max * 3}`,
  );
  need(
    p.skills.maxTenths <= p.skills.totalCapTenths,
    'skills.maxTenths',
    'навык больше общего капа',
  );
  need(
    p.interest.radius <= p.interest.largeRadius,
    'interest.largeRadius',
    'меньше обычного радиуса',
  );
  need(
    p.speech.whisper <= p.speech.normal && p.speech.normal <= p.speech.shout,
    'speech',
    'шёпот ≤ речь ≤ крик',
  );
  const ids = p.realms.map((r) => r.id);
  need(new Set(ids).size === ids.length, 'realms', 'повторяющийся id плана');
  for (const realm of p.realms) {
    const light = p.light[realm.key];
    need(light !== undefined, `light.${realm.key}`, 'нет диапазона света плана');
    if (light) need(light.min <= light.max, `light.${realm.key}.min`, 'минимум больше максимума');
  }
  return v;
}

/** Пресет → переопределение → схема → инварианты → заморозка. */
export function buildProfile(preset: Preset = 'standard', override: unknown = {}): Profile {
  if (!(PRESETS as readonly string[]).includes(preset)) {
    throw new DomainError('ERR_RULESET_SCHEMA', `неизвестный пресет ${String(preset)}`, {
      fieldPath: 'preset',
    });
  }
  if (!isPlain(override))
    throw new DomainError('ERR_RULESET_SCHEMA', 'переопределение должно быть объектом');
  const features = override['features'];
  if (isPlain(features)) {
    const unknown = Object.keys(features).filter(
      (flag) => !(FEATURE_FLAGS as readonly string[]).includes(flag),
    );
    if (unknown.length > 0) {
      throw new DomainError(
        'ERR_UNKNOWN_FEATURE_FLAG',
        `неизвестные флаги: ${unknown.join(', ')}`,
        {
          fieldPath: `features.${unknown[0] ?? ''}`,
          details: { flags: unknown },
        },
      );
    }
  }
  for (const locked of ['id', 'preset']) {
    if (locked in override) {
      throw new DomainError('ERR_RULESET_SCHEMA', `${locked} задаётся пресетом`, {
        fieldPath: locked,
      });
    }
  }
  const merged = merge(presetProfile(preset) as unknown as Plain, override);
  if (!Value.Check(RulesetProfileSchema, merged)) {
    const violations = [...Value.Errors(RulesetProfileSchema, merged)].map((e) => ({
      path: e.path.slice(1).replaceAll('/', '.'),
      message: e.message,
    }));
    throw new DomainError(
      'ERR_RULESET_SCHEMA',
      violations.map((x) => `${x.path}: ${x.message}`).join('; '),
      {
        details: { violations },
      },
    );
  }
  const violations = invariants(merged);
  if (violations.length > 0) {
    throw new DomainError(
      'ERR_RULESET_INVARIANT',
      violations.map((x) => `${x.path}: ${x.message}`).join('; '),
      {
        details: { violations },
      },
    );
  }
  return deepFreeze(merged);
}

export const isRealmAvailable = (profile: Profile, key: string): boolean =>
  profile.realms.some((realm) => realm.key === key) &&
  !(key === 'dusk' && !profile.features.realmDusk);
