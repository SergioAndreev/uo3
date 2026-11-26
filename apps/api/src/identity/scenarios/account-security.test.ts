import { describe, expect, it } from 'vitest';
import { DAY, MINUTE } from '../core/index.js';
import { META, PASSWORD, harness, rejects } from '../testing/harness.test-helper.js';

const WRONG = 'неверный пароль 123';
const NEW_PASSWORD = 'новая длинная парольная фраза';

describe('identity/account-security: перебор', () => {
  it('5 неудач — блок 15 минут даже с верным паролем; письмо; повторная серия — 60 минут', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    for (let i = 0; i < 5; i++)
      await rejects(h.auth.login('hero@example.com', WRONG, META), 'AUTH_INVALID_CREDENTIALS');
    const locked = await rejects(
      h.auth.login('hero@example.com', PASSWORD, META),
      'SEC_LOGIN_LOCKED',
      429,
    );
    expect(locked.options.retryAfterS).toBe(900);
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('подозрительные попытки');
    h.clock.advance(15 * MINUTE);
    for (let i = 0; i < 5; i++)
      await rejects(h.auth.login('hero@example.com', WRONG, META), 'AUTH_INVALID_CREDENTIALS');
    const again = await rejects(
      h.auth.login('hero@example.com', PASSWORD, META),
      'SEC_LOGIN_LOCKED',
    );
    expect(again.options.retryAfterS).toBe(3600);
  });

  it('успешный вход обнуляет счётчик', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    for (let i = 0; i < 3; i++)
      await rejects(h.auth.login('hero@example.com', WRONG, META), 'AUTH_INVALID_CREDENTIALS');
    await h.login('hero@example.com');
    for (let i = 0; i < 4; i++)
      await rejects(h.auth.login('hero@example.com', WRONG, META), 'AUTH_INVALID_CREDENTIALS');
    expect((await h.auth.login('hero@example.com', PASSWORD, META)).status).toBe('authenticated');
  });

  it('IP: 21-я неудача к разным адресам за 15 минут', async () => {
    const h = harness();
    for (let i = 0; i < 20; i++)
      await rejects(h.auth.login(`u${i}@example.com`, WRONG, META), 'AUTH_INVALID_CREDENTIALS');
    const limited = await rejects(
      h.auth.login('u21@example.com', WRONG, META),
      'SEC_IP_RATE_LIMITED',
      429,
    );
    expect(limited.options.retryAfterS).toBeGreaterThan(0);
  });
});

