export const DEFAULT_GAME_HOUR_MS = 240_000;
export const MINUTES_PER_DAY = 1_440;

export interface GameTime {
  /** Номер игровых суток с нуля. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** Минута суток `0..1439`. */
  readonly minuteOfDay: number;
}

/** Игровое время от эпохи мира; длительность часа задаёт профиль правил. */
export function gameTime(nowMs: number, epochMs = 0, gameHourMs = DEFAULT_GAME_HOUR_MS): GameTime {
  const total = Math.floor((Math.max(0, nowMs - epochMs) * 60) / gameHourMs);
  const minuteOfDay = total % MINUTES_PER_DAY;
  return Object.freeze({
    day: Math.floor(total / MINUTES_PER_DAY),
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    minuteOfDay,
  });
}

export const formatGameTime = ({ hour, minute }: GameTime): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
