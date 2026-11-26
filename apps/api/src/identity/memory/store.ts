import type { AccessLevel } from '@duskmarch/domain';
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

interface Tables {
  accounts: Map<string, AccountRecord>;
  tos: TosRecord[];
  emailTokens: Map<string, EmailTokenRecord>;
  sessions: Map<string, SessionRecord>;
  refresh: Map<string, RefreshTokenRecord>;
  oauth: OAuthIdentityRecord[];
  totp: Map<string, TotpRecord>;
  backup: Map<string, BackupCodeRecord>;
  bans: Map<string, BanRecord>;
  events: SecurityEventRecord[];
  audit: AuditRecord[];
  outbox: Map<string, OutboxRecord>;
}

const empty = (): Tables => ({
  accounts: new Map(),
  tos: [],
  emailTokens: new Map(),
  sessions: new Map(),
  refresh: new Map(),
  oauth: [],
  totp: new Map(),
  backup: new Map(),
  bans: new Map(),
  events: [],
  audit: [],
  outbox: new Map(),
});

const copy = <T>(value: T): T => structuredClone(value);

/** Курсор `at:id`; записи упорядочены по убыванию (`at`, `id`). */
export function pageOf<T extends { id: string; at: Ms }>(
  rows: readonly T[],
  { limit, cursor, since }: PageRequest,
): Page<T> {
  const [cursorAt, cursorId] = cursor ? [Number(cursor.split(':')[0]), cursor.split(':')[1]] : [];
  const sorted = rows
    .filter((row) => since === undefined || row.at >= since)
    .filter(
      (row) =>
        cursorAt === undefined ||
        row.at < cursorAt ||
        (row.at === cursorAt && row.id < (cursorId ?? '')),
    )
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const items = sorted.slice(0, limit).map(copy);
  const last = items[items.length - 1];
  return { items, nextCursor: sorted.length > limit && last ? `${last.at}:${last.id}` : null };
}

/** Хранилище в памяти для unit-тестов; транзакция откатывается при исключении. */
export class MemoryIdentityStore implements IdentityStore {
  private t: Tables = empty();
  private depth = 0;

  async transaction<T>(body: (store: IdentityStore) => Promise<T>): Promise<T> {
    if (this.depth > 0) return body(this);
    const snapshot = copy(this.t);
    this.depth++;
    try {
      return await body(this);
    } catch (error) {
      this.t = snapshot;
      throw error;
    } finally {
      this.depth--;
    }
  }

  async lockOwners(): Promise<void> {}

  async insertAccount(record: AccountRecord): Promise<void> {
    if (record.status !== 'expired' && (await this.findAccountByEmail(record.email))) {
      throw new Error('accounts_email_live_idx');
    }
    this.t.accounts.set(record.id, copy(record));
  }

  async findAccount(id: string): Promise<AccountRecord | null> {
    const row = this.t.accounts.get(id);
    return row ? copy(row) : null;
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    for (const row of this.t.accounts.values()) {
      if (row.email === email && row.status !== 'expired') return copy(row);
    }
    return null;
  }

  async updateAccount(id: string, patch: Partial<AccountRecord>): Promise<void> {
    const row = this.t.accounts.get(id);
    if (row) Object.assign(row, copy(patch));
  }

  async listAccountsByLevel(level: AccessLevel): Promise<AccountRecord[]> {
    return [...this.t.accounts.values()]
      .filter((row) => row.accessLevel === level && row.status !== 'expired')
      .map(copy);
  }

  async expirePending(before: Ms, now: Ms): Promise<string[]> {
    const ids: string[] = [];
    for (const row of this.t.accounts.values()) {
      if (row.status === 'pending_verification' && row.createdAt < before) {
        row.status = 'expired';
        row.updatedAt = now;
        ids.push(row.id);
        await this.invalidateEmailTokens(row.id, 'verify', now);
      }
    }
    return ids;
  }

  async insertTos(record: TosRecord): Promise<void> {
    this.t.tos.push(copy(record));
  }