describe('identity/account-security: баны', () => {
  it('временный бан модератором: сессии отозваны, событие, письмо, отказ во входе и refresh', async () => {
    const h = harness();
    const target = await h.activeAccount('hero@example.com');
    const session = await h.login('hero@example.com');
    const mod = await h.staffSession('mod@example.com', 'moderator');
    const expiresAt = new Date(h.clock.utc() + 7 * DAY).toISOString();
    const result = await h.staff.ban(
      mod.principal,
      target.id,
      { reason: 'оскорбления в общем чате, 3 эпизода', expiresAt },
      META,
    );
    expect(result.revokedSessions).toBe(1);
    await rejects(h.auth.authenticate(session.accessToken), 'AUTH_SESSION_REVOKED');
    await rejects(h.auth.refresh(session.refreshToken, META), 'AUTH_SESSION_REVOKED');
    const denied = await rejects(
      h.auth.login('hero@example.com', PASSWORD, META),
      'SEC_ACCOUNT_BANNED',
      403,
    );
    expect(denied.options.details).toEqual({
      reason: 'оскорбления в общем чате, 3 эпизода',
      expiresAt,
    });
    await h.flush();
    expect(h.events.of('identity.account.banned')).toEqual([
      expect.objectContaining({ accountId: target.id, banId: result.banId, expiresAt }),
    ]);
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('заблокирован');
  });

  it('модератор: без постоянного бана и сверх 30 суток; причина 10–1000', async () => {
    const h = harness();
    const target = await h.activeAccount('hero@example.com');
    const mod = await h.staffSession('mod@example.com', 'moderator');
    await rejects(
      h.staff.ban(mod.principal, target.id, { reason: 'постоянный бан без срока' }, META),
      'RBAC_INSUFFICIENT_PERMISSION',
      403,
    );
    const long = new Date(h.clock.utc() + 31 * DAY).toISOString();
    await rejects(
      h.staff.ban(
        mod.principal,
        target.id,
        { reason: 'слишком долгий бан', expiresAt: long },
        META,
      ),
      'RBAC_INSUFFICIENT_PERMISSION',
    );
    await rejects(
      h.staff.ban(mod.principal, target.id, { reason: 'коротко' }, META),
      'SEC_BAN_REASON_INVALID',
      400,
    );
    await rejects(
      h.staff.ban(mod.principal, target.id, { reason: 'x'.repeat(1001) }, META),
      'SEC_BAN_REASON_INVALID',
    );
    const past = new Date(h.clock.utc() - 1).toISOString();
    await rejects(
      h.staff.ban(mod.principal, target.id, { reason: 'срок в прошлом', expiresAt: past }, META),
      'SEC_VALIDATION_FAILED',
    );
    const admin = await h.staffSession('admin@example.com', 'administrator');
    await h.staff.ban(admin.principal, target.id, { reason: 'мошенничество при обмене' }, META);
    h.clock.advance(365 * DAY);
    await rejects(h.auth.login('hero@example.com', PASSWORD, META), 'SEC_ACCOUNT_BANNED');
  });

  it('временный бан истекает сам; досрочное снятие администратором', async () => {
    const h = harness();
    const target = await h.activeAccount('hero@example.com');
    const mod = await h.staffSession('mod@example.com', 'moderator');
    const expiresAt = new Date(h.clock.utc() + DAY).toISOString();
    const { banId } = await h.staff.ban(
      mod.principal,
      target.id,
      { reason: 'флуд в торговом канале', expiresAt },
      META,
    );
    await rejects(
      h.staff.lift(mod.principal, banId, 'ошибочный бан модератора', META),
      'RBAC_INSUFFICIENT_PERMISSION',
    );
    h.clock.advance(DAY);
    expect((await h.auth.login('hero@example.com', PASSWORD, META)).status).toBe('authenticated');

    const admin = await h.staffSession('admin@example.com', 'administrator');
    const second = await h.staff.ban(
      admin.principal,
      target.id,
      { reason: 'повторный флуд в торговле' },
      META,
    );
    await rejects(
      h.staff.lift(admin.principal, second.banId, 'коротко', META),
      'SEC_BAN_REASON_INVALID',
    );
    await h.staff.lift(admin.principal, second.banId, 'апелляция принята после проверки', META);
    expect(await h.store.findBan(second.banId)).toMatchObject({
      liftedBy: admin.account.id,
      liftReason: 'апелляция принята после проверки',
    });
    await rejects(
      h.staff.lift(admin.principal, second.banId, 'апелляция принята повторно', META),
      'SEC_BAN_NOT_FOUND',
      404,
    );
    expect((await h.auth.login('hero@example.com', PASSWORD, META)).status).toBe('authenticated');
    await h.flush();
    expect(h.events.of('identity.account.unbanned')).toHaveLength(1);
  });

  it('быстрый кэш бана отклоняет действующий токен', async () => {
    const h = harness();
    const target = await h.activeAccount('hero@example.com');
    const mod = await h.staffSession('mod@example.com', 'moderator');
    const session = await h.login('hero@example.com');
    await h.kv.del(`identity:revoked-sid:${session.sessionId}`);
    await h.staff.ban(
      mod.principal,
      target.id,
      {
        reason: 'нарушение правил торговли',
        expiresAt: new Date(h.clock.utc() + DAY).toISOString(),
      },
      META,
    );
    await h.kv.del(`identity:revoked-sid:${session.sessionId}`);
    await rejects(h.auth.authenticate(session.accessToken), 'SEC_ACCOUNT_BANNED');
  });
});

