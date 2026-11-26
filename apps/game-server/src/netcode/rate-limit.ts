import { RATE_LIMITS, type RateCategory } from '@duskmarch/protocol';

/** Ведро токенов по категориям частоты на одну сессию. */
export class RateLimiter {
  private readonly buckets = new Map<RateCategory, { tokens: number; at: number }>();

  constructor(private readonly limits = RATE_LIMITS) {}

  take(category: RateCategory, nowMs: number): { ok: true } | { ok: false; retryAfterMs: number } {
    const { perSecond, burst } = this.limits[category];
    const bucket = this.buckets.get(category) ?? { tokens: burst, at: nowMs };
    bucket.tokens = Math.min(burst, bucket.tokens + ((nowMs - bucket.at) * perSecond) / 1000);
    bucket.at = nowMs;
    this.buckets.set(category, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true };
    }
    return {
      ok: false,
      retryAfterMs: Math.max(1, Math.ceil(((1 - bucket.tokens) * 1000) / perSecond)),
    };
  }
}

/** Счётчик событий в скользящем окне. */
export class SlidingCounter {
  private readonly stamps: number[] = [];

  constructor(private readonly windowMs: number) {}

  hit(nowMs: number): number {
    this.stamps.push(nowMs);
    while ((this.stamps[0] as number) <= nowMs - this.windowMs) this.stamps.shift();
    return this.stamps.length;
  }
}
