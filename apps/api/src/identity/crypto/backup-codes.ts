import { createHmac } from 'node:crypto';
import type { Entropy } from './random.js';

/** Crockford Base32: без I, L, O, U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BACKUP_CODE_COUNT = 10;

/** Код `XXXX-XXXX`: 8 символов по 5 бит = 40 бит. */
export function newBackupCode(entropy: Entropy): string {
  const bytes = entropy.bytes(5);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = '';
  for (let i = 7; i >= 0; i--) text += CROCKFORD[Number((value >> BigInt(i * 5)) & 31n)];
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/** Без учёта регистра, дефисов и пробелов. */
export const normalizeBackupCode = (code: string): string =>
  code.toUpperCase().replace(/[\s-]/g, '');

export const looksLikeBackupCode = (code: string): boolean =>
  /^[0-9A-HJKMNP-TV-Z]{8}$/.test(normalizeBackupCode(code));

export const hashBackupCode = (pepper: string, accountId: string, code: string): string =>
  createHmac('sha256', pepper)
    .update(`${accountId}:${normalizeBackupCode(code)}`)
    .digest('hex');
