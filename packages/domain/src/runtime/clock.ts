/** Источник игрового времени; в пределах тика все чтения одинаковы. */
export interface GameClock {
  readonly tickMs: number;
  /** Игровое время в целых миллисекундах, не убывает. */
  now(): number;
  /** `floor(now / tickMs)`. */
  tick(): number;
  /** UTC-метка для журналов; в правилах не используется. */
  utc(): number;
}

export const DEFAULT_TICK_MS = 50;
export const tickOf = (nowMs: number, tickMs = DEFAULT_TICK_MS): number =>
  Math.floor(nowMs / tickMs);
