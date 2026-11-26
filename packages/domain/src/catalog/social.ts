export const REPUTATIONS = ['neutral', 'ally', 'offender', 'outcast', 'enemy'] as const;
export type Reputation = (typeof REPUTATIONS)[number];
export const REPUTATION_NAMES: Readonly<Record<Reputation, string>> = {
  neutral: 'Нейтрален',
  ally: 'Союзник',
  offender: 'Нарушитель',
  outcast: 'Изгой',
  enemy: 'Враг',
};

export const ACCESS_LEVELS = [
  'player',
  'helper',
  'moderator',
  'game-master',
  'administrator',
  'owner',
] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Не ниже ли уровень `actual` требуемого. */
export const hasAccess = (actual: AccessLevel, required: AccessLevel): boolean =>
  ACCESS_LEVELS.indexOf(actual) >= ACCESS_LEVELS.indexOf(required);
