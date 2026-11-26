import type { AccessLevel } from '@duskmarch/domain';

/** Время — миллисекунды UTC. */
export type Ms = number;

export type AccountStatus = 'pending_verification' | 'active' | 'expired';

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  status: AccountStatus;
  accessLevel: AccessLevel;
  effectiveLevel: AccessLevel;
  emailVerifiedAt: Ms | null;
  createdAt: Ms;
  updatedAt: Ms;
}

export interface TosRecord {
  id: string;
  accountId: string;
  tosVersion: string;
  privacyVersion: string;
  ip: string;
  userAgent: string;
  acceptedAt: Ms;
}

export type EmailTokenPurpose = 'verify' | 'reset' | 'change';

export interface EmailTokenRecord {
  id: string;
  accountId: string;
  purpose: EmailTokenPurpose;
  tokenHash: string;
  newEmail: string | null;
  createdAt: Ms;
  expiresAt: Ms;
  usedAt: Ms | null;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  createdAt: Ms;
  lastUsedAt: Ms;
  familyExpiresAt: Ms;
  revokedAt: Ms | null;
  revokeReason: string | null;
  mfa: boolean;
  reauthAt: Ms | null;
  ip: string;
  userAgent: string;
}

export type RefreshStatus = 'active' | 'rotated' | 'revoked';

export interface RefreshTokenRecord {
  id: string;
  sessionId: string;
  tokenHash: string;
  status: RefreshStatus;
  createdAt: Ms;
  expiresAt: Ms;
}

export interface OAuthIdentityRecord {
  provider: string;
  providerUserId: string;
  accountId: string;
  email: string | null;
  linkedAt: Ms;
}

export interface TotpRecord {
  accountId: string;
  status: 'pending' | 'enabled';
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
  lastUsedStep: number | null;
  setupTokenHash: string | null;
  setupExpiresAt: Ms | null;
  enabledAt: Ms | null;
}

export interface BackupCodeRecord {
  id: string;
  accountId: string;
  codeHash: string;
  usedAt: Ms | null;
}

export interface BanRecord {
  id: string;
  accountId: string;
  issuedBy: string;
  reason: string;
  createdAt: Ms;
  expiresAt: Ms | null;
  liftedAt: Ms | null;
  liftedBy: string | null;
  liftReason: string | null;
}

export interface SecurityEventRecord {
  id: string;
  accountId: string | null;
  type: string;
  outcome: 'success' | 'failure';
  reasonCode: string | null;
  ip: string;
  userAgent: string;
  at: Ms;
}

export interface AuditRecord {
  id: string;
  actorId: string;
  targetId: string | null;
  action: string;
  outcome: 'allowed' | 'denied';
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string;
  userAgent: string;
  at: Ms;
}

export type OutboxKind = 'email' | 'event';
export type OutboxStatus = 'pending' | 'done' | 'dead';

export interface OutboxRecord {
  id: string;
  kind: OutboxKind;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Ms;
  lastError: string | null;
  createdAt: Ms;
}

/** Страница по убыванию времени; курсор — `at:id` последней записи. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageRequest {
  limit: number;
  cursor?: string | undefined;
  since?: Ms | undefined;
}

/**
 * Хранилище identity. Условные методы (`mark…`, `advance…`, `swap…`) возвращают `false`,
 * если запись уже изменена другим запросом — так исключаются гонки.
 */
export interface IdentityStore {
  transaction<T>(body: (store: IdentityStore) => Promise<T>): Promise<T>;
  /** Сериализует операции, способные оставить шард без владельца. */
  lockOwners(): Promise<void>;

  insertAccount(record: AccountRecord): Promise<void>;
  findAccount(id: string): Promise<AccountRecord | null>;
  /** Живой (не `expired`) аккаунт по каноническому email. */
  findAccountByEmail(email: string): Promise<AccountRecord | null>;
  updateAccount(id: string, patch: Partial<Omit<AccountRecord, 'id'>>): Promise<void>;
  listAccountsByLevel(level: AccessLevel): Promise<AccountRecord[]>;
  /** Переводит в `expired` неподтверждённые аккаунты старше `before`; возвращает их id. */
  expirePending(before: Ms, now: Ms): Promise<string[]>;