  async latestTos(accountId: string): Promise<TosRecord | null> {
    const rows = this.t.tos.filter((row) => row.accountId === accountId);
    return rows.length ? copy(rows[rows.length - 1] as TosRecord) : null;
  }

  async insertEmailToken(record: EmailTokenRecord): Promise<void> {
    this.t.emailTokens.set(record.id, copy(record));
  }

  async findEmailToken(tokenHash: string): Promise<EmailTokenRecord | null> {
    for (const row of this.t.emailTokens.values()) {
      if (row.tokenHash === tokenHash) return copy(row);
    }
    return null;
  }

  async markEmailTokenUsed(id: string, at: Ms): Promise<boolean> {
    const row = this.t.emailTokens.get(id);
    if (!row || row.usedAt !== null) return false;
    row.usedAt = at;
    return true;
  }

  async invalidateEmailTokens(accountId: string, purpose: EmailTokenPurpose, at: Ms) {
    for (const row of this.t.emailTokens.values()) {
      if (row.accountId === accountId && row.purpose === purpose && row.usedAt === null) {
        row.usedAt = at;
      }
    }
  }

  async insertSession(record: SessionRecord): Promise<void> {
    this.t.sessions.set(record.id, copy(record));
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const row = this.t.sessions.get(id);
    return row ? copy(row) : null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>): Promise<void> {
    const row = this.t.sessions.get(id);
    if (row) Object.assign(row, copy(patch));
  }

  async listActiveSessions(accountId: string, now: Ms): Promise<SessionRecord[]> {
    return [...this.t.sessions.values()]
      .filter((s) => s.accountId === accountId && s.revokedAt === null && s.familyExpiresAt > now)
      .map(copy);
  }

  async revokeSession(id: string, reason: string, at: Ms): Promise<boolean> {
    const row = this.t.sessions.get(id);
    if (!row || row.revokedAt !== null) return false;
    row.revokedAt = at;
    row.revokeReason = reason;
    for (const token of this.t.refresh.values()) {
      if (token.sessionId === id && token.status === 'active') token.status = 'revoked';
    }
    return true;
  }

  async revokeSessions(accountId: string, reason: string, at: Ms, exceptId?: string) {
    const ids: string[] = [];
    for (const row of [...this.t.sessions.values()]) {
      if (row.accountId === accountId && row.id !== exceptId && row.revokedAt === null) {
        await this.revokeSession(row.id, reason, at);
        ids.push(row.id);
      }
    }
    return ids;
  }

  async insertRefresh(record: RefreshTokenRecord): Promise<void> {
    this.t.refresh.set(record.id, copy(record));
  }

