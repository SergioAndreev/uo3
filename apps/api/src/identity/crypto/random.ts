import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Источник случайности; тесты подменяют его детерминированным. */
export interface Entropy {
  bytes(size: number): Buffer;
}

export const systemEntropy: Entropy = { bytes: (size) => randomBytes(size) };

/** Токен из 32 байт в base64url (256 бит). */
export const newToken = (entropy: Entropy): string => entropy.bytes(32).toString('base64url');

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Сравнение строк за время, не зависящее от совпадающего префикса. */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

/** UUIDv7: 48 бит времени в мс, затем случайные биты. */
export function uuidv7(nowMs: number, entropy: Entropy): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(Math.floor(nowMs), 0, 6);
  entropy.bytes(10).copy(bytes, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
