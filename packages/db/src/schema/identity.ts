import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Учётные записи. Email хранится канонизированным. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash'),
    status: varchar('status', { length: 32 }).notNull(),
    accessLevel: varchar('access_level', { length: 32 }).notNull().default('player'),
    effectiveLevel: varchar('effective_level', { length: 32 }).notNull().default('player'),
    emailVerifiedAt: at('email_verified_at'),
    createdAt: at('created_at').notNull(),
    updatedAt: at('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('accounts_email_live_idx')
      .on(t.email)
      .where(sql`${t.status} <> 'expired'`),
    index('accounts_access_level_idx').on(t.accessLevel),
  ],
);

export const tosAcceptances = pgTable('tos_acceptances', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  tosVersion: varchar('tos_version', { length: 64 }).notNull(),
  privacyVersion: varchar('privacy_version', { length: 64 }).notNull(),
  ip: varchar('ip', { length: 64 }).notNull(),
  userAgent: text('user_agent').notNull(),
  acceptedAt: at('accepted_at').notNull(),
});

/** Одноразовые токены писем: подтверждение, сброс пароля, смена email. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 16 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    newEmail: varchar('new_email', { length: 254 }),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    usedAt: at('used_at'),
  },
  (t) => [
    uniqueIndex('email_tokens_hash_idx').on(t.tokenHash),
    index('email_tokens_account_idx').on(t.accountId, t.purpose),
  ],
);

/** Сессия — семейство refresh-токенов. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: at('created_at').notNull(),
    lastUsedAt: at('last_used_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    revokedAt: at('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 64 }),
    mfa: boolean('mfa').notNull(),
    reauthAt: at('reauth_at'),
    ip: varchar('ip', { length: 64 }).notNull(),
    userAgent: text('user_agent').notNull(),
  },
  (t) => [index('auth_sessions_account_idx').on(t.accountId, t.revokedAt)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => authSessions.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_idx').on(t.tokenHash)],
);

export const oauthIdentities = pgTable(
  'oauth_identities',
  {
    provider: varchar('provider', { length: 16 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 128 }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 254 }),
    linkedAt: at('linked_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerUserId] }),
    uniqueIndex('oauth_identities_account_provider_idx').on(t.accountId, t.provider),
  ],
);

export const totpEnrollments = pgTable('totp_enrollments', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull(),
  ciphertext: text('ciphertext').notNull(),
  iv: varchar('iv', { length: 32 }).notNull(),
  tag: varchar('tag', { length: 32 }).notNull(),
  keyVersion: varchar('key_version', { length: 32 }).notNull(),
  lastUsedStep: bigint('last_used_step', { mode: 'number' }),
  setupTokenHash: varchar('setup_token_hash', { length: 64 }),
  setupExpiresAt: at('setup_expires_at'),
  enabledAt: at('enabled_at'),
});

export const backupCodes = pgTable(
  'backup_codes',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: at('used_at'),
  },
  (t) => [index('backup_codes_account_idx').on(t.accountId)],
);

export const accountBans = pgTable(
  'account_bans',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    issuedBy: uuid('issued_by').notNull(),
    reason: text('reason').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at'),
    liftedAt: at('lifted_at'),
    liftedBy: uuid('lifted_by'),
    liftReason: text('lift_reason'),
  },
  (t) => [index('account_bans_account_idx').on(t.accountId)],
);

/** Журнал событий безопасности; только добавление. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id'),
    type: varchar('type', { length: 48 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }),
    ip: varchar('ip', { length: 64 }).notNull(),
    userAgent: text('user_agent').notNull(),
    at: at('at').notNull(),
  },
  (t) => [index('security_events_account_idx').on(t.accountId, t.at)],
);

/** Аудит доступа; только добавление. */
export const accessAuditLog = pgTable(
  'access_audit_log',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').notNull(),
    targetId: uuid('target_id'),
    action: varchar('action', { length: 64 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
    ip: varchar('ip', { length: 64 }).notNull(),
    userAgent: text('user_agent').notNull(),
    at: at('at').notNull(),
  },
  (t) => [index('access_audit_log_at_idx').on(t.at)],
);

/** Письма и события, ожидающие отправки. */
export const identityOutbox = pgTable(
  'identity_outbox',
  {
    id: uuid('id').primaryKey(),
    kind: varchar('kind', { length: 16 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: at('next_attempt_at').notNull(),
    lastError: text('last_error'),
    createdAt: at('created_at').notNull(),
  },
  (t) => [index('identity_outbox_due_idx').on(t.status, t.nextAttemptAt)],
);
