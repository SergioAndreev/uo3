export type LightPhase = 'ebb' | 'rise' | 'crest' | 'fall';

export interface LightRange {
  readonly min: number;
  readonly max: number;
}
export const DAWN_LIGHT: LightRange = Object.freeze({ min: 25, max: 85 });
export const DUSK_LIGHT: LightRange = Object.freeze({ min: 10, max: 50 });

/** Фаза по минуте суток: Эйра не вращается относительно звезды, свет качается. */
export function lightPhase(minuteOfDay: number): LightPhase {
  const p = minuteOfDay;
  if (p < 180 || p >= 1_260) return 'ebb';
  if (p < 540) return 'rise';
  if (p < 900) return 'crest';
  return 'fall';
}

/** Треугольная волна от `min` при `p = 0` до `max` при `p = 720`. */
export const lightLevel = ({ min, max }: LightRange, minuteOfDay: number): number =>
  min + Math.floor(((max - min) * (720 - Math.abs(minuteOfDay - 720))) / 720);
