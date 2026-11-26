import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDomainError, type DomainErrorCode } from '@duskmarch/domain';
import { expect, it } from 'vitest';
import {
  DUSKMARCH,
  STANDARD,
  buildProfile,
  carryCapacityKg,
  checkSkills,
  checkStats,
  fingerprint,
  invariants,
  isRealmAvailable,
  publicProfile,
  sha256,
  stepMs,
  vitals,
} from './index.js';

const fails = (
  fn: () => unknown,
  code: DomainErrorCode,
): { details: Record<string, unknown>; fieldPath?: string } => {
  try {
    fn();
  } catch (error) {
    expect(isDomainError(error, code), String(error)).toBe(true);
    return error as never;
  }
  throw new Error(`ожидалась ${code}`);
};

it('профиль duskmarch совпадает с ARCHITECTURE §5', () => {
  const doc = readFileSync(new URL('../../../docs/ARCHITECTURE.md', import.meta.url), 'utf8');
  const row = (name: string) => doc.split('\n').find((line) => line.startsWith(`| ${name}`)) ?? '';
  expect(row('Скорость шага')).toContain(
    `ходьба ${DUSKMARCH.movement.walkMs} мс, бег ${DUSKMARCH.movement.runMs} мс`,
  );
  expect(row('Скорость шага')).toContain(
    `${DUSKMARCH.movement.mountedWalkMs} / ${DUSKMARCH.movement.mountedRunMs} мс`,
  );
  expect(row('Тик')).toContain(`${DUSKMARCH.time.tickMs} мс`);
  expect(row('Игровой цикл')).toContain(`${DUSKMARCH.time.gameHourMs / 60_000} реальные минуты`);
  expect(row('Кап характеристик')).toContain(
    `${DUSKMARCH.stats.totalCap} / ${DUSKMARCH.skills.totalCapTenths / 10}`,
  );
  expect(row('Радиус обновления')).toContain(
    `${DUSKMARCH.interest.radius} клеток, крупные постройки — ${DUSKMARCH.interest.largeRadius}`,
  );
  expect(row('Сектор')).toContain(`${DUSKMARCH.space.sectorSize}×${DUSKMARCH.space.sectorSize}`);
  expect(row('Рюкзак')).toContain(`${DUSKMARCH.inventory.packSlots} ячеек`);
  expect(row('Дальность речи')).toContain(
    `шёпот ${DUSKMARCH.speech.whisper}, обычная ${DUSKMARCH.speech.normal}, крик ${DUSKMARCH.speech.shout}`,
  );
  expect(row('Распад')).toContain(`${DUSKMARCH.limits.groundDecayMs / 60_000} мин`);
  expect(row('Задержка выхода')).toContain(`${DUSKMARCH.limits.logoutDelayMs / 60_000} мин`);
  expect(row('Метка нарушителя')).toContain(
    `${DUSKMARCH.reputation.offenderMs / 60_000} мин / ≥ ${DUSKMARCH.reputation.outcastKills}`,
  );
  expect(row('Метка нарушителя')).toContain(`${DUSKMARCH.reputation.outcastDecayMs / 3_600_000} ч`);
  expect(row('Номер последовательности')).toContain(
    `0–${DUSKMARCH.movement.sequenceModulo - 1}, окно до ${DUSKMARCH.movement.window}`,
  );
  expect(row('Планы')).toContain('4096×4096');
  expect(DUSKMARCH.skills.totalCapTenths).toBe(6000);
  expect(invariants(STANDARD)).toEqual([]);
});

it('профиль неизменяем', () => {
  expect(() => {
    (DUSKMARCH.stats as { totalCap: number }).totalCap = 1;
  }).toThrow(TypeError);
});

it('флаги функций', () => {
  const profile = buildProfile('standard', { features: { realmDusk: false } });
  expect(isRealmAvailable(profile, 'dusk')).toBe(false);
  expect(isRealmAvailable(profile, 'dawn')).toBe(true);
  expect(profile.features.mounts).toBe(true);
  const error = fails(
    () => buildProfile('standard', { features: { flying: true } }),
    'ERR_UNKNOWN_FEATURE_FLAG',
  );
  expect(error.fieldPath).toBe('features.flying');
});

it('пресет proving', () => {
  const profile = buildProfile('proving');
  expect(profile.time.gameHourMs).toBe(24_000);
  expect(profile.realms.map((r) => r.key)).toEqual(['proving']);
  expect(isRealmAvailable(profile, 'dawn')).toBe(false);
});

it('все нарушения инвариантов одним списком', () => {
  const error = fails(
    () => buildProfile('standard', { movement: { runMs: 400 }, stats: { totalCap: 20 } }),
    'ERR_RULESET_INVARIANT',
  );
  const paths = (error.details['violations'] as { path: string }[]).map((v) => v.path);
  expect(paths).toEqual(['movement.runMs', 'stats.totalCap']);
});

