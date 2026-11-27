import { describe, expect, it } from 'vitest';
import { setSensitiveForTests } from '../app/sensitive.js';
import { check, click, fakeApi, settle, shell, submit, type } from '../testing/shell.js';

const docs = {
  status: 200,
  body: { tosVersion: '2026-11-01', privacyVersion: '2026-11-01', oauthProviders: ['discord'] },
};
const ok = (token = 'jwt-access') => ({
  status: 200,
  body: { status: 'authenticated', accessToken: token, expiresIn: 900 },
});

describe('client/login-and-character-select: вход', () => {
  it('вход без второго фактора → returnTo; токен только в памяти', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/documents': () => docs,
      'POST /api/v1/auth/login': () => ok(),
    });
    const s = await shell('/login?returnTo=%2Fsettings', api);
    await type(s.host, 'Email', 'yasna@example.com');
    await type(s.host, 'Пароль', 'длинный пароль 2026');
    await submit(s.host);
    expect(s.router.state.location.pathname).toBe('/settings');
    expect(s.store.accessToken).toBe('jwt-access');
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(api.calls.find((c) => c.path === '/api/v1/auth/login')?.body).toEqual({
      email: 'yasna@example.com',
      password: 'длинный пароль 2026',
    });
    expect(
      s.host.querySelector('a[href="http://api.test/api/v1/auth/oauth/discord/start"]'),
    ).toBeDefined();
  });

  it('неверные данные — нейтральное сообщение; 429 — блокировка с отсчётом; бан — панель', async () => {
    let mode: 'bad' | 'limit' | 'ban' = 'bad';
    const api = fakeApi({
      'GET /api/v1/auth/documents': () => docs,
      'POST /api/v1/auth/login': () =>
        mode === 'bad'
          ? { status: 401, body: { error: { code: 'AUTH_INVALID_CREDENTIALS' } } }
          : mode === 'limit'
            ? {
                status: 429,
                body: { error: { code: 'AUTH_RATE_LIMITED' } },
                headers: { 'retry-after': '900' },
              }
            : {
                status: 403,
                body: {
                  error: {
                    code: 'SEC_ACCOUNT_BANNED',
                    details: { reason: 'Использование ботов', expiresAt: null },
                  },
                },
              },
    });
    const s = await shell('/login', api);
    await type(s.host, 'Email', 'a@b.c');
    await type(s.host, 'Пароль', 'x');
    await submit(s.host);
    expect(s.text()).toContain('Неверный email или пароль');
    mode = 'limit';
    await submit(s.host);
    expect(s.text()).toContain('Повторить можно через 15:00');
    expect((s.host.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
    const b = await shell(
      '/login',
      fakeApi({
        'GET /api/v1/auth/documents': () => docs,
        'POST /api/v1/auth/login': () => ({
          status: 403,
          body: {
            error: {
              code: 'SEC_ACCOUNT_BANNED',
              details: { reason: 'Использование ботов', expiresAt: null },
            },
          },
        }),
      }),
    );
    await type(b.host, 'Email', 'a@b.c');
    await type(b.host, 'Пароль', 'x');
    await submit(b.host);
    expect(b.host.querySelector('[data-testid=ban-reason]')?.textContent).toBe(
      'Использование ботов',
    );
    expect(b.host.querySelector('[data-testid=ban-until]')?.textContent).toBe('Бессрочно');
  });

  it('второй фактор: резервный код; 5 неверных — снова вход', async () => {
    let verifyOk = false;
    const api = fakeApi({
      'GET /api/v1/auth/documents': () => docs,
      'POST /api/v1/auth/login': () => ({
        status: 200,
        body: { status: 'mfa_required', mfaChallengeToken: 'challenge-token-0001', expiresIn: 300 },
      }),
      'POST /api/v1/auth/mfa/verify': () =>
        verifyOk ? ok('jwt-mfa') : { status: 401, body: { error: { code: 'TFA_INVALID_CODE' } } },
    });
    const s = await shell('/login', api);
    await type(s.host, 'Email', 'a@b.c');
    await type(s.host, 'Пароль', 'x');
    await submit(s.host);
    await click(s.host, 'Использовать резервный код');
    await type(s.host, 'Резервный код', 'ABCD-1234');
    verifyOk = true;
    await submit(s.host);
    expect(s.store.accessToken).toBe('jwt-mfa');
    expect(s.router.state.location.pathname).toBe('/shards');
    const f = await shell(
      '/login',
      fakeApi({
        ...Object.fromEntries([['GET /api/v1/auth/documents', () => docs]]),
        'POST /api/v1/auth/login': () => ({
          status: 200,
          body: {
            status: 'mfa_required',
            mfaChallengeToken: 'challenge-token-0002',
            expiresIn: 300,
          },
        }),
        'POST /api/v1/auth/mfa/verify': () => ({
          status: 401,
          body: { error: { code: 'TFA_INVALID_CODE' } },
        }),
      }),
    );
    await type(f.host, 'Email', 'a@b.c');
    await type(f.host, 'Пароль', 'x');
    await submit(f.host);
    for (let i = 0; i < 5; i++) {
      await type(f.host, 'Код из приложения', '123456');
      await submit(f.host);
    }
    expect(f.text()).toContain('Попытки подтверждения исчерпаны');
    expect(f.host.querySelector('input[type=email]')).not.toBeNull();
  });

  it('сотрудник без второго фактора → /2fa-setup: QR, код, резервные коды, затем шарды', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/documents': () => docs,
      'POST /api/v1/auth/login': () => ({
        status: 200,
        body: { status: 'staff_2fa_setup_required', accessToken: 'setup-jwt', expiresIn: 600 },
      }),
      'POST /api/v1/account/2fa/setup': () => ({
        status: 200,
        body: {
          setupToken: 'setup-token-0000001',
          otpauthUri: 'otpauth://totp/Duskmarch:gm?secret=ABC',
          manualKey: 'ABCDEF',
        },
      }),
      'POST /api/v1/account/2fa/confirm': () => ({
        status: 200,
        body: {
          backupCodes: ['AAAA-1111', 'BBBB-2222'],
          session: { status: 'authenticated', accessToken: 'full-jwt', expiresIn: 900 },
        },
      }),
    });
    const s = await shell('/login', api);
    await type(s.host, 'Email', 'gm@example.com');
    await type(s.host, 'Пароль', 'x');
    await submit(s.host);
    expect(s.router.state.location.pathname).toBe('/2fa-setup');
    expect(s.host.querySelector('[data-testid=manual-key]')?.textContent).toBe('ABCDEF');
    await type(s.host, 'Код из приложения', '654321');
    await submit(s.host);
    expect(s.host.querySelector('[data-testid=backup-codes]')?.textContent).toContain('AAAA-1111');
    const go = [...s.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Продолжить',
    ) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await check(s.host, 'Я сохранил');
    await click(s.host, 'Продолжить');
    expect(s.store.kind).toBe('full');
    expect(s.router.state.location.pathname).toBe('/shards');
  });
});

