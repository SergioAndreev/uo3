import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROVIDERS, type OAuthClient } from '../core/index.js';
import { META, PASSWORD, harness, rejects } from '../testing/harness.test-helper.js';

/** Поддельный провайдер: код → профиль, проверка PKCE. */
function fakeProvider() {
  const codes = new Map<string, { profile: Record<string, unknown>; challenge: string }>();
  const requests: { url: string; body?: string }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body?.toString() });
    if (url.endsWith('/token')) {
      const form = new URLSearchParams(String(init?.body));
      const entry = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const ok =
        entry && createHash('sha256').update(verifier).digest('base64url') === entry.challenge;
      if (!ok) return new Response('{"error":"invalid_grant"}', { status: 400 });
      return Response.json({ access_token: `at-${form.get('code')}` });
    }
    if (url.endsWith('/userinfo')) {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      const entry = codes.get(auth.replace('Bearer at-', ''));
      return entry ? Response.json(entry.profile) : new Response('', { status: 401 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const client: OAuthClient = {
    clientId: 'cid',
    clientSecret: 'secret',
    endpoints: {
      ...PROVIDERS.google,
      authorizeUrl: 'https://provider.test/authorize',
      tokenUrl: 'https://provider.test/token',
      userInfoUrl: 'https://provider.test/userinfo',
    },
  };
  /** Пользователь «прошёл» экран провайдера: код привязан к challenge из адреса. */
  const authorize = (url: string, profile: Record<string, unknown>) => {
    const params = new URL(url).searchParams;
    const code = `code-${codes.size}`;
    codes.set(code, { profile, challenge: params.get('code_challenge') ?? '' });
    return { code, state: params.get('state') ?? '' };
  };
  return { fetch, client, authorize, requests };
}

const google = (sub: string, email: string, verified = true) => ({
  sub,
  email,
  email_verified: verified,
});

describe('identity/authentication: OAuth', () => {
  it('новый пользователь: принятие документов, создание аккаунта, сессия', async () => {
    const p = fakeProvider();
    const h = harness({ fetch: p.fetch, clients: { google: p.client } });
    const { url, txId } = await h.oauth.start('google');
    const params = new URL(url).searchParams;
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('redirect_uri')).toBe('http://localhost:3001/oauth/callback/google');
    const result = await h.oauth.callback(
      'google',
      p.authorize(url, google('g-1', 'New@Example.com')),
      txId,
      META,
    );
    expect(result).toMatchObject({ status: 'tos_acceptance_required', tosVersion: '2026-11-01' });
    if (result.status !== 'tos_acceptance_required') throw new Error();
    await rejects(
      h.oauth.onboard({ onboardingToken: result.oauthOnboardingToken, tosAccepted: false }, META),
      'REG_TOS_NOT_ACCEPTED',
    );
    const session = await h.oauth.onboard(
      { onboardingToken: result.oauthOnboardingToken, ...h.docs },
      META,
    );
    expect(session.status).toBe('authenticated');
    const account = await h.store.findAccountByEmail('new@example.com');
    expect(account).toMatchObject({ status: 'active', passwordHash: null, accessLevel: 'player' });
    expect(await h.store.findOAuth('google', 'g-1')).toMatchObject({ accountId: account?.id });
    await rejects(
      h.oauth.onboard({ onboardingToken: result.oauthOnboardingToken, ...h.docs }, META),
      'AUTH_OAUTH_ONBOARDING_INVALID',
    );
  });

  it('привязанный пользователь входит; 2FA требует второй фактор', async () => {
    const p = fakeProvider();
    const h = harness({ fetch: p.fetch, clients: { google: p.client } });
    const account = await h.activeAccount('hero@example.com');
    await h.store.insertOAuth({
      provider: 'google',
      providerUserId: 'g-7',
      accountId: account.id,
      email: null,
      linkedAt: 0,
    });
    let start = await h.oauth.start('google');
    const result = await h.oauth.callback(
      'google',
      p.authorize(start.url, google('g-7', 'other@example.com')),
      start.txId,
      META,
    );
    expect(result.status).toBe('authenticated');
    await h.enableTfa(await h.login('hero@example.com'));
    start = await h.oauth.start('google');
    const second = await h.oauth.callback(
      'google',
      p.authorize(start.url, google('g-7', 'x@example.com')),
      start.txId,
      META,
    );
    expect(second.status).toBe('mfa_required');
  });

  it('совпадение email без привязки — 409, без сессии', async () => {
    const p = fakeProvider();
    const h = harness({ fetch: p.fetch, clients: { google: p.client } });
    await h.activeAccount('hero@example.com');
    const { url, txId } = await h.oauth.start('google');
    await rejects(
      h.oauth.callback('google', p.authorize(url, google('g-2', 'hero@example.com')), txId, META),
      'AUTH_OAUTH_ACCOUNT_LINK_REQUIRED',
      409,
    );
  });

  it('state: отсутствует, чужой, повторный, истёкший', async () => {
    const p = fakeProvider();
    const h = harness({ fetch: p.fetch, clients: { google: p.client } });
    const { url, txId } = await h.oauth.start('google');
    const auth = p.authorize(url, google('g-3', 'a@example.com'));
    await rejects(
      h.oauth.callback('google', { ...auth, state: 'чужой' }, txId, META),
      'AUTH_OAUTH_STATE_INVALID',
      400,
    );
    await rejects(h.oauth.callback('google', auth, txId, META), 'AUTH_OAUTH_STATE_INVALID');
    await rejects(h.oauth.callback('google', auth, undefined, META), 'AUTH_OAUTH_STATE_INVALID');
    const late = await h.oauth.start('google');
    h.clock.advance(10 * 60_000 + 1);
    await rejects(
      h.oauth.callback(
        'google',
        p.authorize(late.url, google('g-3', 'a@example.com')),
        late.txId,
        META,
      ),
      'AUTH_OAUTH_STATE_INVALID',
    );
  });

  it('обмен кода: неверный verifier, сбой провайдера, неподтверждённый email, неизвестный провайдер', async () => {
    const p = fakeProvider();
    const h = harness({ fetch: p.fetch, clients: { google: p.client } });
    const { url } = await h.oauth.start('google');
    const auth = p.authorize(url, google('g-4', 'u@example.com'));
    const other = await h.oauth.start('google');
    await rejects(
      h.oauth.callback(
        'google',
        { code: auth.code, state: new URL(other.url).searchParams.get('state') ?? '' },
        other.txId,
        META,
      ),
      'AUTH_OAUTH_EXCHANGE_FAILED',
      502,
    );
    const s2 = await h.oauth.start('google');
    await rejects(
      h.oauth.callback(
        'google',
        p.authorize(s2.url, google('g-5', 'u@example.com', false)),
        s2.txId,
        META,
      ),
      'AUTH_OAUTH_EXCHANGE_FAILED',
    );
    const broken = harness({
      fetch: (async () => {
        throw new Error('сеть');
      }) as typeof fetch,
      clients: { google: p.client },
    });
    const s3 = await broken.oauth.start('google');
    await rejects(
      broken.oauth.callback(
        'google',
        { code: 'c', state: new URL(s3.url).searchParams.get('state') ?? '' },
        s3.txId,
        META,
      ),
      'AUTH_OAUTH_EXCHANGE_FAILED',
    );
    await rejects(h.oauth.start('discord'), 'AUTH_OAUTH_PROVIDER_UNKNOWN', 404);
    await rejects(h.oauth.start('myspace'), 'AUTH_OAUTH_PROVIDER_UNKNOWN');
  });

  it('привязка, занятый внешний аккаунт, отвязка и последний способ входа', async () => {
    const p = fakeProvider();
    const h = harness({ fetch: p.fetch, clients: { google: p.client } });
    await h.activeAccount('hero@example.com');
    const principal = await h.auth.authenticate((await h.login('hero@example.com')).accessToken);
    const start = await h.oauth.start('google', principal);
    const linked = await h.oauth.callback(
      'google',
      p.authorize(start.url, google('g-8', 'hero@gmail.example')),
      start.txId,
      META,
    );
    expect(linked).toEqual({ status: 'linked', providers: ['google'] });
    const again = await h.oauth.start('google', principal);
    expect(
      await h.oauth.callback(
        'google',
        p.authorize(again.url, google('g-8', 'x')),
        again.txId,
        META,
      ),
    ).toEqual({ status: 'linked', providers: ['google'] });

    await h.activeAccount('rival@example.com');
    const rival = await h.auth.authenticate((await h.login('rival@example.com')).accessToken);
    const steal = await h.oauth.start('google', rival);
    await rejects(
      h.oauth.callback('google', p.authorize(steal.url, google('g-8', 'x')), steal.txId, META),
      'AUTH_OAUTH_ALREADY_LINKED',
      409,
    );

    h.clock.advance(11 * 60_000);
    await rejects(
      h.oauth.unlink(principal, 'google', undefined, META),
      'AUTH_REAUTH_REQUIRED',
      403,
    );
    expect(await h.oauth.unlink(principal, 'google', PASSWORD, META)).toEqual({ providers: [] });
    await rejects(
      h.oauth.unlink(principal, 'google', PASSWORD, META),
      'AUTH_OAUTH_PROVIDER_UNKNOWN',
    );

    const s = await h.oauth.start('google');
    const onboarding = await h.oauth.callback(
      'google',
      p.authorize(s.url, google('g-9', 'solo@example.com')),
      s.txId,
      META,
    );
    if (onboarding.status !== 'tos_acceptance_required') throw new Error();
    const solo = await h.oauth.onboard(
      { onboardingToken: onboarding.oauthOnboardingToken, ...h.docs },
      META,
    );
    const soloPrincipal = await h.auth.authenticate(solo.accessToken);
    await rejects(
      h.oauth.unlink(soloPrincipal, 'google', undefined, META),
      'AUTH_LAST_AUTH_METHOD',
      409,
    );
  });

  it('Discord: профиль без подтверждённого email', () => {
    expect(PROVIDERS.discord.profile({ id: '42', email: 'a@b.cd', verified: false })).toEqual({
      id: '42',
      email: null,
    });
    expect(PROVIDERS.discord.profile({ id: '42', email: 'a@b.cd', verified: true })).toEqual({
      id: '42',
      email: 'a@b.cd',
    });
    expect(PROVIDERS.google.profile({})).toEqual({ id: '', email: null });
  });
});
