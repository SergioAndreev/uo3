import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AccountRecord, IdentityStore, KeyValue, SessionRecord } from '../ports.js';

const T0 = Date.UTC(2026, 10, 26, 12);
const DAY = 86_400_000;

export const account = (over: Partial<AccountRecord> = {}): AccountRecord => ({
  id: randomUUID(),
  email: `${randomUUID()}@example.com`,
  passwordHash: 'hash',
  status: 'active',
  accessLevel: 'player',
  effectiveLevel: 'player',
  emailVerifiedAt: T0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const session = (accountId: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: randomUUID(),
  accountId,
  createdAt: T0,
  lastUsedAt: T0,
  familyExpiresAt: T0 + 90 * DAY,
  revokedAt: null,
  revokeReason: null,
  mfa: false,
  reauthAt: null,
  ip: '203.0.113.1',
  userAgent: 'ua',
  ...over,
});

/** Контракт хранилища: один набор для памяти и PostgreSQL. */
export function storeContract(name: string, make: () => Promise<IdentityStore>): void {
  describe(`IdentityStore: ${name}`, () => {
    it('аккаунты: email уникален среди живых, обновление, список по уровню', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      expect(await store.findAccount(a.id)).toEqual(a);
      expect(await store.findAccountByEmail(a.email)).toEqual(a);
      await expect(store.insertAccount(account({ email: a.email }))).rejects.toThrow();
      await store.updateAccount(a.id, { accessLevel: 'owner', updatedAt: T0 + 1 });
      expect((await store.listAccountsByLevel('owner')).map((r) => r.id)).toContain(a.id);
      expect(await store.findAccount(randomUUID())).toBeNull();
    });

    it('неподтверждённые истекают и освобождают email; транзакция откатывается', async () => {
      const store = await make();
      const pending = account({ status: 'pending_verification', createdAt: T0 - 8 * DAY });
      const fresh = account({ status: 'pending_verification', createdAt: T0 - DAY });
      await store.insertAccount(pending);
      await store.insertAccount(fresh);
      const expired = await store.expirePending(T0 - 7 * DAY, T0);
      expect(expired).toContain(pending.id);
      expect(expired).not.toContain(fresh.id);
      expect(await store.findAccountByEmail(pending.email)).toBeNull();
      await store.insertAccount(account({ email: pending.email }));
      const extra = account();
      await expect(
        store.transaction(async (tx) => {
          await tx.insertAccount(extra);
          throw new Error('откат');
        }),
      ).rejects.toThrow('откат');
      expect(await store.findAccount(extra.id)).toBeNull();
      expect(await store.transaction(async (tx) => tx.lockOwners().then(() => 7))).toBe(7);
    });

    it('документы и токены писем', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      expect(await store.latestTos(a.id)).toBeNull();
      const tos = {
        id: randomUUID(),
        accountId: a.id,
        tosVersion: '1',
        privacyVersion: '1',
        ip: '1.1.1.1',
        userAgent: 'ua',
        acceptedAt: T0,
      };
      await store.insertTos(tos);
      expect(await store.latestTos(a.id)).toEqual(tos);
      const token = {
        id: randomUUID(),
        accountId: a.id,
        purpose: 'verify' as const,
        tokenHash: randomUUID().replace(/-/g, ''),
        newEmail: null,
        createdAt: T0,
        expiresAt: T0 + DAY,
        usedAt: null,
      };
      await store.insertEmailToken(token);
      expect(await store.findEmailToken(token.tokenHash)).toEqual(token);
      expect(await store.markEmailTokenUsed(token.id, T0)).toBe(true);
      expect(await store.markEmailTokenUsed(token.id, T0)).toBe(false);
      const second = { ...token, id: randomUUID(), tokenHash: randomUUID().replace(/-/g, '') };
      await store.insertEmailToken(second);
      await store.invalidateEmailTokens(a.id, 'verify', T0 + 5);
      expect((await store.findEmailToken(second.tokenHash))?.usedAt).toBe(T0 + 5);
    });

    it('сессии и refresh: отзыв, исключение текущей, условная смена статуса', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      const [s1, s2, s3] = [session(a.id), session(a.id), session(a.id, { familyExpiresAt: T0 })];
      for (const s of [s1, s2, s3]) await store.insertSession(s);
      const r1 = {
        id: randomUUID(),
        sessionId: s1.id,
        tokenHash: randomUUID().replace(/-/g, ''),
        status: 'active' as const,
        createdAt: T0,
        expiresAt: T0 + DAY,
      };
      await store.insertRefresh(r1);
      expect(await store.findRefresh(r1.tokenHash)).toEqual(r1);
      expect(await store.swapRefreshStatus(r1.id, 'active', 'rotated')).toBe(true);
      expect(await store.swapRefreshStatus(r1.id, 'active', 'rotated')).toBe(false);
      expect((await store.listActiveSessions(a.id, T0)).map((s) => s.id).sort()).toEqual(
        [s1.id, s2.id].sort(),
      );
      await store.updateSession(s2.id, { lastUsedAt: T0 + 9 });
      expect((await store.findSession(s2.id))?.lastUsedAt).toBe(T0 + 9);
      const revoked = await store.revokeSessions(a.id, 'logout_all', T0 + 1, s2.id);
      expect(revoked.sort()).toEqual([s1.id, s3.id].sort());
      expect((await store.findRefresh(r1.tokenHash))?.status).toBe('rotated');
      expect(await store.revokeSession(s2.id, 'logout', T0 + 2)).toBe(true);
      expect(await store.revokeSession(s2.id, 'logout', T0 + 2)).toBe(false);
      expect((await store.findSession(s2.id))?.revokeReason).toBe('logout');
      expect(await store.findSession(randomUUID())).toBeNull();
    });

    it('OAuth: уникальная пара провайдер+id', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      const link = {
        provider: 'google',
        providerUserId: randomUUID(),
        accountId: a.id,
        email: a.email,
        linkedAt: T0,
      };
      await store.insertOAuth(link);
      await expect(store.insertOAuth(link)).rejects.toThrow();
      expect(await store.findOAuth('google', link.providerUserId)).toEqual(link);
      expect(await store.listOAuth(a.id)).toEqual([link]);
      expect(await store.deleteOAuth(a.id, 'google')).toBe(true);
      expect(await store.deleteOAuth(a.id, 'google')).toBe(false);
    });

    it('TOTP: шаг только растёт; резервные коды одноразовые', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      expect(await store.advanceTotpStep(a.id, 1)).toBe(false);
      const totp = {
        accountId: a.id,
        status: 'enabled' as const,
        ciphertext: 'c',
        iv: 'i',
        tag: 't',
        keyVersion: '1',
        lastUsedStep: null,
        setupTokenHash: null,
        setupExpiresAt: null,
        enabledAt: T0,
      };
      await store.putTotp(totp);
      expect(await store.getTotp(a.id)).toEqual(totp);
      expect(await store.advanceTotpStep(a.id, 10)).toBe(true);
      expect(await store.advanceTotpStep(a.id, 10)).toBe(false);
      expect(await store.advanceTotpStep(a.id, 9)).toBe(false);
      expect(await store.advanceTotpStep(a.id, 11)).toBe(true);
      await store.putTotp({ ...totp, status: 'pending' });
      expect((await store.getTotp(a.id))?.status).toBe('pending');
      await store.deleteTotp(a.id);
      expect(await store.getTotp(a.id)).toBeNull();
      const codes = [1, 2].map((n) => ({
        id: randomUUID(),
        accountId: a.id,
        codeHash: `h${n}`,
        usedAt: null,
      }));
      await store.replaceBackupCodes(a.id, codes);
      expect(await store.markBackupCodeUsed(codes[0]?.id ?? '', T0)).toBe(true);
      expect(await store.markBackupCodeUsed(codes[0]?.id ?? '', T0)).toBe(false);
      await store.replaceBackupCodes(a.id, codes.slice(1));
      expect((await store.listBackupCodes(a.id)).map((c) => c.codeHash)).toEqual(['h2']);
    });

    it('баны: действующий, истёкший, снятый', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      const ban = {
        id: randomUUID(),
        accountId: a.id,
        issuedBy: randomUUID(),
        reason: 'причина бана',
        createdAt: T0,
        expiresAt: T0 + DAY,
        liftedAt: null,
        liftedBy: null,
        liftReason: null,
      };
      await store.insertBan(ban);
      expect(await store.findBan(ban.id)).toEqual(ban);
      expect((await store.activeBan(a.id, T0))?.id).toBe(ban.id);
      expect(await store.activeBan(a.id, T0 + DAY)).toBeNull();
      await store.updateBan(ban.id, { liftedAt: T0 + 1, liftedBy: ban.issuedBy, liftReason: 'r' });
      expect(await store.activeBan(a.id, T0 + 2)).toBeNull();
      const forever = { ...ban, id: randomUUID(), expiresAt: null };
      await store.insertBan(forever);
      expect((await store.activeBan(a.id, T0 + 100 * DAY))?.id).toBe(forever.id);
    });

    it('журналы: страницы по убыванию, since, известное устройство', async () => {
      const store = await make();
      const a = account();
      await store.insertAccount(a);
      for (let i = 0; i < 5; i++) {
        await store.insertSecurityEvent({
          id: randomUUID(),
          accountId: a.id,
          type: 'login',
          outcome: i % 2 ? 'failure' : 'success',
          reasonCode: null,
          ip: `203.0.113.${i}`,
          userAgent: 'ua',
          at: T0 + i * 1000,
        });
      }
      const first = await store.listSecurityEvents(a.id, { limit: 2 });
      expect(first.items.map((e) => e.at)).toEqual([T0 + 4000, T0 + 3000]);
      const second = await store.listSecurityEvents(a.id, {
        limit: 2,
        cursor: first.nextCursor ?? '',
      });
      expect(second.items.map((e) => e.at)).toEqual([T0 + 2000, T0 + 1000]);
      const last = await store.listSecurityEvents(a.id, {
        limit: 2,
        cursor: second.nextCursor ?? '',
      });
      expect(last).toEqual({ items: [expect.objectContaining({ at: T0 })], nextCursor: null });
      expect(
        (await store.listSecurityEvents(a.id, { limit: 9, since: T0 + 3000 })).items,
      ).toHaveLength(2);
      expect(await store.knownDevice(a.id, '203.0.113.0', 'ua')).toBe(true);
      expect(await store.knownDevice(a.id, '203.0.113.1', 'ua')).toBe(false);
      await store.insertAudit({
        id: randomUUID(),
        actorId: a.id,
        targetId: null,
        action: 'access_level.change',
        outcome: 'denied',
        before: { level: 'player' },
        after: null,
        reason: null,
        ip: '1.1.1.1',
        userAgent: 'ua',
        at: T0,
      });
      const audit = await store.listAudit({ limit: 100, since: T0 });
      expect(audit.items.at(-1)).toMatchObject({ before: { level: 'player' }, after: null });
    });

    it('outbox: захват с арендой и обновление', async () => {
      const store = await make();
      const row = {
        id: randomUUID(),
        kind: 'email' as const,
        payload: { to: 'a@b.cd' },
        status: 'pending' as const,
        attempts: 0,
        nextAttemptAt: T0,
        lastError: null,
        createdAt: T0,
      };
      await store.insertOutbox(row);
      const claimed = await store.claimOutbox(T0, 1000, 60_000);
      expect(claimed.map((r) => r.id)).toContain(row.id);
      expect((await store.claimOutbox(T0, 1000, 60_000)).map((r) => r.id)).not.toContain(row.id);
      await store.updateOutbox(row.id, { status: 'done', attempts: 1 });
      expect(await store.findOutbox(row.id)).toMatchObject({ status: 'done', attempts: 1 });
    });
  });
}

