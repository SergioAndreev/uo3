import { isStaff, type AccessLevel } from '@duskmarch/domain';
import { ACCESS_TOKEN_VERSION } from '@duskmarch/protocol';
import { newToken, sha256Hex } from '../crypto/random.js';
import type { AccountRecord, IdentityStore, SessionRecord } from '../ports.js';
import { canonicalEmail } from './email.js';
import { HOUR, Identity, LIMITS, bannedKey, revokedKey, type RequestMeta } from './context.js';
import { IdentityError } from './errors.js';
import { MAIL } from './mail-templates.js';
import { clear, hit, peek } from './rate-limit.js';

/** Аутентифицированный запрос. */
export interface Principal {
  accountId: string;
  sessionId: string;
  acl: AccessLevel;
  eacl: AccessLevel;
  mfa: boolean;
  setupOnly: boolean;
}

export interface IssuedSession {
  status: 'authenticated';
  accessToken: string;
  expiresIn: number;
  sessionId: string;
  accessLevel: AccessLevel;
  /** Значение cookie; в тело ответа не попадает. */
  refreshToken: string;
  refreshExpiresAt: number;
}

export type LoginResult =
  | IssuedSession
  | { status: 'mfa_required'; mfaChallengeToken: string; expiresIn: number }
  | { status: 'staff_2fa_setup_required'; accessToken: string; expiresIn: number };

/** Состояние challenge второго фактора в ключ-значение. */
export interface MfaChallenge {
  accountId: string;
  ip: string;
  userAgent: string;
}

export const mfaKey = (token: string): string => `identity:mfa:${sha256Hex(token)}`;
const lockKey = (hash: string) => `identity:lock:${hash}`;
const lockRecentKey = (hash: string) => `identity:lock-recent:${hash}`;

/** identity/authentication: вход, сессии, токены. */
export class AuthService {
  constructor(private readonly id: Identity) {}

  /** Проверяет `Origin` cookie-эндпоинтов. */
  checkOrigin(meta: RequestMeta): void {
    if (!meta.origin || !this.id.settings.trustedOrigins.includes(meta.origin)) {
      throw new IdentityError('AUTH_CSRF_ORIGIN_MISMATCH', 'недоверенный Origin');
    }
  }

  accessToken(account: AccountRecord, session: SessionRecord, setupOnly = false): string {
    const iat = Math.floor(this.id.now() / 1000);
    return this.id.deps.keys.sign({
      iss: this.id.settings.issuer,
      aud: this.id.settings.audience,
      sub: account.id,
      sid: session.id,
      jti: this.id.id(),
      iat,
      exp: iat + LIMITS.accessTtlS,
      acl: account.accessLevel,
      eacl: account.effectiveLevel,
      mfa: session.mfa,
      ver: ACCESS_TOKEN_VERSION,
      ...(setupOnly ? { scope: 'tfa_setup' as const } : {}),
    });
  }

