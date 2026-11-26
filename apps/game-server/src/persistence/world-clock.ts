import { SeededRng, gameTime, type GameTime, type RngState } from '@duskmarch/domain';

/** Состояние ГПСЧ ↔ строка 32 шестнадцатеричных символа. */
export const encodeRng = (state: RngState): string =>
  state.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');

export function decodeRng(text: string): RngState {
  if (!/^[0-9a-f]{32}$/.test(text)) throw new Error(`состояние ГПСЧ: ${text}`);
  return [0, 8, 16, 24].map((i) =>
    Number.parseInt(text.slice(i, i + 8), 16),
  ) as unknown as RngState;
}

/**
 * Игровое время и корневой ГПСЧ шарда: продолжают ход с сохранённого снимка.
 * Время мира идёт только вместе с тиками симуляции (простой сервера время не двигает).
 */
export class WorldClock {
  readonly rng: SeededRng;
  private readonly baseTimeMs: number;
  private readonly baseTick: number;

  constructor(
    saved: { gameTimeMs: number; rngState: string },
    private readonly tickMs: number,
    private readonly gameHourMs: number,
    startTick = 0,
  ) {
    this.rng = SeededRng.restore(decodeRng(saved.rngState));
    this.baseTimeMs = saved.gameTimeMs;
    this.baseTick = startTick;
  }

  gameTimeMs(tick: number): number {
    return this.baseTimeMs + Math.max(0, tick - this.baseTick) * this.tickMs;
  }

  time(tick: number): GameTime {
    return gameTime(this.gameTimeMs(tick), 0, this.gameHourMs);
  }

  snapshot(tick: number): { gameTimeMs: number; rngState: string } {
    return { gameTimeMs: this.gameTimeMs(tick), rngState: encodeRng(this.rng.snapshot()) };
  }
}

export type TimerPolicy = 'pause' | 'wall' | 'staggered';

export interface StoredTimer {
  id: string;
  kind: string;
  policy: TimerPolicy;
  remainingMs: number;
  dueAt: Date;
}

/** Предел просроченных таймеров `staggered` на один тик. */
export const STAGGER_PER_TICK = 100;

/**
 * План восстановления таймеров после старта: задержка до срабатывания каждого.
 * `pause` — остаток на момент остановки от момента запуска; `wall` — реальный срок (просроченный — сразу);
 * `staggered` — просроченные распределяются по тикам, не больше `STAGGER_PER_TICK` за тик.
 */
export function planTimers(
  timers: readonly StoredTimer[],
  now: Date,
  tickMs: number,
): { timer: StoredTimer; delayMs: number }[] {
  let overdue = 0;
  return [...timers]
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id))
    .map((timer) => {
      if (timer.policy === 'pause') return { timer, delayMs: Math.max(0, timer.remainingMs) };
      const left = timer.dueAt.getTime() - now.getTime();
      if (left > 0 || timer.policy === 'wall') return { timer, delayMs: Math.max(0, left) };
      const slot = Math.floor(overdue++ / STAGGER_PER_TICK) + 1;
      return { timer, delayMs: slot * tickMs };
    });
}
