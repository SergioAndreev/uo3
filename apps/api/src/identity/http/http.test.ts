import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ApiEnvSchema, loadServerConfig } from '@duskmarch/config/env/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../create-app.js';
import { PROVIDERS } from '../core/index.js';
import { META, PASSWORD, harness, type Harness } from '../testing/harness.test-helper.js';

const ORIGIN = META.origin as string;
let app: INestApplication;
let base: string;
let h: Harness;

/** Поддельный OAuth-провайдер: любой код даёт один профиль. */
const providerFetch = (async (input: string | URL | Request) =>
  String(input).endsWith('/token')
    ? Response.json({ access_token: 'at' })
    : Response.json({
        sub: 'g-http',
        email: 'oauth@example.com',
        email_verified: true,
      })) as typeof fetch;

beforeAll(async () => {
  h = harness({
    fetch: providerFetch,
    clients: {
      google: {
        clientId: 'cid',
        clientSecret: 's',
        endpoints: {
          ...PROVIDERS.google,
          tokenUrl: 'https://p.test/token',
          userInfoUrl: 'https://p.test/userinfo',
        },
      },
    },
  });
  const env = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
    VALKEY_URL: 'redis://127.0.0.1:1',
    NATS_URL: 'nats://127.0.0.1:1',
  };
  const config = loadServerConfig(ApiEnvSchema, { env, cwd: '/nonexistent' });
  app = await createApp(config, { services: h, secureCookies: true });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => app.close());

async function call(
  method: string,
  path: string,
  {
    body,
    token,
    cookie,
    origin = ORIGIN,
  }: { body?: unknown; token?: string; cookie?: string; origin?: string } = {},
) {
  const headers: Record<string, string> = { 'user-agent': META.userAgent, origin };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (cookie) headers['cookie'] = cookie;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    redirect: 'manual',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: response.headers.get('content-type')?.includes('json')
      ? (JSON.parse(text) as Record<string, unknown>)
      : undefined,
    cookies: response.headers.getSetCookie(),
    headers: response.headers,
  };
}

const refreshCookie = (cookies: string[]) =>
  cookies.find((c) => c.startsWith('dm_refresh='))?.split(';')[0] ?? '';