describe('identity/account-security: пароли и email', () => {
  it('сброс: письмо, новый пароль, все сессии отозваны, 2FA сохранена', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const session = await h.login('hero@example.com');
    await h.enableTfa(session);
    h.clock.advance(MINUTE + 1);
    expect(await h.security.requestReset('hero@example.com', META)).toEqual({ status: 'accepted' });
    await h.flush();
    const token = h.mail.lastToken('hero@example.com') ?? '';
    await rejects(h.security.confirmReset(token, 'short', META), 'REG_WEAK_PASSWORD');
    expect(await h.security.confirmReset(token, NEW_PASSWORD, META)).toEqual({
      status: 'password_reset',
    });
    await rejects(
      h.security.confirmReset(token, NEW_PASSWORD, META),
      'SEC_RESET_TOKEN_INVALID',
      400,
    );
    const account = (await h.store.findAccountByEmail('hero@example.com'))!;
    expect(await h.store.listActiveSessions(account.id, h.clock.utc())).toEqual([]);
    expect((await h.store.getTotp(account.id))?.status).toBe('enabled');
    expect((await h.auth.login('hero@example.com', NEW_PASSWORD, META)).status).toBe(
      'mfa_required',
    );
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('пароль изменён');
  });

  it('сброс: срок 30 минут, неизвестный адрес, кулдаун', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    h.clock.advance(MINUTE + 1);
    await h.security.requestReset('hero@example.com', META);
    await h.flush();
    const sent = h.mail.sent.length;
    await h.security.requestReset('hero@example.com', META);
    expect(await h.security.requestReset('ghost@example.com', META)).toEqual({
      status: 'accepted',
    });
    expect(await h.security.requestReset('не адрес', META)).toEqual({ status: 'accepted' });
    await h.flush();
    expect(h.mail.sent.length).toBe(sent);
    h.clock.advance(31 * MINUTE);
    await rejects(
      h.security.confirmReset(h.mail.lastToken('hero@example.com') ?? '', NEW_PASSWORD, META),
      'SEC_RESET_TOKEN_EXPIRED',
      410,
    );
    for (let i = 0; i < 20; i++)
      await h.security
        .requestReset(`x${i}@example.com`, { ...META, ip: '203.0.113.99' })
        .catch(() => undefined);
    await rejects(
      h.security.requestReset('y@example.com', { ...META, ip: '203.0.113.99' }),
      'SEC_IP_RATE_LIMITED',
    );
  });

  it('смена пароля: прочие сессии отозваны, текущая жива; ошибки', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const current = await h.login('hero@example.com');
    const a = await h.login('hero@example.com');
    const b = await h.login('hero@example.com');
    const principal = await h.auth.authenticate(current.accessToken);
    await rejects(
      h.security.changePassword(
        principal,
        { currentPassword: WRONG, newPassword: NEW_PASSWORD },
        META,
      ),
      'AUTH_INVALID_CREDENTIALS',
      401,
    );
    await rejects(
      h.security.changePassword(
        principal,
        { currentPassword: PASSWORD, newPassword: PASSWORD },
        META,
      ),
      'SEC_PASSWORD_SAME_AS_CURRENT',
      400,
    );
    expect(
      await h.security.changePassword(
        principal,
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        META,
      ),
    ).toEqual({ revoked: 2 });
    await rejects(h.auth.authenticate(a.accessToken), 'AUTH_SESSION_REVOKED');
    await rejects(h.auth.authenticate(b.accessToken), 'AUTH_SESSION_REVOKED');
    await h.auth.authenticate(current.accessToken);
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('пароль изменён');
  });

  it('смена пароля с 2FA требует код; первичная установка пароля OAuth-аккаунту', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const tfa = await h.enableTfa(await h.login('hero@example.com'));
    const principal = await h.auth.authenticate(tfa.session.accessToken);
    await rejects(
      h.security.changePassword(
        principal,
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        META,
      ),
      'TFA_INVALID_CODE',
    );
    await h.security.changePassword(
      principal,
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, code: tfa.code() },
      META,
    );
    const account = (await h.store.findAccountByEmail('hero@example.com'))!;
    await h.store.updateAccount(account.id, { passwordHash: null });
    h.clock.advance(30_000);
    await h.security.changePassword(principal, { newPassword: PASSWORD, code: tfa.code() }, META);
    expect((await h.store.findAccount(account.id))?.passwordHash).toMatch(/^\$argon2id/);
  });

  it('смена email: письмо на новый адрес, предупреждение на старый, подтверждение', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const current = await h.login('hero@example.com');
    const principal = await h.auth.authenticate(current.accessToken);
    await rejects(
      h.security.requestEmailChange(
        principal,
        { newEmail: 'new@example.com', password: WRONG },
        META,
      ),
      'AUTH_INVALID_CREDENTIALS',
    );
    await rejects(
      h.security.requestEmailChange(principal, { newEmail: 'плохой', password: PASSWORD }, META),
      'REG_INVALID_EMAIL',
    );
    await rejects(
      h.security.requestEmailChange(
        principal,
        { newEmail: 'a@trash.example', password: PASSWORD },
        META,
      ),
      'REG_EMAIL_DOMAIN_BLOCKED',
    );
    expect(
      await h.security.requestEmailChange(
        principal,
        { newEmail: 'New@Example.com', password: PASSWORD },
        META,
      ),
    ).toEqual({ status: 'accepted' });
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('запрошена смена адреса');
    const token = h.mail.lastToken('new@example.com') ?? '';
    expect(await h.security.confirmEmailChange(token, META)).toEqual({ status: 'email_changed' });
    expect(await h.store.findAccountByEmail('new@example.com')).not.toBeNull();
    await rejects(h.auth.authenticate(current.accessToken), 'AUTH_SESSION_REVOKED');
    await rejects(
      h.security.confirmEmailChange(token, META),
      'SEC_EMAIL_CHANGE_TOKEN_INVALID',
      400,
    );
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('адрес изменён');
  });

  it('смена email на занятый адрес — тот же ответ без токена; истечение 2 часов', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    await h.activeAccount('taken@example.com');
    const principal = await h.auth.authenticate((await h.login('hero@example.com')).accessToken);
    const before = h.mail.to('taken@example.com').length;
    expect(
      await h.security.requestEmailChange(
        principal,
        { newEmail: 'taken@example.com', password: PASSWORD },
        META,
      ),
    ).toEqual({ status: 'accepted' });
    await h.flush();
    expect(h.mail.to('taken@example.com')).toHaveLength(before + 1);
    expect(h.mail.lastToken('taken@example.com')).toBeUndefined();
    await h.security.requestEmailChange(
      principal,
      { newEmail: 'later@example.com', password: PASSWORD },
      META,
    );
    await h.flush();
    h.clock.advance(2 * 60 * MINUTE + 1);
    await rejects(
      h.security.confirmEmailChange(h.mail.lastToken('later@example.com') ?? '', META),
      'SEC_EMAIL_CHANGE_TOKEN_EXPIRED',
      410,
    );
    expect(await h.store.findAccountByEmail('hero@example.com')).not.toBeNull();
  });
});