describe('client/login-and-character-select: регистрация, email, пароль, OAuth', () => {
  it('регистрация с версиями документов, ожидание письма и отсчёт 60 с', async () => {
    const api = fakeApi({
      'GET /api/v1/auth/documents': () => docs,
      'POST /api/v1/auth/register': () => ({ status: 202, body: { status: 'accepted' } }),
    });
    const s = await shell('/register', api);
    await type(s.host, 'Email', 'new@example.com');
    await type(s.host, 'Пароль', 'короткий');
    expect(s.text()).toContain('Не короче 12 символов');
    await type(s.host, 'Пароль', 'сумеречный рубеж 2026');
    await check(s.host, 'Принимаю');
    await submit(s.host);
    expect(api.calls.find((c) => c.path === '/api/v1/auth/register')?.body).toEqual({
      email: 'new@example.com',
      password: 'сумеречный рубеж 2026',
      tosAccepted: true,
      tosVersion: '2026-11-01',
      privacyVersion: '2026-11-01',
    });
    expect(s.host.querySelector('[data-testid=register-sent]')).not.toBeNull();
    expect(s.text()).toMatch(/через (60|59) с/);
  });

  it('подтверждение email по изъятому токену; сброс пароля с просроченным токеном', async () => {
    setSensitiveForTests({ token: 'verify-token-123456' });
    const v = await shell(
      '/verify-email',
      fakeApi({
        'POST /api/v1/auth/verify-email': () => ({ status: 200, body: { status: 'verified' } }),
      }),
    );
    expect(v.text()).toContain('Email подтверждён');
    expect(v.api.calls[0]?.body).toEqual({ token: 'verify-token-123456' });
    const again = await shell('/verify-email', fakeApi({}));
    expect(again.text()).toContain('Ссылка недействительна');
    setSensitiveForTests({ token: 'reset-token-1234567' });
    const r = await shell(
      '/reset-password',
      fakeApi({
        'POST /api/v1/auth/password-reset/confirm': () => ({
          status: 410,
          body: { error: { code: 'SEC_RESET_TOKEN_EXPIRED' } },
        }),
        'POST /api/v1/auth/password-reset/request': () => ({ status: 202 }),
      }),
    );
    await type(r.host, 'Новый пароль', 'новый длинный пароль');
    await submit(r.host);
    expect(r.text()).toContain('Ссылка истекла');
    await type(r.host, 'Email', 'a@b.c');
    await submit(r.host);
    expect(r.text()).toContain('Если аккаунт существует');
  });

  it('OAuth: онбординг с документами; конфликт email без привязки', async () => {
    setSensitiveForTests({ code: 'oauth-code', state: 'oauth-state' });
    const api = fakeApi({
      'GET /api/v1/auth/oauth/discord/callback': () => ({
        status: 200,
        body: {
          status: 'tos_acceptance_required',
          oauthOnboardingToken: 'onboarding-token-01',
          tosVersion: '2026-11-01',
          privacyVersion: '2026-11-01',
        },
      }),
      'POST /api/v1/auth/oauth/onboard': () => ok('jwt-oauth'),
    });
    const s = await shell('/oauth/callback/discord', api);
    expect(api.calls[0]?.path).toBe(
      '/api/v1/auth/oauth/discord/callback?code=oauth-code&state=oauth-state',
    );
    expect(s.router.state.location.pathname).toBe('/oauth/onboarding');
    await check(s.host, 'Принимаю');
    await submit(s.host);
    expect(api.calls.at(-1)?.body).toMatchObject({
      onboardingToken: 'onboarding-token-01',
      tosAccepted: true,
    });
    expect(s.store.accessToken).toBe('jwt-oauth');
    setSensitiveForTests({ code: 'c', state: 's' });
    const c = await shell(
      '/oauth/callback/google',
      fakeApi({
        'GET /api/v1/auth/oauth/google/callback': () => ({
          status: 409,
          body: { error: { code: 'AUTH_OAUTH_ACCOUNT_LINK_REQUIRED' } },
        }),
      }),
    );
    expect(c.host.querySelector('[data-testid=link-required]')).not.toBeNull();
    await settle();
  });
});
