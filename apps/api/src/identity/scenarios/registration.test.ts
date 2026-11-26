import { describe, expect, it } from 'vitest';
import { DAY, MINUTE } from '../core/index.js';
import { META, PASSWORD, harness, rejects } from '../testing/harness.test-helper.js';

const form = (h: ReturnType<typeof harness>, email: string, password = PASSWORD) => ({
  email,
  password,
  ...h.docs,
});

describe('identity/account-registration', () => {
  it('регистрация: pending, хэш, документы, письмо, 202', async () => {
    const h = harness();
    expect(await h.registration.register(form(h, 'player@example.com'), META)).toEqual({
      status: 'verification_required',
    });
    const account = await h.store.findAccountByEmail('player@example.com');
    expect(account).toMatchObject({ status: 'pending_verification', accessLevel: 'player' });
    expect(account?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(account)).not.toContain(PASSWORD);
    expect(await h.store.latestTos(account?.id ?? '')).toMatchObject({
      tosVersion: '2026-11-01',
      ip: META.ip,
      userAgent: META.userAgent,
    });
    await h.flush();
    expect(h.mail.lastToken('player@example.com')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('канонизация email и отклонение некорректных', async () => {
    const h = harness();
    await h.registration.register(form(h, '  Player.One@Example.COM  '), META);
    expect(await h.store.findAccountByEmail('player.one@example.com')).not.toBeNull();
    let n = 0;
    const ip = () => ({ ...META, ip: `203.0.113.${n++}` });
    for (const bad of [
      'invalid-email@localhost',
      `${'a'.repeat(250)}@b.cd`,
      'a b@c.de',
      'a@@b.cd',
      '.a@b.cd',
      'a@-b.cd',
    ]) {
      await rejects(h.registration.register(form(h, bad), ip()), 'REG_INVALID_EMAIL', 400);
    }
    await rejects(
      h.registration.register(form(h, 'x@trash.example'), ip()),
      'REG_EMAIL_DOMAIN_BLOCKED',
    );
  });

  it('политика пароля', async () => {
    const h = harness();
    const weak = await rejects(
      h.registration.register(form(h, 'p@example.com', 'a'.repeat(11)), META),
      'REG_WEAK_PASSWORD',
      400,
    );
    expect(weak.options.details).toEqual({ violations: ['length'] });
    await rejects(
      h.registration.register(form(h, 'p@example.com', 'a'.repeat(129)), META),
      'REG_WEAK_PASSWORD',
    );
    const mail = await rejects(
      h.registration.register(form(h, 'hero.champion@example.com', 'hero.champion'), META),
      'REG_WEAK_PASSWORD',
    );
    expect(mail.options.details).toEqual({ violations: ['matches_email'] });
    await rejects(
      h.registration.register(form(h, 'p@example.com', 'password1234'), META),
      'REG_WEAK_PASSWORD',
    );
  });

  it('документы: без согласия и устаревшие версии', async () => {
    const h = harness();
    await rejects(
      h.registration.register({ ...form(h, 'a@example.com'), tosAccepted: false }, META),
      'REG_TOS_NOT_ACCEPTED',
      400,
    );
    await rejects(
      h.registration.register(
        { email: 'a@example.com', password: PASSWORD, tosAccepted: true },
        META,
      ),
      'REG_TOS_NOT_ACCEPTED',
    );
    const outdated = await rejects(
      h.registration.register({ ...form(h, 'a@example.com'), tosVersion: '2025-01-01' }, META),
      'REG_TOS_VERSION_OUTDATED',
      409,
    );
    expect(outdated.options.details).toEqual(h.registration.documents());
    expect(await h.store.findAccountByEmail('a@example.com')).toBeNull();
  });

  it('анти-перечисление: существующий адрес — тот же ответ, без изменений, письмо владельцу', async () => {
    const h = harness();
    const hero = await h.activeAccount('hero@example.com');
    h.clock.advance(MINUTE + 1);
    expect(
      await h.registration.register(form(h, 'hero@example.com', 'совсем другой пароль 1'), META),
    ).toEqual({
      status: 'verification_required',
    });
    expect(await h.store.findAccount(hero.id)).toEqual(hero);
    await h.flush();
    expect(h.mail.to('hero@example.com').at(-1)?.subject).toContain('повторной регистрации');
  });

  it('повторная регистрация неподтверждённого: без дубликата, новый токен', async () => {
    const h = harness();
    await h.registration.register(form(h, 'p@example.com'), META);
    await h.flush();
    const first = h.mail.lastToken('p@example.com') ?? '';
    h.clock.advance(MINUTE + 1);
    await h.registration.register(form(h, 'p@example.com'), META);
    await h.flush();
    const second = h.mail.lastToken('p@example.com') ?? '';
    expect(second).not.toBe(first);
    await rejects(h.registration.verify(first), 'REG_VERIFICATION_TOKEN_INVALID');
    expect(await h.registration.verify(second)).toEqual({ status: 'verified' });
  });

  it('подтверждение: активирует, повтор и просрочка отклоняются', async () => {
    const h = harness();
    await h.registration.register(form(h, 'p@example.com'), META);
    await h.flush();
    const token = h.mail.lastToken('p@example.com') ?? '';
    expect(await h.registration.verify(token)).toEqual({ status: 'verified' });
    const account = await h.store.findAccountByEmail('p@example.com');
    expect(account).toMatchObject({ status: 'active', emailVerifiedAt: h.clock.utc() });
    await rejects(h.registration.verify(token), 'REG_VERIFICATION_TOKEN_INVALID', 400);
    await rejects(h.registration.verify('A'.repeat(43)), 'REG_VERIFICATION_TOKEN_INVALID');

    await h.registration.register(form(h, 'late@example.com'), META);
    await h.flush();
    h.clock.advance(DAY + 1);
    await rejects(
      h.registration.verify(h.mail.lastToken('late@example.com') ?? ''),
      'REG_VERIFICATION_TOKEN_EXPIRED',
      410,
    );
    expect((await h.store.findAccountByEmail('late@example.com'))?.status).toBe(
      'pending_verification',
    );
  });

  it('повторная отправка: кулдаун 60 с, лимит 5 в сутки, нейтральный ответ', async () => {
    const h = harness();
    await h.registration.register(form(h, 'p@example.com'), META);
    h.clock.advance(20_000);
    const early = await rejects(
      h.registration.resend('p@example.com', META),
      'REG_RESEND_RATE_LIMITED',
      429,
    );
    expect(early.options.retryAfterS).toBe(40);
    h.clock.advance(41_000);
    expect(await h.registration.resend('p@example.com', META)).toEqual({
      status: 'verification_required',
    });
    await h.flush();
    expect(h.mail.to('p@example.com')).toHaveLength(2);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(MINUTE + 1);
      await h.registration.resend('p@example.com', META);
    }
    h.clock.advance(MINUTE + 1);
    await rejects(h.registration.resend('p@example.com', META), 'REG_RESEND_RATE_LIMITED');
    await h.flush();
    const tokens = h.mail.to('p@example.com');
    expect(tokens).toHaveLength(5);

    await h.activeAccount('active@example.com');
    h.clock.advance(MINUTE + 1);
    const before = h.mail.sent.length;
    expect(await h.registration.resend('nobody@example.com', META)).toEqual({
      status: 'verification_required',
    });
    expect(await h.registration.resend('active@example.com', META)).toEqual({
      status: 'verification_required',
    });
    await h.flush();
    expect(h.mail.sent.length).toBe(before);
    await rejects(h.registration.resend('bad', META), 'REG_INVALID_EMAIL');
  });

  it('неподтверждённый не входит; через 7 суток адрес освобождается', async () => {
    const h = harness();
    await h.registration.register(form(h, 'p@example.com'), META);
    await rejects(h.auth.login('p@example.com', PASSWORD, META), 'AUTH_EMAIL_NOT_VERIFIED', 403);
    h.clock.advance(7 * DAY + 1);
    const expired = await h.registration.cleanup();
    expect(expired).toHaveLength(1);
    expect(await h.store.findAccountByEmail('p@example.com')).toBeNull();
    h.clock.advance(MINUTE);
    await h.registration.register(form(h, 'p@example.com'), META);
    const fresh = await h.store.findAccountByEmail('p@example.com');
    expect(fresh?.id).not.toBe(expired[0]);
  });

  it('лимиты IP и антибот-проверка', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await h.registration.register(form(h, `u${i}@example.com`), META);
    const limited = await rejects(
      h.registration.register(form(h, 'u6@example.com'), META),
      'REG_RATE_LIMITED',
      429,
    );
    expect(limited.options.retryAfterS).toBeGreaterThan(0);
    const other = { ...META, ip: '198.51.100.9' };
    for (let i = 0; i < 3; i++) {
      h.clock.advance(15 * MINUTE);
      for (let j = 0; j < 5; j++)
        await h.registration.register(form(h, `d${i}${j}@example.com`), other);
    }
    h.clock.advance(15 * MINUTE);
    for (let j = 0; j < 5; j++) await h.registration.register(form(h, `e${j}@example.com`), other);
    await rejects(
      h.registration.register(form(h, 'z@example.com'), { ...other }),
      'REG_RATE_LIMITED',
    );

    h.challenge.required = true;
    const third = { ...META, ip: '198.51.100.10' };
    await rejects(
      h.registration.register(form(h, 'bot@example.com'), third),
      'REG_CHALLENGE_FAILED',
      400,
    );
    await h.registration.register(
      { ...form(h, 'human@example.com'), challengeToken: 'human' },
      third,
    );
  });
});