/** Контракт ключ-значение; `advance` двигает время на мс. */
export function keyValueContract(
  name: string,
  make: () => Promise<{ kv: KeyValue; advance: (ms: number) => Promise<void> }>,
): void {
  describe(`KeyValue: ${name}`, () => {
    it('get/set/del/take/many', async () => {
      const { kv } = await make();
      const key = `t:${randomUUID()}`;
      expect(await kv.get(key)).toBeNull();
      await kv.set(key, 'v', 60_000);
      expect(await kv.many([key, `${key}:x`])).toEqual(['v', null]);
      expect(await kv.many([])).toEqual([]);
      expect(await kv.take(key)).toBe('v');
      expect(await kv.take(key)).toBeNull();
      await kv.set(key, 'v', 60_000);
      await kv.del(key);
      expect(await kv.get(key)).toBeNull();
    });

    it('incr с TTL от первого увеличения; истечение', async () => {
      const { kv, advance } = await make();
      const key = `t:${randomUUID()}`;
      expect(await kv.incr(key, 1000)).toBe(1);
      expect(await kv.incr(key, 1000)).toBe(2);
      const left = await kv.ttl(key);
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThanOrEqual(1000);
      await advance(1100);
      expect(await kv.get(key)).toBeNull();
      expect(await kv.ttl(key)).toBe(0);
      expect(await kv.incr(key, 1000)).toBe(1);
    });
  });
}
