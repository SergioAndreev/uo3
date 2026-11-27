import { createHash } from 'node:crypto';
import type { OAuthProvider } from '@duskmarch/protocol';
import { newToken, safeEqual, sha256Hex } from '../crypto/random.js';
import type { AuthService, LoginResult, Principal } from './auth.js';
import { canonicalEmail } from './email.js';
import { Identity, LIMITS, type RequestMeta } from './context.js';
import { IdentityError } from './errors.js';
import type { RegistrationService } from './registration.js';

export interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string;
  /** Профиль провайдера → идентификатор и подтверждённый email. */
  profile(raw: Record<string, unknown>): { id: string; email: string | null };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export const PROVIDERS: Readonly<Record<OAuthProvider, ProviderEndpoints>> = {
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: 'identify email',
    profile: (raw) => ({
      id: str(raw['id']) ?? '',
      email: raw['verified'] === true ? str(raw['email']) : null,
    }),
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: 'openid email',
    profile: (raw) => ({
      id: str(raw['sub']) ?? '',
      email: raw['email_verified'] === true ? str(raw['email']) : null,
    }),
  },
};

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  endpoints: ProviderEndpoints;
}

export interface OAuthSettings {
  redirectBaseUrl: string;
  clients: Partial<Record<OAuthProvider, OAuthClient>>;
  fetch: typeof fetch;
}

interface OAuthTx {
  provider: OAuthProvider;
  state: string;
  verifier: string;
  mode: 'login' | 'link';
  accountId: string | null;
}

interface Onboarding {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
}

const txKey = (id: string) => `identity:oauth:${sha256Hex(id)}`;
const onboardKey = (token: string) => `identity:oauth-onboard:${sha256Hex(token)}`;

export type CallbackResult =
  | LoginResult
  | {
      status: 'tos_acceptance_required';
      oauthOnboardingToken: string;
      tosVersion: string;
      privacyVersion: string;
    }
  | { status: 'linked'; providers: string[] };

/** OAuth 2.0 Authorization Code + PKCE (S256). */
export class OAuthService {
  constructor(
    private readonly id: Identity,
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    private readonly settings: OAuthSettings,
  ) {}

  private client(provider: string): { name: OAuthProvider; client: OAuthClient } {
    const client = (this.settings.clients as Record<string, OAuthClient | undefined>)[provider];
    if (!client)
      throw new IdentityError('AUTH_OAUTH_PROVIDER_UNKNOWN', `провайдер ${provider} не настроен`);
    return { name: provider as OAuthProvider, client };
  }

  /** Включённые провайдеры для экрана входа. */
  enabled(): string[] {
    return Object.entries(this.settings.clients)
      .filter(([, client]) => client)
      .map(([name]) => name)
      .sort();
  }

  private redirectUri(provider: string): string {
    // Провайдер возвращает игрока в клиент; клиент передаёт код и state в API (P09).
    return `${this.settings.redirectBaseUrl.replace(/\/$/, '')}/oauth/callback/${provider}`;
  }

