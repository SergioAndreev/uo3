import { SKILL_BY_KEY } from '@duskmarch/domain';
import type { NameLists, SkillPick } from '@duskmarch/rules';
import {
  BASE_LOADOUT,
  NAME_LISTS,
  SCHOOL_LOADOUTS,
  START_CITIES,
  type LoadoutEntry,
} from './data.js';

export * from './data.js';

/** Списки для `nameViolations`: запрещённые слова — как зарезервированные. */
export const nameLists = (): NameLists => ({
  titles: NAME_LISTS.titles,
  reserved: [...NAME_LISTS.reserved, ...NAME_LISTS.forbidden],
});

export const startCity = (key: string) => START_CITIES.find((c) => c.key === key);

/** Описание стартового набора: базовый набор и наборы школ без повторов, порядок детерминирован. */
export function starterLoadout(skills: readonly SkillPick[]): LoadoutEntry[] {
  const schools: string[] = [];
  for (const { skill } of [...skills].sort(
    (a, b) => b.tenths - a.tenths || a.skill.localeCompare(b.skill),
  )) {
    const school = SKILL_BY_KEY.get(skill)?.school;
    if (school && !schools.includes(school)) schools.push(school);
  }
  const totals = new Map<string, LoadoutEntry>();
  for (const entry of [...BASE_LOADOUT, ...schools.flatMap((s) => SCHOOL_LOADOUTS[s] ?? [])]) {
    const prev = totals.get(entry.key);
    totals.set(entry.key, { ...entry, count: (prev?.count ?? 0) + entry.count });
  }
  return [...totals.values()];
}