describe('identity/account-security: сессии, журнал, уведомления', () => {
  it('список сессий по убыванию активности, текущая отмечена, токенов нет', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const a = await h.login('hero@example.com');
    h.clock.advance(1000);
    const b = await h.login('hero@example.com', PASSWORD, { ...META, ip: '203.0.113.7' });
    const list = await h.auth.listSessions(await h.auth.authenticate(a.accessToken));
    expect(list.map((s) => [s.id, s.isCurrent])).toEqual([
      [b.sessionId, false],
      [a.sessionId, true],
    ]);
    expect(JSON.stringify(list)).not.toContain(a.refreshToken);
    expect(list[0]).toMatchObject({ ip: '203.0.113.7', userAgent: META.userAgent });
  });

  it('отзыв своей сессии и запрет чужой', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    await h.activeAccount('other@example.com');
    const a = await h.login('hero@example.com');
    const b = await h.login('hero@example.com');
    const foreign = await h.login('other@example.com');
    const principal = await h.auth.authenticate(a.accessToken);
    await h.auth.revokeOwn(principal, b.sessionId, 'user_revoke', META);
    await rejects(h.auth.authenticate(b.accessToken), 'AUTH_SESSION_REVOKED');
    await rejects(
      h.auth.revokeOwn(principal, foreign.sessionId, 'user_revoke', META),
      'SEC_SESSION_NOT_FOUND',
      404,
    );
    await rejects(
      h.auth.revokeOwn(principal, b.sessionId, 'user_revoke', META),
      'SEC_SESSION_NOT_FOUND',
    );
  });

  it('журнал входов: неудача и успех, страницы, 90 суток, limit ≤ 100', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    await rejects(
      h.auth.login('hero@example.com', WRONG, { ...META, ip: '203.0.113.10' }),
      'AUTH_INVALID_CREDENTIALS',
    );
    h.clock.advance(1000);
    const s = await h.login('hero@example.com', PASSWORD, { ...META, ip: '203.0.113.11' });
    const principal = await h.auth.authenticate(s.accessToken);
    const page = await h.security.events(principal, 1);
    expect(page.items[0]).toMatchObject({ type: 'login', outcome: 'success', ip: '203.0.113.11' });
    const next = await h.security.events(principal, 1, page.nextCursor ?? undefined);
    expect(next.items[0]).toMatchObject({
      type: 'login',
      outcome: 'failure',
      ip: '203.0.113.10',
      reasonCode: 'AUTH_INVALID_CREDENTIALS',
    });
    await rejects(h.security.events(principal, 101), 'SEC_VALIDATION_FAILED', 400);
    h.clock.advance(91 * DAY);
    expect((await h.security.events(principal, 100)).items).toEqual([]);
  });

  it('уведомление о новом устройстве; сбой почты не откатывает операцию', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    await h.login('hero@example.com');
    await h.login('hero@example.com');
    await h.flush();
    expect(
      h.mail.to('hero@example.com').filter((m) => m.subject.includes('нового устройства')),
    ).toHaveLength(0);
    await h.login('hero@example.com', PASSWORD, { ip: '203.0.113.77', userAgent: 'Другой/2.0' });
    h.mail.failing = true;
    const principal = await h.auth.authenticate((await h.login('hero@example.com')).accessToken);
    await h.security.changePassword(
      principal,
      { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      META,
    );
    await h.flush();
    expect((await h.auth.login('hero@example.com', NEW_PASSWORD, META)).status).toBe(
      'authenticated',
    );
    const pending = h.store.outboxRows().filter((r) => r.status === 'pending');
    expect(pending.length).toBeGreaterThan(0);
    expect(
      pending.every((r) => r.attempts === 1 && r.lastError === 'почтовый сервер недоступен'),
    ).toBe(true);
    h.mail.failing = false;
    h.clock.advance(30_000);
    await h.flush();
    const notice = h.mail
      .to('hero@example.com')
      .find((m) => m.subject.includes('нового устройства'));
    expect(notice?.text).toContain('203.0.113.77');
    expect(
      h.store
        .outboxRows()
        .filter((r) => r.kind === 'email')
        .every((r) => r.status === 'done'),
    ).toBe(true);
  });
});