  /** Адрес провайдера и идентификатор транзакции для cookie. */
  async start(provider: string, principal?: Principal): Promise<{ url: string; txId: string }> {
    const { name, client } = this.client(provider);
    const tx: OAuthTx = {
      provider: name,
      state: newToken(this.id.deps.entropy),
      verifier: newToken(this.id.deps.entropy),
      mode: principal ? 'link' : 'login',
      accountId: principal?.accountId ?? null,
    };
    const txId = newToken(this.id.deps.entropy);
    await this.id.kv.set(txKey(txId), JSON.stringify(tx), LIMITS.oauthTxTtl);
    const challenge = createHash('sha256').update(tx.verifier).digest('base64url');
    const url = new URL(client.endpoints.authorizeUrl);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: this.redirectUri(name),
      scope: client.endpoints.scopes,
      state: tx.state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.href, txId };
  }

  private async exchange(name: OAuthProvider, client: OAuthClient, code: string, verifier: string) {
    const failed = () =>
      new IdentityError('AUTH_OAUTH_EXCHANGE_FAILED', 'провайдер не подтвердил вход');
    try {
      const token = await this.settings.fetch(client.endpoints.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri(name),
          client_id: client.clientId,
          client_secret: client.clientSecret,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const accessToken = token.ok
        ? str(((await token.json()) as Record<string, unknown>)['access_token'])
        : null;
      if (!accessToken) throw failed();
      const info = await this.settings.fetch(client.endpoints.userInfoUrl, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!info.ok) throw failed();
      const profile = client.endpoints.profile((await info.json()) as Record<string, unknown>);
      if (!profile.id) throw failed();
      return profile;
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw failed();
    }
  }

  async callback(
    provider: string,
    query: { code?: string | undefined; state?: string | undefined },
    txId: string | undefined,
    meta: RequestMeta,
  ): Promise<CallbackResult> {
    const { name, client } = this.client(provider);
    const raw = txId ? await this.id.kv.take(txKey(txId)) : null;
    const tx = raw ? (JSON.parse(raw) as OAuthTx) : null;
    if (
      !tx ||
      tx.provider !== name ||
      !query.state ||
      !query.code ||
      !safeEqual(tx.state, query.state)
    ) {
      throw new IdentityError('AUTH_OAUTH_STATE_INVALID', 'state не совпадает или истёк');
    }
    const profile = await this.exchange(name, client, query.code, tx.verifier);
    const linked = await this.id.store.findOAuth(name, profile.id);
    if (tx.mode === 'link' && tx.accountId) {
      if (linked && linked.accountId !== tx.accountId) {
        throw new IdentityError('AUTH_OAUTH_ALREADY_LINKED', 'внешний аккаунт уже привязан');
      }
      if (!linked) {
        await this.id.store.transaction(async (store) => {
          await store.insertOAuth({
            provider: name,
            providerUserId: profile.id,
            accountId: tx.accountId as string,
            email: profile.email,
            linkedAt: this.id.now(),
          });
          await this.id.securityEvent(store, tx.accountId, 'oauth_linked', 'success', meta, name);
        });
      }
      return { status: 'linked', providers: await this.providers(tx.accountId) };
    }
    if (linked) {
      const account = await this.id.store.findAccount(linked.accountId);
      if (!account || account.status !== 'active') {
        throw new IdentityError('AUTH_INVALID_CREDENTIALS', 'аккаунт недоступен');
      }
      return this.auth.afterFirstFactor(account, meta);
    }
    const email = profile.email === null ? null : canonicalEmail(profile.email);
    if (!email)
      throw new IdentityError('AUTH_OAUTH_EXCHANGE_FAILED', 'провайдер не подтвердил email');
    if (await this.id.store.findAccountByEmail(email)) {
      throw new IdentityError('AUTH_OAUTH_ACCOUNT_LINK_REQUIRED', 'войдите и привяжите провайдера');
    }
    const token = newToken(this.id.deps.entropy);
    const onboarding: Onboarding = { provider: name, providerUserId: profile.id, email };
    await this.id.kv.set(onboardKey(token), JSON.stringify(onboarding), LIMITS.oauthTxTtl);
    return {
      status: 'tos_acceptance_required',
      oauthOnboardingToken: token,
      ...this.registration.documents(),
    };
  }

  async onboard(
    input: {
      onboardingToken: string;
      tosAccepted: boolean;
      tosVersion?: string | undefined;
      privacyVersion?: string | undefined;
    },
    meta: RequestMeta,
  ) {
    this.registration.checkDocuments(input);
    const raw = await this.id.kv.take(onboardKey(input.onboardingToken));
    if (!raw) throw new IdentityError('AUTH_OAUTH_ONBOARDING_INVALID', 'токен онбординга истёк');
    const data = JSON.parse(raw) as Onboarding;
    const now = this.id.now();
    const accountId = this.id.id();
    await this.id.store.transaction(async (store) => {
      if (await store.findAccountByEmail(data.email)) {
        throw new IdentityError('AUTH_OAUTH_ACCOUNT_LINK_REQUIRED', 'адрес уже занят');
      }
      if (await store.findOAuth(data.provider, data.providerUserId)) {
        throw new IdentityError('AUTH_OAUTH_ALREADY_LINKED', 'внешний аккаунт уже привязан');
      }
      await store.insertAccount({
        id: accountId,
        email: data.email,
        passwordHash: null,
        status: 'active',
        accessLevel: 'player',
        effectiveLevel: 'player',
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await store.insertTos({
        id: this.id.id(),
        accountId,
        tosVersion: input.tosVersion as string,
        privacyVersion: input.privacyVersion as string,
        ip: meta.ip,
        userAgent: meta.userAgent,
        acceptedAt: now,
      });
      await store.insertOAuth({
        provider: data.provider,
        providerUserId: data.providerUserId,
        accountId,
        email: data.email,
        linkedAt: now,
      });
    });
    return this.auth.issue((await this.id.store.findAccount(accountId))!, meta, false);
  }

  async providers(accountId: string): Promise<string[]> {
    return (await this.id.store.listOAuth(accountId)).map((o) => o.provider);
  }

  async unlink(
    principal: Principal,
    provider: string,
    password: string | undefined,
    meta: RequestMeta,
  ) {
    const account = await this.auth.requireFresh(principal, password);
    const links = await this.id.store.listOAuth(account.id);
    if (!links.some((l) => l.provider === provider)) {
      throw new IdentityError('AUTH_OAUTH_PROVIDER_UNKNOWN', 'провайдер не привязан');
    }
    if (account.passwordHash === null && links.length <= 1) {
      throw new IdentityError('AUTH_LAST_AUTH_METHOD', 'это единственный способ входа');
    }
    await this.id.store.transaction(async (store) => {
      await store.deleteOAuth(account.id, provider);
      await this.id.securityEvent(store, account.id, 'oauth_unlinked', 'success', meta, provider);
    });
    return { providers: await this.providers(account.id) };
  }
}