  private async newRefresh(store: IdentityStore, session: SessionRecord) {
    const token = newToken(this.id.deps.entropy);
    const expiresAt = Math.min(this.id.now() + LIMITS.refreshTtl, session.familyExpiresAt);
    await store.insertRefresh({
      id: this.id.id(),
      sessionId: session.id,
      tokenHash: sha256Hex(token),
      status: 'active',
      createdAt: this.id.now(),
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** Новая сессия с вытеснением самой старой сверх лимита. */
  private async openSession(
    store: IdentityStore,
    account: AccountRecord,
    meta: RequestMeta,
    mfa: boolean,
  ): Promise<SessionRecord> {
    const now = this.id.now();
    const active = (await store.listActiveSessions(account.id, now)).sort(
      (a, b) => a.lastUsedAt - b.lastUsedAt,
    );
    const evicted: string[] = [];
    for (const old of active.slice(0, Math.max(0, active.length - LIMITS.maxSessions + 1))) {
      if (await store.revokeSession(old.id, 'session_limit_exceeded', now)) evicted.push(old.id);
    }
    if (evicted.length > 0) {
      await this.id.markRevoked(evicted);
      await this.id.event(store, 'identity.account.sessions_revoked', {
        accountId: account.id,
        sessionIds: evicted,
        reason: 'session_limit_exceeded',
      });
    }
    const session: SessionRecord = {
      id: this.id.id(),
      accountId: account.id,
      createdAt: now,
      lastUsedAt: now,
      familyExpiresAt: now + LIMITS.familyTtl,
      revokedAt: null,
      revokeReason: null,
      mfa,
      reauthAt: now,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    await store.insertSession(session);
    return session;
  }

  /** Полноценная сессия: Access JWT и refresh-токен. */
  async issue(account: AccountRecord, meta: RequestMeta, mfa: boolean): Promise<IssuedSession> {
    return this.id.store.transaction(async (store) => {
      const recent = await store.listSecurityEvents(account.id, { limit: 50 });
      const hadLogin = recent.items.some((e) => e.type === 'login' && e.outcome === 'success');
      if (hadLogin && !(await store.knownDevice(account.id, meta.ip, meta.userAgent))) {
        await this.id.email(
          store,
          MAIL.notice(
            account.email,
            'вход с нового устройства',
            `Вход ${this.id.iso()} UTC с адреса ${meta.ip} (${meta.userAgent}). Если это не вы, завершите все сессии: ${this.id.settings.publicUrl}/account/sessions`,
          ),
        );
      }
      const session = await this.openSession(store, account, meta, mfa);
      const refresh = await this.newRefresh(store, session);
      await this.id.securityEvent(store, account.id, 'login', 'success', meta);
      return {
        status: 'authenticated' as const,
        accessToken: this.accessToken(account, session),
        expiresIn: LIMITS.accessTtlS,
        sessionId: session.id,
        accessLevel: account.accessLevel,
        refreshToken: refresh.token,
        refreshExpiresAt: refresh.expiresAt,
      };
    });
  }

  /** Бан, действующий сейчас, как ошибка. */
  async assertNotBanned(store: IdentityStore, accountId: string): Promise<void> {
    const ban = await store.activeBan(accountId, this.id.now());
    if (ban) {
      throw new IdentityError('SEC_ACCOUNT_BANNED', 'аккаунт заблокирован', {
        details: {
          reason: ban.reason,
          expiresAt: ban.expiresAt === null ? null : this.id.iso(ban.expiresAt),
        },
      });
    }
  }

  /** Шаг после первого фактора: 2FA, ограниченный режим персонала или сессия. */
  async afterFirstFactor(account: AccountRecord, meta: RequestMeta): Promise<LoginResult> {
    await this.assertNotBanned(this.id.store, account.id);
    const totp = await this.id.store.getTotp(account.id);
    if (totp?.status === 'enabled') {
      const token = newToken(this.id.deps.entropy);
      const challenge: MfaChallenge = {
        accountId: account.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      };
      await this.id.kv.set(mfaKey(token), JSON.stringify(challenge), LIMITS.mfaChallengeTtl);
      return {
        status: 'mfa_required',
        mfaChallengeToken: token,
        expiresIn: LIMITS.mfaChallengeTtl / 1000,
      };
    }
    if (isStaff(account.accessLevel)) {
      const session = await this.id.store.transaction(async (store) => {
        const opened = await this.openSession(store, account, meta, false);
        await this.id.securityEvent(
          store,
          account.id,
          'login',
          'success',
          meta,
          'TFA_SETUP_REQUIRED',
        );
        return opened;
      });
      return {
        status: 'staff_2fa_setup_required',
        accessToken: this.accessToken(account, session, true),
        expiresIn: LIMITS.accessTtlS,
      };
    }
    return this.issue(account, meta, false);
  }

  private async recordFailure(account: AccountRecord | null, hash: string, meta: RequestMeta) {
    const now = this.id.now();
    await hit(this.id.kv, `ip-fail:${meta.ip}`, LIMITS.loginWindow, now);
    const state = await hit(this.id.kv, `login-fail:${hash}`, LIMITS.loginWindow, now);
    await this.id.store.transaction(async (store) => {
      await this.id.securityEvent(
        store,
        account?.id ?? null,
        'login',
        'failure',
        meta,
        'AUTH_INVALID_CREDENTIALS',
      );
      if (state.count < LIMITS.loginFailures) return;
      const repeat = (await this.id.kv.ttl(lockRecentKey(hash))) > 0;
      await this.id.kv.set(lockKey(hash), '1', repeat ? LIMITS.loginLockRepeat : LIMITS.loginLock);
      await this.id.kv.set(lockRecentKey(hash), '1', 24 * HOUR);
      await clear(this.id.kv, `login-fail:${hash}`, LIMITS.loginWindow, now);
      if (account) {
        await this.id.securityEvent(
          store,
          account.id,
          'login_locked',
          'failure',
          meta,
          'SEC_LOGIN_LOCKED',
        );
        await this.id.email(
          store,
          MAIL.notice(
            account.email,
            'подозрительные попытки входа',
            `Вход временно заблокирован после ${LIMITS.loginFailures} неверных паролей. Последняя попытка: адрес ${meta.ip}.`,
          ),
        );
      }
    });
  }

  async login(rawEmail: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const now = this.id.now();
    const ip = await peek(this.id.kv, `ip-fail:${meta.ip}`, LIMITS.loginWindow, now);
    if (ip.count >= LIMITS.ipFailures) {
      throw new IdentityError('SEC_IP_RATE_LIMITED', 'слишком много неудачных входов', {
        retryAfterS: ip.retryAfterS,
      });
    }
    const email = canonicalEmail(rawEmail) ?? rawEmail.trim().toLowerCase();
    const hash = sha256Hex(email);
    const locked = await this.id.kv.ttl(lockKey(hash));
    if (locked > 0) {
      throw new IdentityError('SEC_LOGIN_LOCKED', 'вход временно заблокирован', {
        retryAfterS: Math.ceil(locked / 1000),
      });
    }
    const account = await this.id.store.findAccountByEmail(email);
    const hasher = this.id.deps.hasher;
    const valid = account?.passwordHash
      ? await hasher.verify(account.passwordHash, password)
      : await hasher.verifyDummy(password);
    if (!account || !valid) {
      await this.recordFailure(account, hash, meta);
      throw new IdentityError('AUTH_INVALID_CREDENTIALS', 'неверный email или пароль');
    }
    await clear(this.id.kv, `login-fail:${hash}`, LIMITS.loginWindow, now);
    if (account.passwordHash && hasher.needsRehash(account.passwordHash)) {
      await this.id.store.updateAccount(account.id, {
        passwordHash: await hasher.hash(password),
        updatedAt: now,
      });
    }
    if (account.status !== 'active') {
      throw new IdentityError('AUTH_EMAIL_NOT_VERIFIED', 'email не подтверждён');
    }
    return this.afterFirstFactor(account, meta);
  }

  /** Отзыв всей сессии при повторном предъявлении ротированного токена. */
  private async reuseDetected(session: SessionRecord, meta: RequestMeta): Promise<never> {
    await this.id.store.transaction(async (store) => {
      await store.revokeSession(session.id, 'token_reuse', this.id.now());
      await this.id.securityEvent(
        store,
        session.accountId,
        'refresh_reuse',
        'failure',
        meta,
        'AUTH_TOKEN_REUSE_DETECTED',
      );
      await this.id.event(store, 'identity.account.sessions_revoked', {
        accountId: session.accountId,
        sessionIds: [session.id],
        reason: 'token_reuse',
      });
      const account = await store.findAccount(session.accountId);
      if (account) {
        await this.id.email(
          store,
          MAIL.notice(
            account.email,
            'сессия отозвана',
            `Повторно предъявлен уже использованный токен обновления (адрес ${meta.ip}). Сессия завершена; если это не вы, смените пароль.`,
          ),
        );
      }
    });
    await this.id.markRevoked([session.id]);
    throw new IdentityError('AUTH_TOKEN_REUSE_DETECTED', 'токен обновления уже использован', {
      clearRefresh: true,
    });
  }

  async refresh(token: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    this.checkOrigin(meta);
    if (!token) throw new IdentityError('AUTH_REFRESH_TOKEN_MISSING', 'нет cookie обновления');
    const record = await this.id.store.findRefresh(sha256Hex(token));
    const now = this.id.now();
    if (!record) {
      throw new IdentityError('AUTH_TOKEN_INVALID', 'токен обновления неизвестен', {
        clearRefresh: true,
      });
    }
    const session = await this.id.store.findSession(record.sessionId);
    if (!session) {
      throw new IdentityError('AUTH_TOKEN_INVALID', 'сессия не найдена', { clearRefresh: true });
    }
    if (record.status === 'rotated' && session.revokedAt === null) {
      return this.reuseDetected(session, meta);
    }
    if (session.revokedAt !== null || record.status !== 'active') {
      throw new IdentityError('AUTH_SESSION_REVOKED', 'сессия отозвана', { clearRefresh: true });
    }
    if (session.familyExpiresAt <= now || record.expiresAt <= now) {
      throw new IdentityError('AUTH_SESSION_EXPIRED', 'срок сессии истёк', { clearRefresh: true });
    }
    const account = await this.id.store.findAccount(session.accountId);
    if (!account || account.status !== 'active') {
      throw new IdentityError('AUTH_SESSION_REVOKED', 'аккаунт недоступен', { clearRefresh: true });
    }
    await this.assertNotBanned(this.id.store, account.id);
    const next = await this.id.store.transaction(async (store) => {
      if (!(await store.swapRefreshStatus(record.id, 'active', 'rotated'))) return null;
      await store.updateSession(session.id, { lastUsedAt: now });
      return this.newRefresh(store, session);
    });
    if (!next) return this.reuseDetected(session, meta);
    return {
      status: 'authenticated',
      accessToken: this.accessToken(account, session),
      expiresIn: LIMITS.accessTtlS,
      sessionId: session.id,
      accessLevel: account.accessLevel,
      refreshToken: next.token,
      refreshExpiresAt: next.expiresAt,
    };
  }

  /** Проверка Access JWT для охранника. */
  async authenticate(bearer: string | undefined, allowSetupOnly = false): Promise<Principal> {
    if (!bearer) throw new IdentityError('AUTH_UNAUTHENTICATED', 'нужен Access JWT');
    const result = this.id.deps.keys.verify(bearer, this.id.now(), {
      iss: this.id.settings.issuer,
      aud: this.id.settings.audience,
    });
    if (!result.ok) {
      throw new IdentityError(
        result.reason === 'expired' ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
        'Access JWT отклонён',
      );
    }
    const { claims } = result;
    const [revoked, banned] = await this.id.kv.many([
      revokedKey(claims.sid),
      bannedKey(claims.sub),
    ]);
    if (revoked) throw new IdentityError('AUTH_SESSION_REVOKED', 'сессия отозвана');
    if (banned) throw new IdentityError('SEC_ACCOUNT_BANNED', 'аккаунт заблокирован');
    const setupOnly = claims.scope === 'tfa_setup';
    if (setupOnly && !allowSetupOnly) {
      throw new IdentityError('TFA_SETUP_REQUIRED', 'персоналу нужно включить 2FA');
    }
    return {
      accountId: claims.sub,
      sessionId: claims.sid,
      acl: claims.acl,
      eacl: claims.eacl,
      mfa: claims.mfa,
      setupOnly,
    };
  }

  async logout(principal: Principal, meta: RequestMeta): Promise<void> {
    await this.revokeOwn(principal, principal.sessionId, 'logout', meta);
  }

  /** Отзывает одну сессию своего аккаунта; чужая — «не найдена». */
  async revokeOwn(principal: Principal, sessionId: string, reason: string, meta: RequestMeta) {
    const session = await this.id.store.findSession(sessionId);
    if (!session || session.accountId !== principal.accountId || session.revokedAt !== null) {
      throw new IdentityError('SEC_SESSION_NOT_FOUND', 'сессия не найдена');
    }
    await this.id.store.transaction(async (store) => {
      await store.revokeSession(sessionId, reason, this.id.now());
      await this.id.securityEvent(
        store,
        principal.accountId,
        'session_revoked',
        'success',
        meta,
        reason,
      );
      await this.id.event(store, 'identity.account.sessions_revoked', {
        accountId: principal.accountId,
        sessionIds: [sessionId],
        reason,
      });
    });
    await this.id.markRevoked([sessionId]);
  }

  /** Отзыв всех сессий аккаунта; `keepId` — сохранить текущую. */
  async revokeAll(
    store: IdentityStore,
    accountId: string,
    reason: string,
    keepId?: string,
  ): Promise<string[]> {
    const ids = await store.revokeSessions(accountId, reason, this.id.now(), keepId);
    if (ids.length > 0) {
      await this.id.event(store, 'identity.account.sessions_revoked', {
        accountId,
        sessionIds: ids,
        reason,
      });
    }
    return ids;
  }

  async logoutAll(principal: Principal, keepCurrent: boolean, meta: RequestMeta) {
    const ids = await this.id.store.transaction(async (store) => {
      const revoked = await this.revokeAll(
        store,
        principal.accountId,
        'logout_all',
        keepCurrent ? principal.sessionId : undefined,
      );
      await this.id.securityEvent(store, principal.accountId, 'logout_all', 'success', meta);
      return revoked;
    });
    await this.id.markRevoked(ids);
    return { revoked: ids.length };
  }

  async listSessions(principal: Principal) {
    const sessions = await this.id.store.listActiveSessions(principal.accountId, this.id.now());
    return sessions
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((s) => ({
        id: s.id,
        createdAt: this.id.iso(s.createdAt),
        lastUsedAt: this.id.iso(s.lastUsedAt),
        ip: s.ip,
        userAgent: s.userAgent,
        isCurrent: s.id === principal.sessionId,
      }));
  }

  /** Аккаунт сессии; отозванная или исчезнувшая — ошибка. */
  async accountOf(principal: Principal): Promise<AccountRecord> {
    const account = await this.id.store.findAccount(principal.accountId);
    if (!account) throw new IdentityError('AUTH_SESSION_REVOKED', 'аккаунт не найден');
    return account;
  }

  async session(principal: Principal): Promise<SessionRecord> {
    const session = await this.id.store.findSession(principal.sessionId);
    if (!session || session.revokedAt !== null) {
      throw new IdentityError('AUTH_SESSION_REVOKED', 'сессия отозвана');
    }
    return session;
  }

  /**
   * Сессия прошла второй фактор: `mfa: true`, свежее подтверждение.
   * `withRefresh` — выдать refresh (ограниченная сессия персонала его не имела).
   */
  async upgradeSession(principal: Principal, withRefresh: boolean) {
    const account = await this.accountOf(principal);
    return this.id.store.transaction(async (store) => {
      const session = await this.session(principal);
      const upgraded = {
        ...session,
        mfa: true,
        reauthAt: this.id.now(),
        lastUsedAt: this.id.now(),
      };
      await store.updateSession(session.id, {
        mfa: true,
        reauthAt: upgraded.reauthAt,
        lastUsedAt: upgraded.lastUsedAt,
      });
      const refresh = withRefresh ? await this.newRefresh(store, upgraded) : undefined;
      return {
        status: 'authenticated' as const,
        accessToken: this.accessToken(account, upgraded),
        expiresIn: LIMITS.accessTtlS,
        sessionId: session.id,
        accessLevel: account.accessLevel,
        ...(refresh ? { refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt } : {}),
      };
    });
  }

  /** Свежее подтверждение личности: пароль в запросе или `reauthAt` не старше 10 минут. */
  async requireFresh(principal: Principal, password?: string): Promise<AccountRecord> {
    const account = await this.accountOf(principal);
    if (password !== undefined) {
      if (
        account.passwordHash &&
        (await this.id.deps.hasher.verify(account.passwordHash, password))
      ) {
        await this.id.store.updateSession(principal.sessionId, { reauthAt: this.id.now() });
        return account;
      }
      throw new IdentityError('AUTH_INVALID_CREDENTIALS', 'неверный пароль');
    }
    const session = await this.session(principal);
    if (session.reauthAt === null || this.id.now() - session.reauthAt > LIMITS.reauthWindow) {
      throw new IdentityError('AUTH_REAUTH_REQUIRED', 'подтвердите пароль');
    }
    return account;
  }
}
