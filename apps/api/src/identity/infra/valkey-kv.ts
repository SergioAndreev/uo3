import type { Redis } from 'iovalkey';
import type { KeyValue } from '../ports.js';

const INCR_WITH_TTL = `local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return v`;

/** Ключ-значение в Valkey. */
export class ValkeyKeyValue implements KeyValue {
  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async many(keys: readonly string[]): Promise<(string | null)[]> {
    return keys.length === 0 ? [] : this.redis.mget(...keys);
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, 'PX', Math.max(1, Math.ceil(ttlMs)));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  take(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    return Number(await this.redis.eval(INCR_WITH_TTL, 1, key, Math.max(1, Math.ceil(ttlMs))));
  }

  async ttl(key: string): Promise<number> {
    return Math.max(0, await this.redis.pttl(key));
  }
}
