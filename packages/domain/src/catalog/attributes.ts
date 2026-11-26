export const STATS = ['might', 'finesse', 'will'] as const;
export type Stat = (typeof STATS)[number];
export const STAT_NAMES: Readonly<Record<Stat, string>> = {
  might: 'Мощь',
  finesse: 'Сноровка',
  will: 'Воля',
};

export const RESOURCES = ['health', 'verve', 'resonance'] as const;
export type Resource = (typeof RESOURCES)[number];
export const RESOURCE_NAMES: Readonly<Record<Resource, string>> = {
  health: 'Здоровье',
  verve: 'Запал',
  resonance: 'Созвучие',
};
