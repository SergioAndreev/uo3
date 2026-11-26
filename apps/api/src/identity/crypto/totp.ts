import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;

/** Base32 RFC 4648 без выравнивания `=`. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('некорректный Base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algorithm = 'sha1') {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

export const totpAt = (secret: Buffer, nowMs: number): string => hotp(secret, stepOf(nowMs));

/** Шаг, которому соответствует код в окне ±`window`; иначе `null`. */
export function matchTotp(secret: Buffer, code: string, nowMs: number, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepOf(nowMs);
  for (let delta = -window; delta <= window; delta++) {
    if (hotp(secret, current + delta) === code) return current + delta;
  }
  return null;
}

export const otpauthUri = (issuer: string, account: string, secret: string): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}` +
  `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_S}`;