  insertTos(record: TosRecord): Promise<void>;
  latestTos(accountId: string): Promise<TosRecord | null>;

  insertEmailToken(record: EmailTokenRecord): Promise<void>;
  findEmailToken(tokenHash: string): Promise<EmailTokenRecord | null>;
  markEmailTokenUsed(id: string, at: Ms): Promise<boolean>;
  /** Аннулирует неиспользованные токены аккаунта с этой целью. */
  invalidateEmailTokens(accountId: string, purpose: EmailTokenPurpose, at: Ms): Promise<void>;

  insertSession(record: SessionRecord): Promise<void>;
  findSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<Omit<SessionRecord, 'id'>>): Promise<void>;
  listActiveSessions(accountId: string, now: Ms): Promise<SessionRecord[]>;
  /** Отзывает активные сессии (кроме `exceptId`) и их refresh-токены; возвращает id. */
  revokeSessions(accountId: string, reason: string, at: Ms, exceptId?: string): Promise<string[]>;
  revokeSession(id: string, reason: string, at: Ms): Promise<boolean>;

  insertRefresh(record: RefreshTokenRecord): Promise<void>;
  findRefresh(tokenHash: string): Promise<RefreshTokenRecord | null>;
  swapRefreshStatus(id: string, from: RefreshStatus, to: RefreshStatus): Promise<boolean>;

  insertOAuth(record: OAuthIdentityRecord): Promise<void>;
  findOAuth(provider: string, providerUserId: string): Promise<OAuthIdentityRecord | null>;
  listOAuth(accountId: string): Promise<OAuthIdentityRecord[]>;
  deleteOAuth(accountId: string, provider: string): Promise<boolean>;

  getTotp(accountId: string): Promise<TotpRecord | null>;
  putTotp(record: TotpRecord): Promise<void>;
  deleteTotp(accountId: string): Promise<void>;
  /** Запоминает принятый шаг, если он больше прежнего. */
  advanceTotpStep(accountId: string, step: number): Promise<boolean>;

  replaceBackupCodes(accountId: string, records: BackupCodeRecord[]): Promise<void>;
  listBackupCodes(accountId: string): Promise<BackupCodeRecord[]>;
  markBackupCodeUsed(id: string, at: Ms): Promise<boolean>;

  insertBan(record: BanRecord): Promise<void>;
  findBan(id: string): Promise<BanRecord | null>;
  /** Действующий бан: не снят и не истёк к `now`. */
  activeBan(accountId: string, now: Ms): Promise<BanRecord | null>;
  updateBan(id: string, patch: Partial<Omit<BanRecord, 'id'>>): Promise<void>;

  insertSecurityEvent(record: SecurityEventRecord): Promise<void>;
  listSecurityEvents(accountId: string, page: PageRequest): Promise<Page<SecurityEventRecord>>;
  /** Был ли успешный вход с этим IP и User-Agent. */
  knownDevice(accountId: string, ip: string, userAgent: string): Promise<boolean>;

  insertAudit(record: AuditRecord): Promise<void>;
  listAudit(page: PageRequest): Promise<Page<AuditRecord>>;

  insertOutbox(record: OutboxRecord): Promise<void>;
  /** Берёт готовые записи и откладывает их на `leaseMs`, чтобы их не взял другой узел. */
  claimOutbox(now: Ms, limit: number, leaseMs: number): Promise<OutboxRecord[]>;
  updateOutbox(id: string, patch: Partial<Omit<OutboxRecord, 'id'>>): Promise<void>;
  findOutbox(id: string): Promise<OutboxRecord | null>;
}

/** Быстрые ключи с TTL (Valkey). */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  many(keys: readonly string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Атомарно читает и удаляет. */
  take(key: string): Promise<string | null>;
  /** Увеличивает счётчик; TTL ставится при создании. */
  incr(key: string, ttlMs: number): Promise<number>;
  /** Остаток жизни ключа, мс; 0 — ключа нет. */
  ttl(key: string): Promise<number>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export interface EventPublisher {
  publish(subject: string, payload: unknown): Promise<void>;
}
