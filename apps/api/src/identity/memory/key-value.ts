import type { GameClock } from '@duskmarch/domain';
import type { KeyValue } from '../ports.js';

/** Ключ-значение в памяти на инъецируемых часах. */
export class MemoryKeyValue implements KeyValue {
  private readonly data = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly clock: Pick<GameClock, 'utc'>) {}

  private live(key: string) {
    const row = this.data.get(key);
    if (row && row.expiresAt <= this.clock.utc()) {
      this.data.delete(key);
      return undefined;
    }
    return row;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async many(keys: readonly string[]): Promise<(string | null)[]> {
    return keys.map((key) => this.live(key)?.value ?? null);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.data.set(key, { value, expiresAt: this.clock.utc() + ttlMs });
  }

  async del(key: string): Promise<void> {
    this.data.delete(key);
  }

  async take(key: string): Promise<string | null> {
    const value = this.live(key)?.value ?? null;
    this.data.delete(key);
    return value;
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    const row = this.live(key);
    const next = Number(row?.value ?? 0) + 1;
    this.data.set(key, {
      value: String(next),
      expiresAt: row?.expiresAt ?? this.clock.utc() + ttlMs,
    });
    return next;
  }

  async ttl(key: string): Promise<number> {
    const row = this.live(key);
    return row ? row.expiresAt - this.clock.utc() : 0;
  }
}
