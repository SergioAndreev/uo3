import type { AccessLevel } from '@duskmarch/domain';
import {
  accessAuditLog,
  accountBans,
  accounts,
  authSessions,
  backupCodes,
  emailTokens,
  identityOutbox,
  oauthIdentities,
  refreshTokens,
  securityEvents,
  tosAcceptances,
  totpEnrollments,
  type Database,
} from '@duskmarch/db';
import { and, asc, desc, eq, gt, gte, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type {
  AccountRecord,
  AuditRecord,
  BackupCodeRecord,
  BanRecord,
  EmailTokenPurpose,
  EmailTokenRecord,
  IdentityStore,
  Ms,
  OAuthIdentityRecord,
  OutboxRecord,
  Page,
  PageRequest,
  RefreshStatus,
  RefreshTokenRecord,
  SecurityEventRecord,
  SessionRecord,
  TosRecord,
  TotpRecord,
} from '../ports.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'> & {
  transaction: Database['transaction'];
};

/** Ключ рекомендательной блокировки инварианта «есть владелец». */
const OWNER_LOCK = 0x444d_4f57;

const d = (ms: Ms | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms);
const ms = (date: Date | null): Ms | null => (date === null ? null : date.getTime());
const req = (date: Date): Ms => date.getTime();

/** Ms-поля патча → Date. */
function datePatch<T extends object>(patch: T, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  for (const key of keys) if (key in out) out[key] = d(out[key] as Ms | null);
  return out;
}

const ACCOUNT_DATES = ['emailVerifiedAt', 'createdAt', 'updatedAt'];
const SESSION_DATES = ['createdAt', 'lastUsedAt', 'familyExpiresAt', 'revokedAt', 'reauthAt'];
const BAN_DATES = ['createdAt', 'expiresAt', 'liftedAt'];
const OUTBOX_DATES = ['nextAttemptAt', 'createdAt'];

const toAccount = (r: typeof accounts.$inferSelect): AccountRecord => ({
  id: r.id,
  email: r.email,
  passwordHash: r.passwordHash,
  status: r.status as AccountRecord['status'],
  accessLevel: r.accessLevel as AccessLevel,
  effectiveLevel: r.effectiveLevel as AccessLevel,
  emailVerifiedAt: ms(r.emailVerifiedAt),
  createdAt: req(r.createdAt),
  updatedAt: req(r.updatedAt),
});

const toSession = (r: typeof authSessions.$inferSelect): SessionRecord => ({
  ...r,
  createdAt: req(r.createdAt),
  lastUsedAt: req(r.lastUsedAt),
  familyExpiresAt: req(r.familyExpiresAt),
  revokedAt: ms(r.revokedAt),
  reauthAt: ms(r.reauthAt),
});

const toEmailToken = (r: typeof emailTokens.$inferSelect): EmailTokenRecord => ({
  ...r,
  purpose: r.purpose as EmailTokenPurpose,
  createdAt: req(r.createdAt),
  expiresAt: req(r.expiresAt),
  usedAt: ms(r.usedAt),
});

const toBan = (r: typeof accountBans.$inferSelect): BanRecord => ({
  ...r,
  createdAt: req(r.createdAt),
  expiresAt: ms(r.expiresAt),
  liftedAt: ms(r.liftedAt),
});

const toOutbox = (r: typeof identityOutbox.$inferSelect): OutboxRecord => ({
  ...r,
  kind: r.kind as OutboxRecord['kind'],
  status: r.status as OutboxRecord['status'],
  nextAttemptAt: req(r.nextAttemptAt),
  createdAt: req(r.createdAt),
});

/** Условие страницы по убыванию (`at`, `id`) и курсор следующей. */
function pageWhere(at: PgColumn, id: PgColumn, page: PageRequest): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (page.since !== undefined) parts.push(gte(at, new Date(page.since)));
  if (page.cursor) {
    const [cursorAt, cursorId = ''] = page.cursor.split(':');
    const when = new Date(Number(cursorAt));
    parts.push(or(lt(at, when), and(eq(at, when), lt(id, cursorId))));
  }
  return and(...parts);
}

function toPage<T extends { id: string; at: Ms }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? `${last.at}:${last.id}` : null };
}

/** Хранилище identity в PostgreSQL. */
export class DrizzleIdentityStore implements IdentityStore {
  constructor(
    private readonly db: Executor,
    private readonly inTransaction = false,
  ) {}

