import { SKILLS, STATS, type Stat } from '@duskmarch/domain';
import type { Profile } from '../profile/presets.js';

export type StartStats = Readonly<Record<Stat, number>>;
export interface SkillPick {
  readonly skill: string;
  readonly tenths: number;
}

/** Нарушения стартовых характеристик; пустой список — допустимо. */
export function creationStatViolations(profile: Profile, stats: StartStats): string[] {
  const { statPool, statMin, statMax } = profile.creation;
  const errors: string[] = [];
  for (const stat of STATS) {
    const value = stats[stat];
    if (!Number.isInteger(value) || value < statMin || value > statMax) {
      errors.push(`${stat}: ${String(value)} вне ${statMin}..${statMax}`);
    }
  }
  const total = STATS.reduce((sum, stat) => sum + (stats[stat] ?? 0), 0);
  if (total !== statPool) errors.push(`сумма ${total} ≠ пулу ${statPool}`);
  return errors;
}

/** Навыки, доступные при создании с учётом флагов функций шарда. */
export function availableStartSkills(profile: Profile): string[] {
  const requires = profile.creation.skillFeatures as Readonly<
    Record<string, keyof Profile['features']>
  >;
  return SKILLS.map((s) => s.key).filter((key) => {
    const flag = requires[key];
    return flag === undefined || profile.features[flag];
  });
}

/** Нарушения набора стартовых навыков (десятые доли). */
export function startSkillViolations(profile: Profile, picks: readonly SkillPick[]): string[] {
  const c = profile.creation;
  const errors: string[] = [];
  if (picks.length < 1 || picks.length > c.maxStartSkills) {
    errors.push(`навыков ${picks.length}, нужно 1..${c.maxStartSkills}`);
  }
  const allowed = new Set(availableStartSkills(profile));
  const seen = new Set<string>();
  for (const { skill, tenths } of picks) {
    if (seen.has(skill)) errors.push(`${skill}: повтор`);
    seen.add(skill);
    if (!allowed.has(skill)) errors.push(`${skill}: недоступен при создании`);
    if (!Number.isInteger(tenths) || tenths < c.skillMinTenths || tenths > c.skillMaxTenths) {
      errors.push(`${skill}: ${String(tenths)} вне ${c.skillMinTenths}..${c.skillMaxTenths}`);
    }
  }
  const total = picks.reduce((sum, p) => sum + p.tenths, 0);
  if (total !== c.skillPoolTenths) errors.push(`сумма ${total} ≠ пулу ${c.skillPoolTenths}`);
  return errors;
}

export const FAST_DELETE_MS = 10 * 60_000;
export const SLOW_DELETE_MS = 72 * 3_600_000;
const YOUNG_MS = 7 * 86_400_000;
const DEVELOPED_TENTHS = 1_200;

/** Развит ли герой: старше 7 суток или сумма навыков от 120,0. */
export const isDeveloped = (ageMs: number, skillTotalTenths: number): boolean =>
  ageMs >= YOUNG_MS || skillTotalTenths >= DEVELOPED_TENTHS;

/** Срок до окончательного удаления. */
export const deletionGraceMs = (ageMs: number, skillTotalTenths: number): number =>
  isDeveloped(ageMs, skillTotalTenths) ? SLOW_DELETE_MS : FAST_DELETE_MS;

export * from './names.js';