it.each([
  [{ movement: { mountedRunMs: 300 } }, 'movement.mountedRunMs'],
  [{ movement: { mountedRunMs: 20, runMs: 30 } }, 'movement.runMs'],
  [{ stats: { totalCap: 400 } }, 'stats.totalCap'],
  [{ stats: { min: 200 } }, 'stats.min'],
  [{ skills: { maxTenths: 7000 } }, 'skills.maxTenths'],
  [{ interest: { radius: 40 } }, 'interest.largeRadius'],
  [{ speech: { whisper: 20 } }, 'speech'],
  [{ light: { dawn: { min: 90, max: 10 } } }, 'light.dawn.min'],
  [{ realms: [...STANDARD.realms, { ...STANDARD.realms[0] }] }, 'realms'],
  [{ realms: [...STANDARD.realms, { ...STANDARD.realms[0], id: 9, key: 'rift' }] }, 'light.rift'],
])('инвариант %j', (override, path) => {
  const error = fails(() => buildProfile('standard', override), 'ERR_RULESET_INVARIANT');
  expect((error.details['violations'] as { path: string }[]).map((v) => v.path)).toContain(path);
});

it('ошибки схемы', () => {
  fails(() => buildProfile('standard', { movement: { walkMs: 'быстро' } }), 'ERR_RULESET_SCHEMA');
  fails(() => buildProfile('standard', { unknown: 1 }), 'ERR_RULESET_SCHEMA');
  fails(() => buildProfile('standard', { id: 'other' }), 'ERR_RULESET_SCHEMA');
  fails(() => buildProfile('standard', []), 'ERR_RULESET_SCHEMA');
  fails(() => buildProfile('fast' as never), 'ERR_RULESET_SCHEMA');
});

it('корректное переопределение', () => {
  const profile = buildProfile('standard', {
    limits: { groundDecayMs: 1_800_000 },
    speech: undefined,
  });
  expect(profile.limits.groundDecayMs).toBe(1_800_000);
  expect({ ...profile, limits: STANDARD.limits }).toEqual(STANDARD);
  expect(STANDARD.limits.groundDecayMs).toBe(2_700_000);
});

it('SHA-256 по векторам FIPS 180-4', () => {
  expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
  expect(sha256('a'.repeat(1_000_000))).toBe(
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  );
});

it('SHA-256 совпадает с node:crypto', () => {
  for (let i = 0; i < 1000; i++) {
    const bytes = new Uint8Array(randomBytes(i % 200));
    expect(sha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  }
  expect(sha256('Эйра')).toBe(createHash('sha256').update('Эйра').digest('hex'));
});

it('отпечаток не зависит от порядка ключей и меняется со значением', () => {
  const a = buildProfile('standard', {
    features: { mounts: false, housing: true },
    limits: { logoutDelayMs: 1 },
  });
  const b = buildProfile('standard', {
    limits: { logoutDelayMs: 1 },
    features: { housing: true, mounts: false },
  });
  expect(fingerprint(a)).toBe(fingerprint(b));
  expect(fingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  expect(fingerprint(buildProfile('standard', { movement: { walkMs: 350 } }))).not.toBe(
    fingerprint(DUSKMARCH),
  );
});

it('публичный срез без серверных полей', () => {
  const slice = publicProfile(DUSKMARCH);
  expect(slice).toHaveProperty('movement');
  expect(slice).toHaveProperty('features');
  expect(slice).not.toHaveProperty('reputation');
  expect(slice).not.toHaveProperty('limits');
  expect(slice.fingerprint).toBe(fingerprint(DUSKMARCH));
  expect(Object.isFrozen(slice.movement)).toBe(true);
});

it('ресурсы героя и вес', () => {
  expect(vitals({ might: 85, finesse: 90, will: 65 })).toEqual({
    health: 111,
    verve: 112,
    resonance: 92,
    carryKg: 177,
  });
});

it('формулы целочисленны на всём диапазоне', () => {
  for (let v = 10; v <= 120; v++) {
    const r = vitals({ might: v, finesse: v, will: v });
    for (const value of Object.values(r)) expect(Number.isInteger(value)).toBe(true);
    expect(carryCapacityKg({ might: v, finesse: 0, will: 0 })).toBe(50 + Math.floor(v * 1.5));
  }
});

it('длительность шага', () => {
  expect(stepMs(DUSKMARCH, 'walk')).toBe(360);
  expect(stepMs(DUSKMARCH, 'run')).toBe(220);
  expect(stepMs(DUSKMARCH, 'walk', true)).toBe(250);
  expect(stepMs(DUSKMARCH, 'run', true)).toBe(150);
});

it('капы характеристик и навыков', () => {
  expect(checkStats(DUSKMARCH, { might: 100, finesse: 100, will: 41 })).toEqual([
    'сумма 241 больше капа 240',
  ]);
  expect(checkStats(DUSKMARCH, { might: 100, finesse: 100, will: 40 })).toEqual([]);
  expect(checkStats(DUSKMARCH, { might: 9, finesse: 121, will: 50 })).toHaveLength(2);
  expect(checkSkills(DUSKMARCH, [1000, 1000, 1000, 1000, 1000, 1000])).toEqual([]);
  expect(checkSkills(DUSKMARCH, [1000, 1000, 1000, 1000, 1000, 1000, 1])).toEqual([
    'сумма 6001 больше капа 6000',
  ]);
  expect(checkSkills(DUSKMARCH, [1001, -1])).toHaveLength(2);
});
