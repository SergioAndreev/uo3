import { passwordViolations } from '../crypto/password.js';
import { sha256Hex } from '../crypto/random.js';
import type { AuthService, Principal } from './auth.js';
import { canonicalEmail } from './email.js';
import { DAY, Identity, LIMITS, MINUTE, type RequestMeta } from './context.js';
import { IdentityError } from './errors.js';
import { MAIL } from './mail-templates.js';
import { hit } from './rate-limit.js';
import type { TwoFactorService } from './two-factor.js';

const ACCEPTED = { status: 'accepted' } as const;

/** identity/account-security: пароли, email, журнал. */
export class SecurityService {
  constructor(
    private readonly id: Identity,
    private readonly auth: AuthService,
    private readonly tfa: TwoFactorService,
  ) {}

  private policy(password: string, email: string): void {
    const violations = passwordViolations(password, email);
    if (violations.length > 0) {
      throw new IdentityError('REG_WEAK_PASSWORD', 'пароль не соответствует политике', {
        details: { violations },
      });
    }
  }

  /** Единый `202`; кулдаун 60 с и 5 писем в сутки на адрес, 15 запросов за 15 минут с IP. */
  async requestReset(rawEmail: string, meta: RequestMeta) {
    const now = this.id.now();
    const ip = await hit(this.id.kv, `reset-ip:${meta.ip}`, 15 * MINUTE, now);
    if (ip.count > 15) {
      throw new IdentityError('SEC_IP_RATE_LIMITED', 'слишком много запросов', {
        retryAfterS: ip.retryAfterS,
      });
    }
    const email = canonicalEmail(rawEmail);
    if (!email) return ACCEPTED;
    const hash = sha256Hex(email);
    const cooldown = `identity:cooldown:reset:${hash}`;
    if ((await this.id.kv.ttl(cooldown)) > 0) return ACCEPTED;
    await this.id.kv.set(cooldown, '1', LIMITS.resendCooldown);
    if ((await hit(this.id.kv, `reset-day:${hash}`, DAY, now)).count > LIMITS.resendPerDay) {
      return ACCEPTED;
    }
    const account = await this.id.store.findAccountByEmail(email);
    if (account?.status === 'active') {
      await this.id.store.transaction(async (store) => {
        const token = await this.id.emailToken(store, account.id, 'reset', LIMITS.resetTokenTtl);
        await this.id.email(
          store,
          MAIL.passwordReset(email, this.id.link('/reset-password', token)),
        );
      });
    }
    return ACCEPTED;
  }

  async confirmReset(token: string, newPassword: string, meta: RequestMeta) {
    const record = await this.id.store.findEmailToken(sha256Hex(token));
    if (!record || record.purpose !== 'reset' || record.usedAt !== null) {
      throw new IdentityError('SEC_RESET_TOKEN_INVALID', 'токен недействителен');
    }
    if (record.expiresAt <= this.id.now()) {
      throw new IdentityError('SEC_RESET_TOKEN_EXPIRED', 'срок токена истёк');
    }
    const account = await this.id.store.findAccount(record.accountId);
    if (!account || account.status !== 'active') {
      throw new IdentityError('SEC_RESET_TOKEN_INVALID', 'токен недействителен');
    }
    this.policy(newPassword, account.email);
    const passwordHash = await this.id.deps.hasher.hash(newPassword);
    const revoked = await this.id.store.transaction(async (store) => {
      if (!(await store.markEmailTokenUsed(record.id, this.id.now()))) {
        throw new IdentityError('SEC_RESET_TOKEN_INVALID', 'токен недействителен');
      }
      await store.updateAccount(account.id, { passwordHash, updatedAt: this.id.now() });
      const ids = await this.auth.revokeAll(store, account.id, 'password_reset');
      await this.id.securityEvent(store, account.id, 'password_reset', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(
          account.email,
          'пароль изменён',
          'Пароль сброшен по ссылке из письма; все сессии завершены.',
        ),
      );
      return ids;
    });
    await this.id.markRevoked(revoked);
    return { status: 'password_reset' as const };
  }

  /** Смена пароля; без текущего пароля — только первичная установка после свежего входа. */
  async changePassword(
    principal: Principal,
    input: { currentPassword?: string | undefined; newPassword: string; code?: string | undefined },
    meta: RequestMeta,
  ) {
    const account = await this.auth.accountOf(principal);
    if (account.passwordHash) {
      if (
        input.currentPassword === undefined ||
        !(await this.id.deps.hasher.verify(account.passwordHash, input.currentPassword))
      ) {
        throw new IdentityError('AUTH_INVALID_CREDENTIALS', 'неверный текущий пароль');
      }
      if (await this.id.deps.hasher.verify(account.passwordHash, input.newPassword)) {
        throw new IdentityError('SEC_PASSWORD_SAME_AS_CURRENT', 'новый пароль совпадает с текущим');
      }
    } else {
      await this.auth.requireFresh(principal);
    }
    this.policy(input.newPassword, account.email);
    const passwordHash = await this.id.deps.hasher.hash(input.newPassword);
    const revoked = await this.id.store.transaction(async (store) => {
      await this.tfa.requireCode(store, account.id, input.code);
      await store.updateAccount(account.id, { passwordHash, updatedAt: this.id.now() });
      const ids = await this.auth.revokeAll(
        store,
        account.id,
        'password_changed',
        principal.sessionId,
      );
      await this.id.securityEvent(store, account.id, 'password_changed', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(account.email, 'пароль изменён', 'Пароль изменён; остальные сессии завершены.'),
      );
      return ids;
    });
    await this.id.markRevoked(revoked);
    return { revoked: revoked.length };
  }

