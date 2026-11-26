import type { SkillPick, StartStats } from '@duskmarch/rules';

export interface StartCity {
  readonly key: string;
  readonly name: string;
  /** Ключ плана из профиля правил. */
  readonly realm: string;
  readonly x: number;
  readonly y: number;
  readonly h: number;
  readonly description: string;
}

/**
 * Стартовые города. Точки Зари условны до карты Зари (P25);
 * `proving-camp` — ориентир `spawn` синтетического плана P02.
 */
export const START_CITIES: readonly StartCity[] = [
  {
    key: 'lad',
    name: 'Ладь',
    realm: 'dawn',
    x: 1180,
    y: 2140,
    h: 0,
    description: 'Порт на каналах',
  },
  {
    key: 'kremnev',
    name: 'Кремнёв',
    realm: 'dawn',
    x: 2020,
    y: 1660,
    h: 8,
    description: 'Город ремёсел',
  },
  {
    key: 'solyar',
    name: 'Соляр',
    realm: 'dawn',
    x: 2860,
    y: 2310,
    h: 4,
    description: 'Город наук',
  },
  {
    key: 'proving-camp',
    name: 'Испытательный лагерь',
    realm: 'proving',
    x: 32,
    y: 32,
    h: 0,
    description: 'Только шард разработки',
  },
];

export interface Background {
  readonly key: string;
  readonly name: string;
  readonly school: string;
  readonly stats: StartStats;
  readonly skills: readonly SkillPick[];
}

const pick = (skill: string, value: number): SkillPick => ({ skill, tenths: value * 10 });

/** Шесть предысторий — по одной на школу. */
export const BACKGROUNDS: readonly Background[] = [
  {
    key: 'mercenary',
    name: 'Наёмник',
    school: 'blade',
    stats: { might: 45, finesse: 30, will: 15 },
    skills: [pick('edge', 50), pick('tactics', 30), pick('ward', 20)],
  },
  {
    key: 'ranger',
    name: 'Следопыт',
    school: 'hunt',
    stats: { might: 30, finesse: 45, will: 15 },
    skills: [pick('archery', 50), pick('tracking', 30), pick('skinning', 20)],
  },
  {
    key: 'artisan',
    name: 'Ремесленник',
    school: 'craft',
    stats: { might: 45, finesse: 30, will: 15 },
    skills: [pick('smithing', 50), pick('mining', 30), pick('masonry', 20)],
  },
  {
    key: 'resonant',
    name: 'Созвучник',
    school: 'resonance',
    stats: { might: 15, finesse: 30, will: 45 },
    skills: [pick('heat', 50), pick('binding', 30), pick('lore', 20)],
  },
  {
    key: 'wayfarer',
    name: 'Странник',
    school: 'path',
    stats: { might: 30, finesse: 35, will: 25 },
    skills: [pick('foraging', 40), pick('angling', 30), pick('cooking', 30)],
  },
  {
    key: 'envoy',
    name: 'Посредник',
    school: 'society',
    stats: { might: 25, finesse: 30, will: 35 },
    skills: [pick('trade', 50), pick('oratory', 30), pick('mending', 20)],
  },
];

export interface LoadoutEntry {
  readonly key: string;
  readonly count: number;
}

/** Базовый набор каждого героя. */
export const BASE_LOADOUT: readonly LoadoutEntry[] = [
  { key: 'item.linen-shirt', count: 1 },
  { key: 'item.linen-trousers', count: 1 },
  { key: 'item.travel-boots', count: 1 },
  { key: 'item.satchel', count: 1 },
  { key: 'item.rye-bread', count: 3 },
  { key: 'item.copper-coin', count: 100 },
];

/** Наборы школ стартовых навыков. */
export const SCHOOL_LOADOUTS: Readonly<Record<string, readonly LoadoutEntry[]>> = {
  blade: [
    { key: 'item.short-blade', count: 1 },
    { key: 'item.buckler', count: 1 },
  ],
  hunt: [
    { key: 'item.hunting-bow', count: 1 },
    { key: 'item.arrow', count: 30 },
    { key: 'item.skinning-knife', count: 1 },
  ],
  craft: [
    { key: 'item.hammer', count: 1 },
    { key: 'item.tongs', count: 1 },
    { key: 'item.iron-ingot', count: 10 },
  ],
  resonance: [
    { key: 'item.tuning-fork', count: 1 },
    { key: 'item.chalk', count: 5 },
  ],
  path: [
    { key: 'item.pickaxe', count: 1 },
    { key: 'item.fishing-line', count: 1 },
    { key: 'item.waterskin', count: 1 },
  ],
  society: [
    { key: 'item.ledger', count: 1 },
    { key: 'item.quill', count: 1 },
    { key: 'item.bandage', count: 10 },
  ],
};

/** Имена: служебные титулы, имена лора, запрещённые слова. */
export const NAME_LISTS = {
  titles: [
    'Помощник',
    'Модератор',
    'Ведущий',
    'Админ',
    'Администратор',
    'Хранитель',
    'Владелец',
    'GM',
    'Admin',
    'Mod',
    'Staff',
  ],
  reserved: ['Эйра', 'Заря', 'Марь', 'Ладь', 'Кремнёв', 'Соляр', 'Duskmarch', 'Система', 'System'],
  /** Запрещённые слова; список пополняется модерацией (P26). */
  forbidden: ['Дурак', 'Идиот', 'Тупица'],
} as const;