describe('HTTP identity', () => {
  it('регистрация → подтверждение → вход → refresh → выход', async () => {
    const docs = await call('GET', '/api/v1/auth/documents');
    expect(docs).toMatchObject({ status: 200, body: { tosVersion: '2026-11-01' } });
    const reg = await call('POST', '/api/v1/auth/register', {
      body: {
        email: 'web@example.com',
        password: PASSWORD,
        tosAccepted: true,
        tosVersion: docs.body.tosVersion,
        privacyVersion: docs.body.privacyVersion,
      },
    });
    expect(reg).toMatchObject({ status: 202, body: { status: 'verification_required' } });
    await h.flush();
    const verify = await call('POST', '/api/v1/auth/verify-email', {
      body: { token: h.mail.lastToken('web@example.com') },
    });
    expect(verify).toMatchObject({ status: 200, body: { status: 'verified' } });

    const login = await call('POST', '/api/v1/auth/login', {
      body: { email: 'web@example.com', password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ status: 'authenticated', expiresIn: 900 });
    expect(login.body).not.toHaveProperty('refreshToken');
    const setCookie = login.cookies.find((c) => c.startsWith('dm_refresh=')) ?? '';
    expect(setCookie).toMatch(
      /HttpOnly; SameSite=Lax; Path=\/api\/v1\/auth; Max-Age=2592000; Secure$/,
    );

    const jwks = await call('GET', '/.well-known/jwks.json');
    expect((jwks.body?.['keys'] as unknown[]).length).toBe(1);

    const evil = await call('POST', '/api/v1/auth/refresh', {
      cookie: refreshCookie(login.cookies),
      origin: 'https://evil.example',
    });
    expect(evil).toMatchObject({
      status: 403,
      body: { error: { code: 'AUTH_CSRF_ORIGIN_MISMATCH' } },
    });
    const refreshed = await call('POST', '/api/v1/auth/refresh', {
      cookie: refreshCookie(login.cookies),
    });
    expect(refreshed.status).toBe(200);
    const reuse = await call('POST', '/api/v1/auth/refresh', {
      cookie: refreshCookie(login.cookies),
    });
    expect(reuse).toMatchObject({
      status: 401,
      body: { error: { code: 'AUTH_TOKEN_REUSE_DETECTED' } },
    });
    expect(reuse.cookies[0]).toContain('Max-Age=0');

    const again = await call('POST', '/api/v1/auth/login', {
      body: { email: 'web@example.com', password: PASSWORD },
    });
    const token = again.body?.['accessToken'] as string;
    const sessions = await call('GET', '/api/v1/account/sessions', { token });
    expect(sessions.status).toBe(200);
    expect(sessions.body).toEqual([expect.objectContaining({ isCurrent: true })]);
    const out = await call('POST', '/api/v1/auth/logout', { token });
    expect(out.status).toBe(204);
    expect(out.cookies[0]).toContain('Max-Age=0');
    expect(await call('GET', '/api/v1/account/sessions', { token })).toMatchObject({
      status: 401,
      body: { error: { code: 'AUTH_SESSION_REVOKED' } },
    });
  });

  it('ошибки валидации, отсутствующий токен, Retry-After', async () => {
    expect(
      await call('POST', '/api/v1/auth/register', { body: { email: 'x@example.com' } }),
    ).toMatchObject({
      status: 400,
      body: { error: { code: 'REG_VALIDATION_FAILED', details: { fields: expect.any(Array) } } },
    });
    expect(await call('POST', '/api/v1/auth/login', { body: { email: 1 } })).toMatchObject({
      status: 400,
      body: { error: { code: 'SEC_VALIDATION_FAILED' } },
    });
    expect(await call('GET', '/api/v1/account/2fa')).toMatchObject({
      status: 401,
      body: { error: { code: 'AUTH_UNAUTHENTICATED' } },
    });
    expect((await call('GET', '/api/v1/account/2fa', { token: 'garbage' })).status).toBe(401);
    await h.activeAccount('resend@example.com');
    const limited = await call('POST', '/api/v1/auth/verify-email/resend', {
      body: { email: 'resend@example.com' },
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('персонал: ограниченный токен, 2FA, полноценная сессия, права', async () => {
    const hero = await h.activeAccount('target@example.com');
    await h.activeAccount('staff@example.com', 'moderator');
    const login = await call('POST', '/api/v1/auth/login', {
      body: { email: 'staff@example.com', password: PASSWORD },
    });
    expect(login.body).toMatchObject({ status: 'staff_2fa_setup_required' });
    const limited = login.body?.['accessToken'] as string;
    expect(
      await call('GET', `/api/v1/staff/accounts/${hero.id}`, { token: limited }),
    ).toMatchObject({
      status: 403,
      body: { error: { code: 'TFA_SETUP_REQUIRED' } },
    });
    const setup = await call('POST', '/api/v1/account/2fa/setup', { token: limited, body: {} });
    expect(setup.status).toBe(200);
    const { base32Decode, totpAt } = await import('../crypto/totp.js');
    const code = totpAt(base32Decode(setup.body?.['manualKey'] as string), h.clock.utc());
    const confirm = await call('POST', '/api/v1/account/2fa/confirm', {
      token: limited,
      body: { setupToken: setup.body?.['setupToken'], code },
    });
    expect(confirm.status).toBe(200);
    expect((confirm.body?.['backupCodes'] as string[]).length).toBe(10);
    expect(refreshCookie(confirm.cookies)).toMatch(/^dm_refresh=/);
    const full = (confirm.body?.['session'] as Record<string, unknown>)['accessToken'] as string;
    const card = await call('GET', `/api/v1/staff/accounts/${hero.id}`, { token: full });
    expect(card).toMatchObject({ status: 200, body: { email: 'target@example.com' } });
    const ban = await call('POST', `/api/v1/staff/accounts/${hero.id}/bans`, {
      token: full,
      body: { reason: 'постоянный бан без срока', expiresAt: undefined },
    });
    expect(ban).toMatchObject({
      status: 403,
      body: { error: { code: 'RBAC_INSUFFICIENT_PERMISSION' } },
    });
    expect(await call('GET', '/api/v1/staff/audit', { token: full })).toMatchObject({
      status: 403,
    });
    expect(
      await call('GET', '/api/v1/account/security-events?limit=500', { token: full }),
    ).toMatchObject({ status: 400 });
    expect(
      (await call('GET', '/api/v1/account/security-events?limit=5', { token: full })).status,
    ).toBe(200);
  });

  it('OAuth: старт ставит cookie транзакции и уводит к провайдеру; callback', async () => {
    const start = await call('GET', '/api/v1/auth/oauth/google/start');
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location') ?? '');
    expect(location.origin).toBe('https://accounts.google.com');
    const tx = start.cookies.find((c) => c.startsWith('dm_oauth=')) ?? '';
    expect(tx).toContain('Path=/api/v1/auth/oauth');
    const state = location.searchParams.get('state') ?? '';
    const callback = await call('GET', `/api/v1/auth/oauth/google/callback?code=c&state=${state}`, {
      cookie: tx.split(';')[0],
    });
    expect(callback).toMatchObject({ status: 200, body: { status: 'tos_acceptance_required' } });
    const onboard = await call('POST', '/api/v1/auth/oauth/onboard', {
      body: { onboardingToken: callback.body?.['oauthOnboardingToken'], ...h.docs },
    });
    expect(onboard.status).toBe(200);
    expect(refreshCookie(onboard.cookies)).toMatch(/^dm_refresh=/);
    expect((await call('GET', '/api/v1/auth/oauth/vk/start')).status).toBe(404);
  });
});

describe('HTTP identity: остальные маршруты', () => {
  it('аккаунт: reauth, пароль, email, 2FA, OAuth-привязка, отзыв сессии', async () => {
    await h.activeAccount('routes@example.com');
    const login = async (password = PASSWORD) =>
      (
        await call('POST', '/api/v1/auth/login', {
          body: { email: 'routes@example.com', password },
        })
      ).body?.['accessToken'] as string;
    let token = await login();
    expect(
      await call('POST', '/api/v1/account/reauth', { token, body: { password: PASSWORD } }),
    ).toMatchObject({
      status: 200,
      body: { status: 'reauthenticated' },
    });
    const other = await login();
    const otherSid = (await call('GET', '/api/v1/account/sessions', { token: other }))
      .body as unknown as {
      id: string;
      isCurrent: boolean;
    }[];
    const sid = otherSid.find((s) => s.isCurrent)?.id ?? '';
    expect((await call('DELETE', `/api/v1/account/sessions/${sid}`, { token })).status).toBe(204);
    expect((await call('DELETE', `/api/v1/account/sessions/${sid}`, { token })).status).toBe(404);

    const NEW = 'новый пароль для маршрутов';
    expect(
      await call('POST', '/api/v1/account/password', {
        token,
        body: { currentPassword: PASSWORD, newPassword: NEW },
      }),
    ).toMatchObject({ status: 200, body: { revoked: 0 } });
    expect(
      await call('POST', '/api/v1/account/email/change-request', {
        token,
        body: { newEmail: 'routes2@example.com', password: NEW },
      }),
    ).toMatchObject({ status: 202 });
    await h.flush();
    expect(
      await call('POST', '/api/v1/account/email/change-confirm', {
        body: { token: h.mail.lastToken('routes2@example.com') },
      }),
    ).toMatchObject({ status: 200, body: { status: 'email_changed' } });
    token = (
      await call('POST', '/api/v1/auth/login', {
        body: { email: 'routes2@example.com', password: NEW },
      })
    ).body?.['accessToken'] as string;

    expect(await call('GET', '/api/v1/account/2fa', { token })).toMatchObject({
      status: 200,
      body: { enabled: false },
    });
    const setup = await call('POST', '/api/v1/account/2fa/setup', {
      token,
      body: { password: NEW },
    });
    const { base32Decode, totpAt } = await import('../crypto/totp.js');
    const secret = base32Decode(setup.body?.['manualKey'] as string);
    const confirm = await call('POST', '/api/v1/account/2fa/confirm', {
      token,
      body: { setupToken: setup.body?.['setupToken'], code: totpAt(secret, h.clock.utc()) },
    });
    expect(confirm.cookies).toEqual([]);
    token = (confirm.body?.['session'] as Record<string, string>)['accessToken'] ?? '';
    h.clock.advance(30_000);
    const codes = await call('POST', '/api/v1/account/2fa/backup-codes', {
      token,
      body: { code: totpAt(secret, h.clock.utc()), password: NEW },
    });
    expect((codes.body?.['backupCodes'] as string[]).length).toBe(10);
    h.clock.advance(30_000);
    const mfaLogin = await call('POST', '/api/v1/auth/login', {
      body: { email: 'routes2@example.com', password: NEW },
    });
    const verified = await call('POST', '/api/v1/auth/mfa/verify', {
      body: {
        challengeToken: mfaLogin.body?.['mfaChallengeToken'],
        code: totpAt(secret, h.clock.utc()),
      },
    });
    expect(verified).toMatchObject({ status: 200, body: { status: 'authenticated' } });
    h.clock.advance(30_000);
    expect(
      (
        await call('POST', '/api/v1/account/2fa/disable', {
          token,
          body: { code: totpAt(secret, h.clock.utc()), password: NEW },
        })
      ).status,
    ).toBe(204);

    expect(await call('GET', '/api/v1/account/oauth', { token })).toMatchObject({
      body: { providers: [] },
    });
    const link = await call('POST', '/api/v1/account/oauth/google/link', { token });
    expect(link.cookies[0]).toMatch(/^dm_oauth=/);
    expect(new URL(link.body?.['url'] as string).searchParams.get('client_id')).toBe('cid');
    expect(
      await call('DELETE', '/api/v1/account/oauth/google', { token, body: { password: NEW } }),
    ).toMatchObject({
      status: 404,
      body: { error: { code: 'AUTH_OAUTH_PROVIDER_UNKNOWN' } },
    });
    expect(
      await call('POST', '/api/v1/auth/logout-all', { token, body: { keepCurrent: false } }),
    ).toMatchObject({
      status: 200,
    });
  });

  it('персонал: бан, снятие, отзыв, сброс 2FA, уровень, эффективный уровень, аудит', async () => {
    const target = await h.activeAccount('victim@example.com');
    const admin = await h.staffSession('boss@example.com', 'administrator');
    const token = admin.session.accessToken;
    const ban = await call('POST', `/api/v1/staff/accounts/${target.id}/bans`, {
      token,
      body: { reason: 'бессрочный бан за мошенничество' },
    });
    expect(ban).toMatchObject({ status: 201, body: { banId: expect.any(String) } });
    expect(
      (
        await call('POST', `/api/v1/staff/bans/${ban.body?.['banId']}/lift`, {
          token,
          body: { reason: 'апелляция удовлетворена' },
        })
      ).status,
    ).toBe(204);
    expect(
      await call('POST', `/api/v1/staff/accounts/${target.id}/sessions/revoke`, { token }),
    ).toMatchObject({
      status: 200,
      body: { revoked: 0 },
    });
    expect(
      (
        await call('POST', `/api/v1/staff/accounts/${target.id}/2fa/reset`, {
          token,
          body: { reason: 'потерян телефон, проверено' },
        })
      ).status,
    ).toBe(204);
    expect(
      await call('POST', `/api/v1/staff/accounts/${target.id}/access-level`, {
        token,
        body: {
          level: 'helper',
          reason: 'помощник новичков с завтрашнего дня',
          code: admin.code(),
        },
      }),
    ).toMatchObject({ status: 200, body: { newLevel: 'helper' } });
    expect(
      await call('POST', '/api/v1/staff/effective-level', { token, body: { level: 'player' } }),
    ).toMatchObject({
      status: 200,
      body: { effectiveLevel: 'player' },
    });
    const audit = await call('GET', '/api/v1/staff/audit?limit=3', { token });
    expect(audit).toMatchObject({ status: 200, body: { items: expect.any(Array) } });
    expect(await call('GET', '/api/v1/staff/audit?cursor=x&limit=abc', { token })).toMatchObject({
      status: 400,
    });
  });

  it('Referer вместо Origin и битые cookie', async () => {
    await h.activeAccount('referer@example.com');
    const login = await call('POST', '/api/v1/auth/login', {
      body: { email: 'referer@example.com', password: PASSWORD },
    });
    const cookie = `${refreshCookie(login.cookies)}; broken=%E0%A4%A`;
    const response = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { referer: `${ORIGIN}/login`, cookie },
    });
    expect(response.status).toBe(200);
    const bad = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { referer: 'not a url', cookie },
    });
    expect(bad.status).toBe(403);
  });
});
