import { describe, expect, it } from 'vitest';
import { base32Decode, totpAt } from '../crypto/totp.js';
import { META, PASSWORD, harness, rejects } from '../testing/harness.test-helper.js';

const player = async () => {
  const h = harness();
  await h.activeAccount('hero@example.com');
  const session = await h.login('hero@example.com');
  return { h, session, principal: await h.auth.authenticate(session.accessToken) };
};

describe('identity/two-factor-auth', () => {
  it('настройка: секрет 160 бит, otpauth, зашифрованное хранение', async () => {
    const { h, principal } = await player();
    const setup = await h.tfa.setup(principal);
    expect(base32Decode(setup.manualKey)).toHaveLength(20);
    expect(setup.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/Duskmarch%3Ahero%40example\.com\?secret=[A-Z2-7]{32}&issuer=Duskmarch&algorithm=SHA1&digits=6&period=30$/,
    );
    const stored = await h.store.getTotp(principal.accountId);
    expect(stored).toMatchObject({ status: 'pending', keyVersion: '1' });
    expect(JSON.stringify(stored)).not.toContain(setup.manualKey);
  });

  it('подтверждение: 10 резервных кодов, прочие сессии отозваны, письмо', async () => {
    const { h, session } = await player();
    const other = await h.login('hero@example.com');
    const tfa = await h.enableTfa(session);
    expect(tfa.backupCodes).toHaveLength(10);
    expect(tfa.session.status).toBe('authenticated');
    await rejects(h.auth.authenticate(other.accessToken), 'AUTH_SESSION_REVOKED');
    const principal = await h.auth.authenticate(tfa.session.accessToken);
    expect(principal.mfa).toBe(true);
    expect(await h.tfa.status(principal)).toEqual({
      enabled: true,
      enabledAt: expect.any(String),
      remainingBackupCodes: 10,
    });
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('2FA включена');
    const codes = await h.store.listBackupCodes(principal.accountId);
    expect(JSON.stringify(codes)).not.toContain(tfa.backupCodes[0]?.replace('-', '') ?? '');
  });

  it('повторная настройка, неверный код, истёкшая настройка', async () => {
    const { h, principal } = await player();
    let setup = await h.tfa.setup(principal);
    await rejects(
      h.tfa.confirm(principal, setup.setupToken, '000000', META),
      'TFA_INVALID_CODE',
      400,
    );
    expect((await h.store.getTotp(principal.accountId))?.status).toBe('pending');
    await rejects(h.tfa.confirm(principal, 'A'.repeat(43), '000000', META), 'TFA_SETUP_EXPIRED');
    setup = await h.tfa.setup(principal);
    h.clock.advance(15 * 60_000 + 1);
    const code = totpAt(base32Decode(setup.manualKey), h.clock.utc());
    await rejects(h.tfa.confirm(principal, setup.setupToken, code, META), 'TFA_SETUP_EXPIRED', 410);
    const enabled = await h.enableTfa(await h.login('hero@example.com'));
    const p2 = await h.auth.authenticate(enabled.session.accessToken);
    await rejects(h.tfa.setup(p2), 'TFA_ALREADY_ENABLED', 409);
  });

  it('вход с TOTP: mfa_required, код, защита от повтора, окно ±1', async () => {
    const { h, session } = await player();
    const tfa = await h.enableTfa(session);
    const first = await h.auth.login('hero@example.com', PASSWORD, META);
    expect(first).toMatchObject({ status: 'mfa_required', expiresIn: 300 });
    if (first.status !== 'mfa_required') throw new Error();
    const code = tfa.code();
    const done = await h.tfa.verifyChallenge(first.mfaChallengeToken, code, META);
    expect((await h.auth.authenticate(done.accessToken)).mfa).toBe(true);
    const second = await h.auth.login('hero@example.com', PASSWORD, META);
    if (second.status !== 'mfa_required') throw new Error();
    await rejects(
      h.tfa.verifyChallenge(second.mfaChallengeToken, code, META),
      'TFA_CODE_REPLAYED',
      401,
    );
    h.clock.advance(60_000);
    const old = tfa.code();
    h.clock.advance(60_000);
    await rejects(
      h.tfa.verifyChallenge(second.mfaChallengeToken, old, META),
      'TFA_INVALID_CODE',
      401,
    );
    expect((await h.tfa.verifyChallenge(second.mfaChallengeToken, tfa.code(), META)).status).toBe(
      'authenticated',
    );
  });

  it('challenge: 5 ошибок аннулируют, 5 минут — срок', async () => {
    const { h, session } = await player();
    const tfa = await h.enableTfa(session);
    const first = await h.auth.login('hero@example.com', PASSWORD, META);
    if (first.status !== 'mfa_required') throw new Error();
    for (let i = 0; i < 4; i++) {
      await rejects(
        h.tfa.verifyChallenge(first.mfaChallengeToken, '000000', META),
        'TFA_INVALID_CODE',
      );
    }
    await rejects(
      h.tfa.verifyChallenge(first.mfaChallengeToken, '000000', META),
      'TFA_CHALLENGE_EXHAUSTED',
      429,
    );
    await rejects(
      h.tfa.verifyChallenge(first.mfaChallengeToken, tfa.code(), META),
      'TFA_CHALLENGE_EXPIRED',
    );
    const events = await h.store.listSecurityEvents(
      (await h.auth.authenticate(tfa.session.accessToken)).accountId,
      { limit: 5 },
    );
    expect(events.items.map((e) => e.type)).toContain('mfa_exhausted');
    const late = await h.auth.login('hero@example.com', PASSWORD, META);
    if (late.status !== 'mfa_required') throw new Error();
    h.clock.advance(5 * 60_000 + 1);
    await rejects(
      h.tfa.verifyChallenge(late.mfaChallengeToken, tfa.code(), META),
      'TFA_CHALLENGE_EXPIRED',
      401,
    );
  });

  it('резервные коды: вход в любом регистре, одноразовость, письмо с остатком', async () => {
    const { h, session } = await player();
    const tfa = await h.enableTfa(session);
    const login = async () => {
      const r = await h.auth.login('hero@example.com', PASSWORD, META);
      if (r.status !== 'mfa_required') throw new Error();
      return r.mfaChallengeToken;
    };
    const code = tfa.backupCodes[0] ?? '';
    const done = await h.tfa.verifyChallenge(
      await login(),
      code.toLowerCase().replace('-', ''),
      META,
    );
    expect(done.status).toBe('authenticated');
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.text).toContain('Осталось резервных кодов: 9');
    await rejects(h.tfa.verifyChallenge(await login(), code, META), 'TFA_INVALID_CODE', 401);
    const principal = await h.auth.authenticate(done.accessToken);
    expect((await h.tfa.status(principal)).remainingBackupCodes).toBe(9);
  });

  it('статус без секретов; перевыпуск кодов', async () => {
    const { h, session } = await player();
    const tfa = await h.enableTfa(session);
    const principal = await h.auth.authenticate(tfa.session.accessToken);
    const status = await h.tfa.status(principal);
    expect(Object.keys(status).sort()).toEqual(['enabled', 'enabledAt', 'remainingBackupCodes']);
    await rejects(
      h.tfa.regenerateBackupCodes(principal, '000000', PASSWORD, META),
      'TFA_INVALID_CODE',
      401,
    );
    await rejects(
      h.tfa.regenerateBackupCodes(principal, tfa.backupCodes[1] ?? '', PASSWORD, META),
      'TFA_INVALID_CODE',
    );
    const fresh = await h.tfa.regenerateBackupCodes(principal, tfa.code(), PASSWORD, META);
    expect(fresh.backupCodes).toHaveLength(10);
    expect(fresh.backupCodes).not.toContain(tfa.backupCodes[2]);
    const r = await h.auth.login('hero@example.com', PASSWORD, META);
    if (r.status !== 'mfa_required') throw new Error();
    await rejects(
      h.tfa.verifyChallenge(r.mfaChallengeToken, tfa.backupCodes[2] ?? '', META),
      'TFA_INVALID_CODE',
    );
    expect(
      (await h.tfa.verifyChallenge(r.mfaChallengeToken, fresh.backupCodes[0] ?? '', META)).status,
    ).toBe('authenticated');
  });

  it('отключение игроком; персонал отключить не может', async () => {
    const { h, session } = await player();
    const tfa = await h.enableTfa(session);
    const principal = await h.auth.authenticate(tfa.session.accessToken);
    const another = await h.tfa.verifyChallenge(
      ((await h.auth.login('hero@example.com', PASSWORD, META)) as { mfaChallengeToken: string })
        .mfaChallengeToken,
      tfa.backupCodes[0] ?? '',
      META,
    );
    await h.tfa.disable(principal, tfa.code(), PASSWORD, META);
    expect(await h.tfa.status(principal)).toEqual({
      enabled: false,
      enabledAt: null,
      remainingBackupCodes: 0,
    });
    await rejects(h.auth.authenticate(another.accessToken), 'AUTH_SESSION_REVOKED');
    expect((await h.auth.login('hero@example.com', PASSWORD, META)).status).toBe('authenticated');
    await rejects(h.tfa.disable(principal, '000000', PASSWORD, META), 'TFA_NOT_ENABLED');

    const staff = await h.staffSession('gm@example.com', 'moderator');
    await rejects(
      h.tfa.disable(staff.principal, staff.code(), PASSWORD, META),
      'TFA_REQUIRED_FOR_STAFF',
      403,
    );
  });

  it('персонал без 2FA: ограниченный токен, затем полноценная сессия', async () => {
    const h = harness();
    await h.activeAccount('mod@example.com', 'moderator');
    const first = await h.auth.login('mod@example.com', PASSWORD, META);
    expect(first.status).toBe('staff_2fa_setup_required');
    if (first.status !== 'staff_2fa_setup_required') throw new Error();
    await rejects(h.auth.authenticate(first.accessToken), 'TFA_SETUP_REQUIRED', 403);
    const limited = await h.auth.authenticate(first.accessToken, true);
    expect(limited.setupOnly).toBe(true);
    const tfa = await h.enableTfa(first);
    expect(tfa.session).toMatchObject({
      status: 'authenticated',
      refreshToken: expect.any(String),
    });
    const full = await h.auth.authenticate(tfa.session.accessToken);
    expect(full).toMatchObject({ mfa: true, setupOnly: false, acl: 'moderator' });
  });
});
