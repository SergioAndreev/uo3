import type { Stat } from '@duskmarch/domain';
import type { Profile } from '../profile/presets.js';

export type Stats = Readonly<Record<Stat, number>>;

/** `base + floor(value × hundredths / 100)`: только целая арифметика. */
const scaled = (base: number, value: number, hundredths: number): number =>
  base + Math.floor((value * hundredths) / 100);

export const maxHealth = (s: Stats): number => scaled(60, s.might, 60);
export const maxVerve = (s: Stats): number => scaled(40, s.finesse, 80);
export const maxResonance = (s: Stats): number => scaled(40, s.will, 80);
/** Переносимый вес, кг. */
export const carryCapacityKg = (s: Stats): number => scaled(50, s.might, 150);

export const vitals = (s: Stats) => ({
  health: maxHealth(s),
  verve: maxVerve(s),
  resonance: maxResonance(s),
  carryKg: carryCapacityKg(s),
});

export const stepMs = (profile: Profile, mode: 'walk' | 'run', mounted = false): number => {
  const m = profile.movement;
  if (mounted) return mode === 'run' ? m.mountedRunMs : m.mountedWalkMs;
  return mode === 'run' ? m.runMs : m.walkMs;
};

/** Нарушения капов характеристик; пустой список — набор допустим. */
export function checkStats(profile: Profile, s: Stats): string[] {
  const { min, max, totalCap } = profile.stats;
  const errors = (Object.entries(s) as [Stat, number][])
    .filter(([, value]) => !Number.isInteger(value) || value < min || value > max)
    .map(([stat, value]) => `${stat} = ${value} вне ${min}..${max}`);
  const total = s.might + s.finesse + s.will;
  if (total > totalCap) errors.push(`сумма ${total} больше капа ${totalCap}`);
  return errors;
}

/** Нарушения капов навыков (значения в десятых долях). */
export function checkSkills(profile: Profile, values: readonly number[]): string[] {
  const { maxTenths, totalCapTenths } = profile.skills;
  const errors = values
    .filter((v) => !Number.isInteger(v) || v < 0 || v > maxTenths)
    .map((v) => `навык ${v} вне 0..${maxTenths}`);
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total > totalCapTenths) errors.push(`сумма ${total} больше капа ${totalCapTenths}`);
  return errors;
}
