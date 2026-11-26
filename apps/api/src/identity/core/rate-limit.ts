import type { KeyValue } from '../ports.js';

export interface WindowState {
  count: number;
  /** Секунд до конца окна. */
  retryAfterS: number;
}

/** Фиксированное окно: номер окна берётся из инъецируемых часов, TTL — уборка. */
export async function hit(
  kv: KeyValue,
  key: string,
  windowMs: number,
  nowMs: number,
): Promise<WindowState> {
  const bucket = Math.floor(nowMs / windowMs);
  const count = await kv.incr(`identity:rl:${key}:${bucket}`, windowMs);
  return { count, retryAfterS: Math.ceil(((bucket + 1) * windowMs - nowMs) / 1000) };
}

export async function peek(
  kv: KeyValue,
  key: string,
  windowMs: number,
  nowMs: number,
): Promise<WindowState> {
  const bucket = Math.floor(nowMs / windowMs);
  const count = Number((await kv.get(`identity:rl:${key}:${bucket}`)) ?? 0);
  return { count, retryAfterS: Math.ceil(((bucket + 1) * windowMs - nowMs) / 1000) };
}

export async function clear(kv: KeyValue, key: string, windowMs: number, nowMs: number) {
  await kv.del(`identity:rl:${key}:${Math.floor(nowMs / windowMs)}`);
}
