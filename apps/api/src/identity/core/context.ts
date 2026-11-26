import type { AccessLevel, GameClock } from '@duskmarch/domain';
import type { IdentityEvent, IdentitySubject } from '@duskmarch/protocol';
import type { PasswordHasher } from '../crypto/password.js';
import type { KeyRing } from '../crypto/jwt.js';
import { newToken, sha256Hex, uuidv7, type Entropy } from '../crypto/random.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type {
  AuditRecord,
  EmailTokenPurpose,
  IdentityStore,
  KeyValue,
  MailMessage,
  SecurityEventRecord,
} from '../ports.js';

/** Метаданные запроса. */
export interface RequestMeta {
  ip: string;
  userAgent: string;
  origin?: string | undefined;
}

/** Проверка антибот-токена регистрации. */
export interface RegistrationChallenge {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export interface IdentitySettings {
  issuer: string;
  audience: string;
  publicUrl: string;
  trustedOrigins: readonly string[];
  tosVersion: string;
  privacyVersion: string;
  blockedEmailDomains: readonly string[];
  backupCodePepper: string;
}

export interface IdentityDeps {
  store: IdentityStore;
  kv: KeyValue;
  clock: Pick<GameClock, 'utc'>;
  entropy: Entropy;
  hasher: PasswordHasher;
  keys: KeyRing;
  box: SecretBox;
  challenge: RegistrationChallenge;
  settings: IdentitySettings;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Все сроки фазы в одном месте. */
export const LIMITS = {
  verifyTokenTtl: DAY,
  pendingTtl: 7 * DAY,
  resendCooldown: MINUTE,
  resendPerDay: 5,
  registerPer15m: 5,
  registerPerDay: 20,
  accessTtlS: 900,
  refreshTtl: 30 * DAY,
  familyTtl: 90 * DAY,
  maxSessions: 10,
  mfaChallengeTtl: 5 * MINUTE,
  mfaAttempts: 5,
  totpSetupTtl: 15 * MINUTE,
  oauthTxTtl: 10 * MINUTE,
  reauthWindow: 10 * MINUTE,
  loginFailures: 5,
  loginWindow: 15 * MINUTE,
  loginLock: 15 * MINUTE,
  loginLockRepeat: HOUR,
  ipFailures: 20,
  resetTokenTtl: 30 * MINUTE,
  emailChangeTtl: 2 * HOUR,
  historyDays: 90,
  banReasonMin: 10,
  banReasonMax: 1000,
} as const;

/** Общие помощники сервисов. */
export class Identity {
  constructor(readonly deps: IdentityDeps) {}

  get store(): IdentityStore {
    return this.deps.store;
  }

  get kv(): KeyValue {
    return this.deps.kv;
  }

  get settings(): IdentitySettings {
    return this.deps.settings;
  }

  now(): number {
    return this.deps.clock.utc();
  }

  iso(ms = this.now()): string {
    return new Date(ms).toISOString();
  }

  id(): string {
    return uuidv7(this.now(), this.deps.entropy);
  }

  /** Ключи по email не содержат адрес. */
  emailKey(email: string): string {
    return sha256Hex(email);
  }

  link(path: string, token: string): string {
    return `${this.settings.publicUrl.replace(/\/$/, '')}${path}?token=${token}`;
  }

  async email(store: IdentityStore, message: MailMessage): Promise<void> {
    await store.insertOutbox({
      id: this.id(),
      kind: 'email',
      payload: message,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: this.now(),
      lastError: null,
      createdAt: this.now(),
    });
  }

  async event<S extends IdentitySubject>(
    store: IdentityStore,
    subject: S,
    payload: Omit<IdentityEvent<S>, 'eventId' | 'occurredAt'>,
  ): Promise<void> {
    await store.insertOutbox({
      id: this.id(),
      kind: 'event',
      payload: { subject, event: { eventId: this.id(), occurredAt: this.iso(), ...payload } },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: this.now(),
      lastError: null,
      createdAt: this.now(),
    });
  }

  /** Событие с произвольной темой (шарды, герои) через тот же outbox. */
  async publish(
    store: IdentityStore,
    subject: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await store.insertOutbox({
      id: this.id(),
      kind: 'event',
      payload: { subject, event: { eventId: this.id(), occurredAt: this.iso(), ...payload } },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: this.now(),
      lastError: null,
      createdAt: this.now(),
    });
  }

  async securityEvent(
    store: IdentityStore,
    accountId: string | null,
    type: string,
    outcome: SecurityEventRecord['outcome'],
    meta: RequestMeta,
    reasonCode: string | null = null,
  ): Promise<void> {
    await store.insertSecurityEvent({
      id: this.id(),
      accountId,
      type,
      outcome,
      reasonCode,
      ip: meta.ip,
      userAgent: meta.userAgent,
      at: this.now(),
    });
  }

  async audit(
    store: IdentityStore,
    entry: Omit<AuditRecord, 'id' | 'at' | 'ip' | 'userAgent'>,
    meta: RequestMeta,
  ): Promise<void> {
    await store.insertAudit({
      ...entry,
      id: this.id(),
      at: this.now(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /** Выпускает одноразовый токен письма, аннулируя прежние той же цели. */
  async emailToken(
    store: IdentityStore,
    accountId: string,
    purpose: EmailTokenPurpose,
    ttlMs: number,
    newEmail: string | null = null,
  ): Promise<string> {
    const token = newToken(this.deps.entropy);
    await store.invalidateEmailTokens(accountId, purpose, this.now());
    await store.insertEmailToken({
      id: this.id(),
      accountId,
      purpose,
      tokenHash: sha256Hex(token),
      newEmail,
      createdAt: this.now(),
      expiresAt: this.now() + ttlMs,
      usedAt: null,
    });
    return token;
  }

  /** Немедленный отзыв сессий в быстром кэше на срок Access JWT. */
  async markRevoked(sessionIds: readonly string[]): Promise<void> {
    for (const sid of sessionIds) {
      await this.kv.set(revokedKey(sid), '1', LIMITS.accessTtlS * 1000);
    }
  }
}

export const revokedKey = (sid: string): string => `identity:revoked-sid:${sid}`;
export const bannedKey = (accountId: string): string => `identity:banned:${accountId}`;

export const isStaffLevel = (level: AccessLevel): boolean => level !== 'player';
