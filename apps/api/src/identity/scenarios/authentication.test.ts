import { describe, expect, it } from 'vitest';
import { DAY, MINUTE } from '../core/index.js';
import { META, PASSWORD, harness, rejects } from '../testing/harness.test-helper.js';

describe('identity/authentication', () => {
  it('вход без 2FA: сессия, JWT EdDSA с нужными полями, проверка по JWKS', async () => {
    const h = harness();
    const account = await h.activeAccount('hero@example.com');
    const session = await h.login('hero@example.com');
    expect(session).toMatchObject({
      status: 'authenticated',
      expiresIn: 900,
      accessLevel: 'player',
    });
    const [head, body] = session.accessToken.split('.');
    expect(JSON.parse(Buffer.from(head ?? '', 'base64url').toString())).toMatchObject({
      alg: 'EdDSA',
      kid: 'test',
    });
    const claims = JSON.parse(Buffer.from(body ?? '', 'base64url').toString());
    expect(claims).toMatchObject({
      sub: account.id,
      sid: session.sessionId,
      acl: 'player',
      eacl: 'player',
      mfa: false,
      ver: 1,
    });
    expect(claims.exp - claims.iat).toBe(900);
    expect(Object.keys(claims).sort()).toEqual([
      'acl',
      'aud',
      'eacl',
      'exp',
      'iat',
      'iss',
      'jti',
      'mfa',
      'sid',
      'sub',
      'ver',
    ]);
    expect(h.identity.deps.keys.jwks(h.clock.utc()).keys.map((k) => k.kid)).toEqual(['test']);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('неверный пароль и несуществующий email — одна ошибка', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    await rejects(
      h.auth.login('hero@example.com', 'неверный пароль 123', META),
      'AUTH_INVALID_CREDENTIALS',
      401,
    );
    await rejects(
      h.auth.login('ghost@example.com', PASSWORD, META),
      'AUTH_INVALID_CREDENTIALS',
      401,
    );
    await rejects(h.auth.login('не email', PASSWORD, META), 'AUTH_INVALID_CREDENTIALS');
  });

  it('просроченный, поддельный, отсутствующий Access JWT', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const session = await h.login('hero@example.com');
    expect((await h.auth.authenticate(session.accessToken)).accountId).toBeTruthy();
    await rejects(h.auth.authenticate(`${session.accessToken}x`), 'AUTH_TOKEN_INVALID', 401);
    await rejects(h.auth.authenticate(undefined), 'AUTH_UNAUTHENTICATED', 401);
    h.clock.advance(900_000);
    await rejects(h.auth.authenticate(session.accessToken), 'AUTH_TOKEN_EXPIRED', 401);
  });

  it('refresh: ротация, новый токен, старый — повтор и отзыв семейства', async () => {
    const h = harness();
    const account = await h.activeAccount('hero@example.com');
    const r1 = await h.login('hero@example.com');
    h.clock.advance(MINUTE);
    const r2 = await h.auth.refresh(r1.refreshToken, META);
    expect(r2.sessionId).toBe(r1.sessionId);
    expect(r2.refreshToken).not.toBe(r1.refreshToken);
    expect(r2.refreshExpiresAt).toBe(h.clock.utc() + 30 * DAY);
    const reuse = await rejects(
      h.auth.refresh(r1.refreshToken, META),
      'AUTH_TOKEN_REUSE_DETECTED',
      401,
    );
    expect(reuse.options.clearRefresh).toBe(true);
    await rejects(h.auth.refresh(r2.refreshToken, META), 'AUTH_SESSION_REVOKED', 401);
    await rejects(h.auth.authenticate(r2.accessToken), 'AUTH_SESSION_REVOKED', 401);
    const events = await h.store.listSecurityEvents(account.id, { limit: 10 });
    expect(events.items.map((e) => e.type)).toContain('refresh_reuse');
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('сессия отозвана');
    expect(h.events.of('identity.account.sessions_revoked')).toEqual([
      expect.objectContaining({ sessionIds: [r1.sessionId], reason: 'token_reuse' }),
    ]);
  });

  it('refresh: без cookie, неизвестный, предел семейства 90 суток, скольжение 30 суток', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    await rejects(h.auth.refresh(undefined, META), 'AUTH_REFRESH_TOKEN_MISSING', 401);
    await rejects(h.auth.refresh('A'.repeat(43), META), 'AUTH_TOKEN_INVALID');
    let current = await h.login('hero@example.com');
    for (let i = 0; i < 3; i++) {
      h.clock.advance(29 * DAY);
      current = await h.auth.refresh(current.refreshToken, META);
    }
    h.clock.advance(4 * DAY);
    const expired = await rejects(
      h.auth.refresh(current.refreshToken, META),
      'AUTH_SESSION_EXPIRED',
      401,
    );
    expect(expired.options.clearRefresh).toBe(true);
    const idle = await h.login('hero@example.com');
    h.clock.advance(30 * DAY + 1);
    await rejects(h.auth.refresh(idle.refreshToken, META), 'AUTH_SESSION_EXPIRED');
  });

  it('refresh: межсайтовый Origin отклоняется без ротации', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const session = await h.login('hero@example.com');
    await rejects(
      h.auth.refresh(session.refreshToken, { ...META, origin: 'https://evil.example' }),
      'AUTH_CSRF_ORIGIN_MISMATCH',
      403,
    );
    await rejects(
      h.auth.refresh(session.refreshToken, { ...META, origin: undefined }),
      'AUTH_CSRF_ORIGIN_MISMATCH',
    );
    expect((await h.auth.refresh(session.refreshToken, META)).status).toBe('authenticated');
  });

  it('выход и выход со всех устройств', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const a = await h.login('hero@example.com');
    const b = await h.login('hero@example.com');
    const c = await h.login('hero@example.com');
    await h.auth.logout(await h.auth.authenticate(a.accessToken), META);
    await rejects(h.auth.authenticate(a.accessToken), 'AUTH_SESSION_REVOKED');
    await rejects(h.auth.refresh(a.refreshToken, META), 'AUTH_SESSION_REVOKED');
    const keep = await h.auth.logoutAll(await h.auth.authenticate(b.accessToken), true, META);
    expect(keep).toEqual({ revoked: 1 });
    await rejects(h.auth.authenticate(c.accessToken), 'AUTH_SESSION_REVOKED');
    expect((await h.auth.authenticate(b.accessToken)).sessionId).toBe(b.sessionId);
    const d = await h.login('hero@example.com');
    expect(await h.auth.logoutAll(await h.auth.authenticate(d.accessToken), false, META)).toEqual({
      revoked: 2,
    });
    await rejects(h.auth.authenticate(b.accessToken), 'AUTH_SESSION_REVOKED');
    await h.flush();
    expect(h.events.of('identity.account.sessions_revoked').length).toBeGreaterThanOrEqual(3);
  });

  it('лимит 10 сессий: вытесняется самая давняя по активности', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const sessions = [];
    for (let i = 0; i < 10; i++) {
      sessions.push(await h.login('hero@example.com'));
      h.clock.advance(1000);
    }
    h.clock.advance(1000);
    await h.auth.refresh(sessions[0]!.refreshToken, META);
    await h.login('hero@example.com');
    const account = (await h.store.findAccountByEmail('hero@example.com'))!;
    const active = await h.store.listActiveSessions(account.id, h.clock.utc());
    expect(active).toHaveLength(10);
    expect((await h.store.findSession(sessions[1]!.sessionId))?.revokeReason).toBe(
      'session_limit_exceeded',
    );
    expect((await h.store.findSession(sessions[0]!.sessionId))?.revokedAt).toBeNull();
  });

  it('отозванные и истёкшие сессии не занимают лимит', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    for (let i = 0; i < 8; i++) {
      const s = await h.login('hero@example.com');
      await h.auth.logout(await h.auth.authenticate(s.accessToken), META);
    }
    for (let i = 0; i < 10; i++) await h.login('hero@example.com');
    const account = (await h.store.findAccountByEmail('hero@example.com'))!;
    const all = await h.store.listActiveSessions(account.id, h.clock.utc());
    expect(all).toHaveLength(10);
    expect(h.events.of('identity.account.sessions_revoked')).toHaveLength(0);
  });

  it('свежее подтверждение личности: пароль или 10 минут после входа', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const session = await h.login('hero@example.com');
    const principal = await h.auth.authenticate(session.accessToken);
    await h.auth.requireFresh(principal);
    h.clock.advance(10 * MINUTE + 1);
    await rejects(h.auth.requireFresh(principal), 'AUTH_REAUTH_REQUIRED', 403);
    await rejects(h.auth.requireFresh(principal, 'неверный пароль 12'), 'AUTH_INVALID_CREDENTIALS');
    await h.auth.requireFresh(principal, PASSWORD);
    await h.auth.requireFresh(principal);
    expect(await h.security.reauth(principal, { password: PASSWORD })).toEqual({
      status: 'reauthenticated',
    });
    await rejects(h.security.reauth(principal, {}), 'AUTH_REAUTH_REQUIRED');
    await rejects(h.security.reauth(principal, { code: '123456' }), 'TFA_NOT_ENABLED');
  });

  it('пересчёт хэша при входе со старыми параметрами', async () => {
    const h = harness();
    const account = await h.activeAccount('hero@example.com');
    const { PasswordHasher } = await import('../crypto/password.js');
    const legacy = await new PasswordHasher({ memoryKiB: 2048, timeCost: 1 }).hash(PASSWORD);
    await h.store.updateAccount(account.id, { passwordHash: legacy });
    await h.login('hero@example.com');
    expect((await h.store.findAccount(account.id))?.passwordHash).toMatch(/m=1024,t=1/);
  });
});
