import { DomainError } from '../errors/index.js';
import { deepFreeze } from '../util/index.js';

export const SCHOOLS = ['blade', 'hunt', 'craft', 'resonance', 'path', 'society'] as const;
export type School = (typeof SCHOOLS)[number];
export const SCHOOL_NAMES: Readonly<Record<School, string>> = {
  blade: 'Клинок',
  hunt: 'Охота',
  craft: 'Ремесло',
  resonance: 'Созвучие',
  path: 'Путь',
  society: 'Общество',
};

export interface SkillInfo {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly school: School;
}

const TABLE: Record<School, [string, string][]> = {
  blade: [
    ['edge', 'Клинки'],
    ['haft', 'Древковое оружие'],
    ['maul', 'Дробящее оружие'],
    ['ward', 'Щит'],
    ['brawl', 'Кулачный бой'],
    ['tactics', 'Тактика'],
  ],
  hunt: [
    ['archery', 'Стрельба'],
    ['tracking', 'Следопытство'],
    ['trapping', 'Ловушки'],
    ['taming', 'Приручение'],
    ['skinning', 'Свежевание'],
    ['stealth', 'Скрытность'],
  ],
  craft: [
    ['smithing', 'Кузнечное дело'],
    ['joinery', 'Столярное дело'],
    ['weaving', 'Ткачество'],
    ['brewing', 'Зельеварение'],
    ['cooking', 'Кулинария'],
    ['masonry', 'Каменное дело'],
  ],
  resonance: [
    ['heat', 'Жар'],
    ['frost', 'Стужа'],
    ['stone', 'Камень'],
    ['wind', 'Ветер'],
    ['light', 'Свет'],
    ['binding', 'Сплетение'],
  ],
  path: [
    ['mining', 'Горное дело'],
    ['felling', 'Лесорубство'],
    ['foraging', 'Собирательство'],
    ['angling', 'Рыболовство'],
    ['sailing', 'Мореходство'],
    ['beaconry', 'Маячное дело'],
  ],
  society: [
    ['trade', 'Торговля'],
    ['mending', 'Врачевание'],
    ['lore', 'Знание'],
    ['oratory', 'Красноречие'],
    ['music', 'Музыка'],
    ['stewardship', 'Хозяйство'],
  ],
};

/** Id неизменны: новые навыки получают новые id, удалённые не переиспользуются. */
export const SKILLS: readonly SkillInfo[] = deepFreeze(
  SCHOOLS.flatMap((school, s) =>
    TABLE[school].map(([key, name], i) => ({ id: s * 6 + i, key, name, school })),
  ),
);
export const SKILL_BY_KEY: ReadonlyMap<string, SkillInfo> = new Map(
  SKILLS.map((skill) => [skill.key, skill]),
);

export const skillByKey = (key: string): SkillInfo | undefined => SKILL_BY_KEY.get(key);

/** Десятые доли: 0..1000 соответствует 0,0–100,0. */
export type SkillTenths = number & { readonly __skillTenths: true };
export const MAX_SKILL_TENTHS = 1_000;

export function skillTenths(value: number): SkillTenths {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SKILL_TENTHS) {
    throw new DomainError('ERR_SKILL_VALUE_OUT_OF_RANGE', `${value} вне 0..${MAX_SKILL_TENTHS}`);
  }
  return value as SkillTenths;
}

export const SKILL_MODES = ['grow', 'keep', 'yield'] as const;
export type SkillMode = (typeof SKILL_MODES)[number];