  async requestEmailChange(
    principal: Principal,
    input: { newEmail: string; password: string; code?: string | undefined },
    meta: RequestMeta,
  ) {
    const account = await this.auth.requireFresh(principal, input.password);
    const email = canonicalEmail(input.newEmail);
    if (!email) throw new IdentityError('REG_INVALID_EMAIL', 'некорректный адрес');
    if (this.id.settings.blockedEmailDomains.includes(email.slice(email.indexOf('@') + 1))) {
      throw new IdentityError('REG_EMAIL_DOMAIN_BLOCKED', 'почтовый домен запрещён');
    }
    await this.id.store.transaction(async (store) => {
      await this.tfa.requireCode(store, account.id, input.code);
      const taken = await store.findAccountByEmail(email);
      if (taken) {
        if (taken.id !== account.id) await this.id.email(store, MAIL.emailTaken(email));
        return;
      }
      const token = await this.id.emailToken(
        store,
        account.id,
        'change',
        LIMITS.emailChangeTtl,
        email,
      );
      await this.id.email(store, MAIL.emailChange(email, this.id.link('/confirm-email', token)));
      await this.id.email(store, MAIL.emailChangeWarning(account.email));
      await this.id.securityEvent(store, account.id, 'email_change_requested', 'success', meta);
    });
    return ACCEPTED;
  }

  async confirmEmailChange(token: string, meta: RequestMeta) {
    const record = await this.id.store.findEmailToken(sha256Hex(token));
    if (!record || record.purpose !== 'change' || record.usedAt !== null || !record.newEmail) {
      throw new IdentityError('SEC_EMAIL_CHANGE_TOKEN_INVALID', 'токен недействителен');
    }
    if (record.expiresAt <= this.id.now()) {
      throw new IdentityError('SEC_EMAIL_CHANGE_TOKEN_EXPIRED', 'срок токена истёк');
    }
    const newEmail = record.newEmail;
    const result = await this.id.store.transaction(async (store) => {
      const account = await store.findAccount(record.accountId);
      if (!account || !(await store.markEmailTokenUsed(record.id, this.id.now()))) {
        throw new IdentityError('SEC_EMAIL_CHANGE_TOKEN_INVALID', 'токен недействителен');
      }
      if (await store.findAccountByEmail(newEmail)) {
        throw new IdentityError('SEC_EMAIL_CHANGE_TOKEN_INVALID', 'адрес уже занят');
      }
      await store.updateAccount(account.id, { email: newEmail, updatedAt: this.id.now() });
      // Текущей сессии у подтверждения по ссылке нет: завершаются все сессии.
      const ids = await this.auth.revokeAll(store, account.id, 'email_changed');
      await this.id.securityEvent(store, account.id, 'email_changed', 'success', meta);
      for (const to of [account.email, newEmail]) {
        await this.id.email(
          store,
          MAIL.notice(to, 'адрес изменён', `Адрес аккаунта изменён на ${newEmail}.`),
        );
      }
      return ids;
    });
    await this.id.markRevoked(result);
    return { status: 'email_changed' as const };
  }

  async events(principal: Principal, limit = 50, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new IdentityError('SEC_VALIDATION_FAILED', 'limit от 1 до 100');
    }
    const page = await this.id.store.listSecurityEvents(principal.accountId, {
      limit,
      cursor,
      since: this.id.now() - LIMITS.historyDays * DAY,
    });
    return {
      items: page.items.map((e) => ({
        id: e.id,
        type: e.type,
        outcome: e.outcome,
        reasonCode: e.reasonCode,
        ip: e.ip,
        userAgent: e.userAgent,
        at: this.id.iso(e.at),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Повторное подтверждение личности паролем или кодом 2FA. */
  async reauth(
    principal: Principal,
    input: { password?: string | undefined; code?: string | undefined },
  ) {
    const account = await this.auth.accountOf(principal);
    if (input.password !== undefined) {
      await this.auth.requireFresh(principal, input.password);
      return { status: 'reauthenticated' as const };
    }
    if (input.code === undefined)
      throw new IdentityError('AUTH_REAUTH_REQUIRED', 'нужен пароль или код');
    const totp = await this.id.store.getTotp(account.id);
    if (totp?.status !== 'enabled') throw new IdentityError('TFA_NOT_ENABLED', '2FA не включена');
    await this.id.store.transaction(async (store) => {
      await this.tfa.requireCode(store, account.id, input.code);
      await store.updateSession(principal.sessionId, { reauthAt: this.id.now() });
    });
    return { status: 'reauthenticated' as const };
  }
}
