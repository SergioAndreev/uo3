import { describe, expect, it } from 'vitest';
import { META, PASSWORD, harness, rejects } from '../testing/harness.test-helper.js';

const REASON = 'назначение по решению совета шарда';

describe('identity/access-levels', () => {
  it('инспекция: модератор с 2FA видит карточку без секретов; игрок — нет', async () => {
    const h = harness();
    const hero = await h.activeAccount('hero@example.com');
    const mod = await h.staffSession('mod@example.com', 'moderator');
    const card = await h.staff.inspect(mod.principal, hero.id, META);
    expect(card).toMatchObject({
      id: hero.id,
      email: 'hero@example.com',
      accessLevel: 'player',
      tfaEnabled: false,
      ban: null,
    });
    expect(JSON.stringify(card)).not.toMatch(/argon2|passwordHash|ciphertext/);
    const player = await h.auth.authenticate((await h.login('hero@example.com')).accessToken);
    await rejects(h.staff.inspect(player, hero.id, META), 'RBAC_INSUFFICIENT_PERMISSION', 403);
    await rejects(
      h.staff.inspect(mod.principal, '00000000-0000-7000-8000-000000000000', META),
      'SEC_ACCOUNT_NOT_FOUND',
      404,
    );
  });

  it('сотрудник без второго фактора получает TFA_SETUP_REQUIRED', async () => {
    const h = harness();
    const hero = await h.activeAccount('hero@example.com');
    const mod = await h.staffSession('mod@example.com', 'moderator');
    await rejects(
      h.staff.inspect({ ...mod.principal, mfa: false }, hero.id, META),
      'TFA_SETUP_REQUIRED',
      403,
    );
  });

  it('иерархия: равный и старший уровень недоступны, младший — доступен', async () => {
    const h = harness();
    const mod = await h.staffSession('mod@example.com', 'moderator');
    const peer = await h.activeAccount('peer@example.com', 'moderator');
    const reason = {
      reason: 'проверка иерархии бана',
      expiresAt: new Date(h.clock.utc() + 86_400_000).toISOString(),
    };
    await rejects(
      h.staff.ban(mod.principal, peer.id, reason, META),
      'RBAC_HIERARCHY_VIOLATION',
      403,
    );
    const admin = await h.staffSession('admin@example.com', 'administrator');
    const owner = await h.activeAccount('owner@example.com', 'owner');
    await rejects(
      h.staff.revokeSessions(admin.principal, owner.id, META),
      'RBAC_HIERARCHY_VIOLATION',
    );
    const gm = await h.activeAccount('gm@example.com', 'game-master');
    await h.login('gm@example.com').catch(() => undefined);
    const gmSession = await h.auth.login('gm@example.com', PASSWORD, META);
    expect(gmSession.status).toBe('staff_2fa_setup_required');
    expect(await h.staff.revokeSessions(admin.principal, gm.id, META)).toEqual({ revoked: 2 });
  });

  it('назначение: администратор повышает игрока до модератора; сессии цели отозваны; событие и аудит', async () => {
    const h = harness();
    const hero = await h.activeAccount('hero@example.com');
    const heroSession = await h.login('hero@example.com');
    const admin = await h.staffSession('admin@example.com', 'administrator');
    await rejects(
      h.staff.changeLevel(
        admin.principal,
        hero.id,
        { level: 'moderator', reason: REASON, code: '000000' },
        META,
      ),
      'TFA_INVALID_CODE',
    );
    expect(
      await h.staff.changeLevel(
        admin.principal,
        hero.id,
        { level: 'moderator', reason: REASON, code: admin.code() },
        META,
      ),
    ).toEqual({
      previousLevel: 'player',
      newLevel: 'moderator',
    });
    expect((await h.store.findAccount(hero.id))?.accessLevel).toBe('moderator');
    await rejects(h.auth.authenticate(heroSession.accessToken), 'AUTH_SESSION_REVOKED', 401);
    await h.flush();
    expect(h.events.of('identity.account.access_level_changed')).toEqual([
      expect.objectContaining({
        accountId: hero.id,
        previousLevel: 'player',
        newLevel: 'moderator',
        changedBy: admin.account.id,
      }),
    ]);
    const audit = await h.staff.auditLog(admin.principal, META);
    expect(audit.items[0]).toMatchObject({
      actorId: admin.account.id,
      targetId: hero.id,
      action: 'access_level.change',
      outcome: 'allowed',
      before: { level: 'player' },
      after: { level: 'moderator' },
      reason: REASON,
      ip: META.ip,
      userAgent: META.userAgent,
    });
  });

  it('назначение: потолок администратора, неизвестный уровень, нет права', async () => {
    const h = harness();
    const hero = await h.activeAccount('hero@example.com');
    const admin = await h.staffSession('admin@example.com', 'administrator');
    await rejects(
      h.staff.changeLevel(
        admin.principal,
        hero.id,
        { level: 'administrator', reason: REASON, code: admin.code() },
        META,
      ),
      'RBAC_HIERARCHY_VIOLATION',
      403,
    );
    h.clock.advance(30_000);
    await rejects(
      h.staff.changeLevel(
        admin.principal,
        hero.id,
        { level: 'superuser', reason: REASON, code: admin.code() },
        META,
      ),
      'RBAC_UNKNOWN_ACCESS_LEVEL',
      400,
    );
    await rejects(
      h.staff.changeLevel(
        admin.principal,
        hero.id,
        { level: 'helper', reason: 'кратко', code: admin.code() },
        META,
      ),
      'SEC_BAN_REASON_INVALID',
    );
    const helper = await h.staffSession('helper@example.com', 'helper');
    await rejects(
      h.staff.changeLevel(
        helper.principal,
        hero.id,
        { level: 'helper', reason: REASON, code: helper.code() },
        META,
      ),
      'RBAC_INSUFFICIENT_PERMISSION',
      403,
    );
    const denied = await h.staff.auditLog(admin.principal, META, 100);
    expect(denied.items.find((a) => a.actorId === helper.account.id)).toMatchObject({
      outcome: 'denied',
      action: 'access_level.change',
    });
  });

  it('защита последнего владельца; второй владелец позволяет понижение', async () => {
    const h = harness();
    const owner = await h.staffSession('owner@example.com', 'owner');
    await rejects(
      h.staff.changeLevel(
        owner.principal,
        owner.account.id,
        { level: 'administrator', reason: REASON, code: owner.code() },
        META,
      ),
      'RBAC_LAST_OWNER',
      409,
    );
    const helper = await h.activeAccount('helper@example.com', 'helper');
    h.clock.advance(30_000);
    await h.staff.changeLevel(
      owner.principal,
      helper.id,
      { level: 'owner', reason: REASON, code: owner.code() },
      META,
    );
    h.clock.advance(30_000);
    await h.staff.changeLevel(
      owner.principal,
      owner.account.id,
      { level: 'administrator', reason: REASON, code: owner.code() },
      META,
    );
    expect((await h.store.findAccount(owner.account.id))?.accessLevel).toBe('administrator');
  });

  it('игра с пониженным уровнем и запрет повышения', async () => {
    const h = harness();
    const gm = await h.staffSession('gm@example.com', 'game-master');
    expect(await h.staff.setEffective(gm.principal, 'player', META)).toEqual({
      maxLevel: 'game-master',
      effectiveLevel: 'player',
    });
    const relogged = await h.auth.upgradeSession(gm.principal, false);
    expect((await h.auth.authenticate(relogged.accessToken)).eacl).toBe('player');
    expect(await h.staff.setEffective(gm.principal, 'game-master', META)).toEqual({
      maxLevel: 'game-master',
      effectiveLevel: 'game-master',
    });
    await h.flush();
    expect(h.events.of('identity.account.effective_level_changed')).toHaveLength(2);
    const helper = await h.staffSession('helper@example.com', 'helper');
    await rejects(
      h.staff.setEffective(helper.principal, 'moderator', META),
      'RBAC_HIERARCHY_VIOLATION',
      403,
    );
    await rejects(
      h.staff.setEffective(helper.principal, 'boss', META),
      'RBAC_UNKNOWN_ACCESS_LEVEL',
    );
    await rejects(
      h.staff.setEffective({ ...helper.principal, mfa: false }, 'player', META),
      'TFA_SETUP_REQUIRED',
    );
  });

  it('журнал аудита доступен только с audit.read; limit проверяется', async () => {
    const h = harness();
    const gm = await h.staffSession('gm@example.com', 'game-master');
    await rejects(h.staff.auditLog(gm.principal, META), 'RBAC_INSUFFICIENT_PERMISSION', 403);
    const admin = await h.staffSession('admin@example.com', 'administrator');
    await rejects(h.staff.auditLog(admin.principal, META, 0), 'SEC_VALIDATION_FAILED');
    const page = await h.staff.auditLog(admin.principal, META, 1);
    expect(page.items).toHaveLength(1);
  });

  it('сброс утерянной 2FA администратором; запрет для равного уровня', async () => {
    const h = harness();
    await h.activeAccount('hero@example.com');
    const heroTfa = await h.enableTfa(await h.login('hero@example.com'));
    const hero = (await h.store.findAccountByEmail('hero@example.com'))!;
    const admin = await h.staffSession('admin@example.com', 'administrator');
    await rejects(
      h.staff.resetTwoFactor(admin.principal, hero.id, 'кратко', META),
      'SEC_BAN_REASON_INVALID',
    );
    await h.staff.resetTwoFactor(
      admin.principal,
      hero.id,
      'владелец потерял телефон, личность подтверждена',
      META,
    );
    expect(await h.store.getTotp(hero.id)).toBeNull();
    expect(await h.store.listBackupCodes(hero.id)).toEqual([]);
    await rejects(h.auth.authenticate(heroTfa.session.accessToken), 'AUTH_SESSION_REVOKED');
    expect((await h.auth.login('hero@example.com', PASSWORD, META)).status).toBe('authenticated');
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('2FA сброшена');
    const peer = await h.activeAccount('peer@example.com', 'administrator');
    await rejects(
      h.staff.resetTwoFactor(admin.principal, peer.id, 'попытка сброса равному уровню', META),
      'RBAC_HIERARCHY_VIOLATION',
      403,
    );
  });
});
