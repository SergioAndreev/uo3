import { hash, verify } from '@node-rs/argon2';

/** `Algorithm.Argon2id` из @node-rs/argon2 (const enum недоступен при isolatedModules). */
const ARGON2ID = 2;
import { COMMON_PASSWORDS } from './common-passwords.js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export type PasswordViolation = 'length' | 'matches_email' | 'common';

/** Нормализация NFC без обрезки пробелов. */
export const normalizePassword = (password: string): string => password.normalize('NFC');

/** Нарушения политики пароля; пустой список — пароль подходит. */
export function passwordViolations(password: string, email: string): PasswordViolation[] {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  const lower = normalized.toLowerCase();
  const local = email.split('@')[0] ?? '';
  const violations: PasswordViolation[] = [];
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) violations.push('length');
  if (lower === email.toLowerCase() || (local !== '' && lower === local.toLowerCase())) {
    violations.push('matches_email');
  }
  if (COMMON_PASSWORDS.has(lower)) violations.push('common');
  return violations;
}

export interface Argon2Params {
  memoryKiB: number;
  timeCost: number;
}

/** argon2id с холостой проверкой для выравнивания времени. */
export class PasswordHasher {
  private dummy: Promise<string> | undefined;

  constructor(private readonly params: Argon2Params) {}

  private options() {
    return {
      algorithm: ARGON2ID,
      memoryCost: this.params.memoryKiB,
      timeCost: this.params.timeCost,
      parallelism: 1,
    };
  }

  hash(password: string): Promise<string> {
    return hash(normalizePassword(password), this.options());
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, normalizePassword(password));
    } catch {
      return false;
    }
  }

  /** Та же стоимость, что у настоящей проверки; результат всегда ложь. */
  async verifyDummy(password: string): Promise<false> {
    this.dummy ??= this.hash('холостой-пароль-для-выравнивания');
    await this.verify(await this.dummy, password);
    return false;
  }

  /** Хэш создан с другими параметрами и должен быть пересчитан. */
  needsRehash(stored: string): boolean {
    const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
    return (
      match === null ||
      Number(match[1]) !== this.params.memoryKiB ||
      Number(match[2]) !== this.params.timeCost ||
      Number(match[3]) !== 1
    );
  }
}