  async findRefresh(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const row of this.t.refresh.values()) if (row.tokenHash === tokenHash) return copy(row);
    return null;
  }

  async swapRefreshStatus(id: string, from: RefreshStatus, to: RefreshStatus) {
    const row = this.t.refresh.get(id);
    if (!row || row.status !== from) return false;
    row.status = to;
    return true;
  }

  async insertOAuth(record: OAuthIdentityRecord): Promise<void> {
    if (await this.findOAuth(record.provider, record.providerUserId)) {
      throw new Error('oauth_identities_pkey');
    }
    this.t.oauth.push(copy(record));
  }

  async findOAuth(provider: string, providerUserId: string) {
    const row = this.t.oauth.find(
      (o) => o.provider === provider && o.providerUserId === providerUserId,
    );
    return row ? copy(row) : null;
  }

  async listOAuth(accountId: string): Promise<OAuthIdentityRecord[]> {
    return this.t.oauth.filter((o) => o.accountId === accountId).map(copy);
  }

  async deleteOAuth(accountId: string, provider: string): Promise<boolean> {
    const before = this.t.oauth.length;
    this.t.oauth = this.t.oauth.filter(
      (o) => !(o.accountId === accountId && o.provider === provider),
    );
    return this.t.oauth.length < before;
  }

  async getTotp(accountId: string): Promise<TotpRecord | null> {
    const row = this.t.totp.get(accountId);
    return row ? copy(row) : null;
  }

  async putTotp(record: TotpRecord): Promise<void> {
    this.t.totp.set(record.accountId, copy(record));
  }

  async deleteTotp(accountId: string): Promise<void> {
    this.t.totp.delete(accountId);
  }

  async advanceTotpStep(accountId: string, step: number): Promise<boolean> {
    const row = this.t.totp.get(accountId);
    if (!row || (row.lastUsedStep !== null && row.lastUsedStep >= step)) return false;
    row.lastUsedStep = step;
    return true;
  }

  async replaceBackupCodes(accountId: string, records: BackupCodeRecord[]): Promise<void> {
    for (const [id, row] of this.t.backup)
      if (row.accountId === accountId) this.t.backup.delete(id);
    for (const record of records) this.t.backup.set(record.id, copy(record));
  }

  async listBackupCodes(accountId: string): Promise<BackupCodeRecord[]> {
    return [...this.t.backup.values()].filter((b) => b.accountId === accountId).map(copy);
  }

  async markBackupCodeUsed(id: string, at: Ms): Promise<boolean> {
    const row = this.t.backup.get(id);
    if (!row || row.usedAt !== null) return false;
    row.usedAt = at;
    return true;
  }

  async insertBan(record: BanRecord): Promise<void> {
    this.t.bans.set(record.id, copy(record));
  }

  async findBan(id: string): Promise<BanRecord | null> {
    const row = this.t.bans.get(id);
    return row ? copy(row) : null;
  }

  async activeBan(accountId: string, now: Ms): Promise<BanRecord | null> {
    const rows = [...this.t.bans.values()]
      .filter(
        (b) =>
          b.accountId === accountId &&
          b.liftedAt === null &&
          (b.expiresAt === null || b.expiresAt > now),
      )
      .sort((a, b) => (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity));
    return rows[0] ? copy(rows[0]) : null;
  }

  async updateBan(id: string, patch: Partial<BanRecord>): Promise<void> {
    const row = this.t.bans.get(id);
    if (row) Object.assign(row, copy(patch));
  }

  async insertSecurityEvent(record: SecurityEventRecord): Promise<void> {
    this.t.events.push(copy(record));
  }

  async listSecurityEvents(accountId: string, page: PageRequest) {
    return pageOf(
      this.t.events.filter((e) => e.accountId === accountId),
      page,
    );
  }

  async knownDevice(accountId: string, ip: string, userAgent: string): Promise<boolean> {
    return this.t.events.some(
      (e) =>
        e.accountId === accountId &&
        e.type === 'login' &&
        e.outcome === 'success' &&
        e.ip === ip &&
        e.userAgent === userAgent,
    );
  }

  async insertAudit(record: AuditRecord): Promise<void> {
    this.t.audit.push(copy(record));
  }

  async listAudit(page: PageRequest): Promise<Page<AuditRecord>> {
    return pageOf(this.t.audit, page);
  }

  async insertOutbox(record: OutboxRecord): Promise<void> {
    this.t.outbox.set(record.id, copy(record));
  }

  async claimOutbox(now: Ms, limit: number, leaseMs: number): Promise<OutboxRecord[]> {
    const due = [...this.t.outbox.values()]
      .filter((o) => o.status === 'pending' && o.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || (a.id < b.id ? -1 : 1))
      .slice(0, limit);
    for (const row of due) row.nextAttemptAt = now + leaseMs;
    return due.map(copy);
  }

  async updateOutbox(id: string, patch: Partial<OutboxRecord>): Promise<void> {
    const row = this.t.outbox.get(id);
    if (row) Object.assign(row, copy(patch));
  }

  async findOutbox(id: string): Promise<OutboxRecord | null> {
    const row = this.t.outbox.get(id);
    return row ? copy(row) : null;
  }

  /** Для тестов: все записи outbox. */
  outboxRows(): OutboxRecord[] {
    return [...this.t.outbox.values()].map(copy);
  }
}