  async transaction<T>(body: (store: IdentityStore) => Promise<T>): Promise<T> {
    if (this.inTransaction) return body(this);
    return this.db.transaction((tx) =>
      body(new DrizzleIdentityStore(tx as unknown as Executor, true)),
    );
  }

  async lockOwners(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(${OWNER_LOCK})`);
  }

  async insertAccount(r: AccountRecord): Promise<void> {
    await this.db
      .insert(accounts)
      .values(datePatch(r, ACCOUNT_DATES) as typeof accounts.$inferInsert);
  }

  async findAccount(id: string): Promise<AccountRecord | null> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return row ? toAccount(row) : null;
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.email, email), ne(accounts.status, 'expired')));
    return row ? toAccount(row) : null;
  }

  async updateAccount(id: string, patch: Partial<AccountRecord>): Promise<void> {
    await this.db.update(accounts).set(datePatch(patch, ACCOUNT_DATES)).where(eq(accounts.id, id));
  }

  async listAccountsByLevel(level: AccessLevel): Promise<AccountRecord[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.accessLevel, level), ne(accounts.status, 'expired')));
    return rows.map(toAccount);
  }

  async expirePending(before: Ms, now: Ms): Promise<string[]> {
    const rows = await this.db
      .update(accounts)
      .set({ status: 'expired', updatedAt: new Date(now) })
      .where(
        and(eq(accounts.status, 'pending_verification'), lt(accounts.createdAt, new Date(before))),
      )
      .returning({ id: accounts.id });
    for (const { id } of rows) await this.invalidateEmailTokens(id, 'verify', now);
    return rows.map((r) => r.id);
  }

  async insertTos(r: TosRecord): Promise<void> {
    await this.db.insert(tosAcceptances).values({ ...r, acceptedAt: new Date(r.acceptedAt) });
  }

  async latestTos(accountId: string): Promise<TosRecord | null> {
    const [row] = await this.db
      .select()
      .from(tosAcceptances)
      .where(eq(tosAcceptances.accountId, accountId))
      .orderBy(desc(tosAcceptances.acceptedAt), desc(tosAcceptances.id))
      .limit(1);
    return row ? { ...row, acceptedAt: req(row.acceptedAt) } : null;
  }

  async insertEmailToken(r: EmailTokenRecord): Promise<void> {
    await this.db.insert(emailTokens).values({
      ...r,
      createdAt: new Date(r.createdAt),
      expiresAt: new Date(r.expiresAt),
      usedAt: d(r.usedAt),
    });
  }

  async findEmailToken(tokenHash: string): Promise<EmailTokenRecord | null> {
    const [row] = await this.db
      .select()
      .from(emailTokens)
      .where(eq(emailTokens.tokenHash, tokenHash));
    return row ? toEmailToken(row) : null;
  }

  async markEmailTokenUsed(id: string, at: Ms): Promise<boolean> {
    const rows = await this.db
      .update(emailTokens)
      .set({ usedAt: new Date(at) })
      .where(and(eq(emailTokens.id, id), isNull(emailTokens.usedAt)))
      .returning({ id: emailTokens.id });
    return rows.length === 1;
  }

  async invalidateEmailTokens(accountId: string, purpose: EmailTokenPurpose, at: Ms) {
    await this.db
      .update(emailTokens)
      .set({ usedAt: new Date(at) })
      .where(
        and(
          eq(emailTokens.accountId, accountId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
        ),
      );
  }

  async insertSession(r: SessionRecord): Promise<void> {
    await this.db
      .insert(authSessions)
      .values(datePatch(r, SESSION_DATES) as typeof authSessions.$inferInsert);
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, id));
    return row ? toSession(row) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
    await this.db
      .update(authSessions)
      .set(datePatch(patch, SESSION_DATES))
      .where(eq(authSessions.id, id));
  }

  async listActiveSessions(accountId: string, now: Ms): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(
        and(
          eq(authSessions.accountId, accountId),
          isNull(authSessions.revokedAt),
          gt(authSessions.familyExpiresAt, new Date(now)),
        ),
      );
    return rows.map(toSession);
  }

  async revokeSession(id: string, reason: string, at: Ms): Promise<boolean> {
    const rows = await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(at), revokeReason: reason })
      .where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    await this.db
      .update(refreshTokens)
      .set({ status: 'revoked' })
      .where(and(eq(refreshTokens.sessionId, id), eq(refreshTokens.status, 'active')));
    return rows.length === 1;
  }

  async revokeSessions(accountId: string, reason: string, at: Ms, exceptId?: string) {
    const rows = await this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.accountId, accountId),
          isNull(authSessions.revokedAt),
          exceptId === undefined ? undefined : ne(authSessions.id, exceptId),
        ),
      );
    const ids: string[] = [];
    for (const { id } of rows) if (await this.revokeSession(id, reason, at)) ids.push(id);
    return ids;
  }

  async insertRefresh(r: RefreshTokenRecord): Promise<void> {
    await this.db.insert(refreshTokens).values({
      ...r,
      createdAt: new Date(r.createdAt),
      expiresAt: new Date(r.expiresAt),
    });
  }

  async findRefresh(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return row
      ? {
          ...row,
          status: row.status as RefreshStatus,
          createdAt: req(row.createdAt),
          expiresAt: req(row.expiresAt),
        }
      : null;
  }

  async swapRefreshStatus(id: string, from: RefreshStatus, to: RefreshStatus) {
    const rows = await this.db
      .update(refreshTokens)
      .set({ status: to })
      .where(and(eq(refreshTokens.id, id), eq(refreshTokens.status, from)))
      .returning({ id: refreshTokens.id });
    return rows.length === 1;
  }

  async insertOAuth(r: OAuthIdentityRecord): Promise<void> {
    await this.db.insert(oauthIdentities).values({ ...r, linkedAt: new Date(r.linkedAt) });
  }

  async findOAuth(provider: string, providerUserId: string) {
    const [row] = await this.db
      .select()
      .from(oauthIdentities)
      .where(
        and(
          eq(oauthIdentities.provider, provider),
          eq(oauthIdentities.providerUserId, providerUserId),
        ),
      );
    return row ? { ...row, linkedAt: req(row.linkedAt) } : null;
  }

  async listOAuth(accountId: string): Promise<OAuthIdentityRecord[]> {
    const rows = await this.db
      .select()
      .from(oauthIdentities)
      .where(eq(oauthIdentities.accountId, accountId))
      .orderBy(asc(oauthIdentities.provider));
    return rows.map((row) => ({ ...row, linkedAt: req(row.linkedAt) }));
  }

  async deleteOAuth(accountId: string, provider: string): Promise<boolean> {
    const rows = await this.db
      .delete(oauthIdentities)
      .where(and(eq(oauthIdentities.accountId, accountId), eq(oauthIdentities.provider, provider)))
      .returning({ provider: oauthIdentities.provider });
    return rows.length > 0;
  }

  async getTotp(accountId: string): Promise<TotpRecord | null> {
    const [row] = await this.db
      .select()
      .from(totpEnrollments)
      .where(eq(totpEnrollments.accountId, accountId));
    return row
      ? {
          ...row,
          status: row.status as TotpRecord['status'],
          setupExpiresAt: ms(row.setupExpiresAt),
          enabledAt: ms(row.enabledAt),
        }
      : null;
  }

  async putTotp(r: TotpRecord): Promise<void> {
    const values = { ...r, setupExpiresAt: d(r.setupExpiresAt), enabledAt: d(r.enabledAt) };
    await this.db
      .insert(totpEnrollments)
      .values(values)
      .onConflictDoUpdate({ target: totpEnrollments.accountId, set: values });
  }

  async deleteTotp(accountId: string): Promise<void> {
    await this.db.delete(totpEnrollments).where(eq(totpEnrollments.accountId, accountId));
  }

  async advanceTotpStep(accountId: string, step: number): Promise<boolean> {
    const rows = await this.db
      .update(totpEnrollments)
      .set({ lastUsedStep: step })
      .where(
        and(
          eq(totpEnrollments.accountId, accountId),
          or(isNull(totpEnrollments.lastUsedStep), lt(totpEnrollments.lastUsedStep, step)),
        ),
      )
      .returning({ id: totpEnrollments.accountId });
    return rows.length === 1;
  }

  async replaceBackupCodes(accountId: string, records: BackupCodeRecord[]): Promise<void> {
    await this.db.delete(backupCodes).where(eq(backupCodes.accountId, accountId));
    if (records.length > 0) {
      await this.db.insert(backupCodes).values(records.map((r) => ({ ...r, usedAt: d(r.usedAt) })));
    }
  }

  async listBackupCodes(accountId: string): Promise<BackupCodeRecord[]> {
    const rows = await this.db
      .select()
      .from(backupCodes)
      .where(eq(backupCodes.accountId, accountId));
    return rows.map((r) => ({ ...r, usedAt: ms(r.usedAt) }));
  }

  async markBackupCodeUsed(id: string, at: Ms): Promise<boolean> {
    const rows = await this.db
      .update(backupCodes)
      .set({ usedAt: new Date(at) })
      .where(and(eq(backupCodes.id, id), isNull(backupCodes.usedAt)))
      .returning({ id: backupCodes.id });
    return rows.length === 1;
  }

  async insertBan(r: BanRecord): Promise<void> {
    await this.db
      .insert(accountBans)
      .values(datePatch(r, BAN_DATES) as typeof accountBans.$inferInsert);
  }

  async findBan(id: string): Promise<BanRecord | null> {
    const [row] = await this.db.select().from(accountBans).where(eq(accountBans.id, id));
    return row ? toBan(row) : null;
  }

  async activeBan(accountId: string, now: Ms): Promise<BanRecord | null> {
    const [row] = await this.db
      .select()
      .from(accountBans)
      .where(
        and(
          eq(accountBans.accountId, accountId),
          isNull(accountBans.liftedAt),
          or(isNull(accountBans.expiresAt), gt(accountBans.expiresAt, new Date(now))),
        ),
      )
      .orderBy(sql`${accountBans.expiresAt} desc nulls first`)
      .limit(1);
    return row ? toBan(row) : null;
  }

  async updateBan(id: string, patch: Partial<BanRecord>): Promise<void> {
    await this.db
      .update(accountBans)
      .set(datePatch(patch, BAN_DATES))
      .where(eq(accountBans.id, id));
  }

  async insertSecurityEvent(r: SecurityEventRecord): Promise<void> {
    await this.db.insert(securityEvents).values({ ...r, at: new Date(r.at) });
  }

  async listSecurityEvents(accountId: string, page: PageRequest) {
    const rows = await this.db
      .select()
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.accountId, accountId),
          pageWhere(securityEvents.at, securityEvents.id, page),
        ),
      )
      .orderBy(desc(securityEvents.at), desc(securityEvents.id))
      .limit(page.limit + 1);
    return toPage(
      rows.map((r) => ({
        ...r,
        outcome: r.outcome as SecurityEventRecord['outcome'],
        at: req(r.at),
      })),
      page.limit,
    );
  }

  async knownDevice(accountId: string, ip: string, userAgent: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: securityEvents.id })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.accountId, accountId),
          eq(securityEvents.type, 'login'),
          eq(securityEvents.outcome, 'success'),
          eq(securityEvents.ip, ip),
          eq(securityEvents.userAgent, userAgent),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async insertAudit(r: AuditRecord): Promise<void> {
    await this.db.insert(accessAuditLog).values({ ...r, at: new Date(r.at) });
  }

  async listAudit(page: PageRequest): Promise<Page<AuditRecord>> {
    const rows = await this.db
      .select()
      .from(accessAuditLog)
      .where(pageWhere(accessAuditLog.at, accessAuditLog.id, page))
      .orderBy(desc(accessAuditLog.at), desc(accessAuditLog.id))
      .limit(page.limit + 1);
    return toPage(
      rows.map((r) => ({ ...r, outcome: r.outcome as AuditRecord['outcome'], at: req(r.at) })),
      page.limit,
    );
  }

  async insertOutbox(r: OutboxRecord): Promise<void> {
    await this.db
      .insert(identityOutbox)
      .values(datePatch(r, OUTBOX_DATES) as typeof identityOutbox.$inferInsert);
  }

  async claimOutbox(now: Ms, limit: number, leaseMs: number): Promise<OutboxRecord[]> {
    const result = await this.db.execute(sql`
      update ${identityOutbox} set next_attempt_at = ${new Date(now + leaseMs)}
      where id in (
        select id from ${identityOutbox}
        where status = 'pending' and next_attempt_at <= ${new Date(now)}
        order by next_attempt_at, id
        limit ${limit}
        for update skip locked
      )
      returning id`);
    const ids = (result.rows as { id: string }[]).map((r) => r.id);
    const rows = await Promise.all(ids.map((id) => this.findOutbox(id)));
    return rows.filter((r): r is OutboxRecord => r !== null);
  }

  async updateOutbox(id: string, patch: Partial<OutboxRecord>): Promise<void> {
    await this.db
      .update(identityOutbox)
      .set(datePatch(patch, OUTBOX_DATES))
      .where(eq(identityOutbox.id, id));
  }

  async findOutbox(id: string): Promise<OutboxRecord | null> {
    const [row] = await this.db.select().from(identityOutbox).where(eq(identityOutbox.id, id));
    return row ? toOutbox(row) : null;
  }
}
