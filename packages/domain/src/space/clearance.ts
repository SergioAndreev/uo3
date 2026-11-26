export const HERO_HEIGHT_STEPS = 7;
export const CLIMB_STEPS = 2;

/** Можно ли шагнуть с высоты `from` на `to`; спуск не ограничен этой проверкой. */
export const canClimb = (from: number, to: number, climb = CLIMB_STEPS): boolean =>
  to - from <= climb;

/** Помещается ли сущность ростом `height` между полом и препятствием над ним. */
export const fitsUnder = (floor: number, ceiling: number, height = HERO_HEIGHT_STEPS): boolean =>
  ceiling - floor >= height;
