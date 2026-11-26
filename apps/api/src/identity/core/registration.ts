import { passwordViolations } from '../crypto/password.js';
import { sha256Hex } from '../crypto/random.js';
import { domainOf, canonicalEmail } from './email.js';
import { Identity, LIMITS, MINUTE, DAY, type RequestMeta } from './context.js';
import { IdentityError } from './errors.js';
import { MAIL } from './mail-templates.js';
import { hit } from './rate-limit.js';

export interface RegisterInput {
  email: string;
  password: string;
  tosAccepted: boolean;
  tosVersion?: string | undefined;
  privacyVersion?: string | undefined;
  challengeToken?: string | undefined;
}

const ACCEPTED = { status: 'verification_required' } as const;

/** identity/account-registration. */
export class RegistrationService {
  constructor(private readonly id: Identity) {}

  documents() {
    return {
      tosVersion: this.id.settings.tosVersion,
      privacyVersion: this.id.settings.privacyVersion,
    };
  }

  private async limitIp(meta: RequestMeta): Promise<void> {
    const now = this.id.now();
    for (const [key, window, max] of [
      [`reg15:${meta.ip}`, 15 * MINUTE, LIMITS.registerPer15m],
      [`reg24:${meta.ip}`, DAY, LIMITS.registerPerDay],
    ] as const) {
      const state = await hit(this.id.kv, key, window, now);
      if (state.count > max) {
        throw new IdentityError('REG_RATE_LIMITED', 'слишком много регистраций с адреса', {
          retryAfterS: state.retryAfterS,
        });
      }
    }
  }

  /** Проверяет данные формы; бросает ошибку политики. */
  validate(input: RegisterInput): string {
    const email = canonicalEmail(input.email);
    if (!email) throw new IdentityError('REG_INVALID_EMAIL', 'некорректный адрес');
    if (this.id.settings.blockedEmailDomains.includes(domainOf(email))) {
      throw new IdentityError('REG_EMAIL_DOMAIN_BLOCKED', 'почтовый домен запрещён');
    }
    const violations = passwordViolations(input.password, email);
    if (violations.length > 0) {
      throw new IdentityError('REG_WEAK_PASSWORD', 'пароль не соответствует политике', {
        details: { violations },
      });
    }
    this.checkDocuments(input);
    return email;
  }

  checkDocuments(input: Pick<RegisterInput, 'tosAccepted' | 'tosVersion' | 'privacyVersion'>) {
    if (!input.tosAccepted || !input.tosVersion || !input.privacyVersion) {
      throw new IdentityError('REG_TOS_NOT_ACCEPTED', 'нужно принять условия');
    }
    const current = this.documents();
    if (
      input.tosVersion !== current.tosVersion ||
      input.privacyVersion !== current.privacyVersion
    ) {
      throw new IdentityError('REG_TOS_VERSION_OUTDATED', 'версии документов устарели', {
        details: current,
      });
    }
  }

  /** Кулдаун и суточный лимит писем подтверждения на адрес; `false` — письмо не отправлять. */
  private async allowVerifyMail(email: string, strict: boolean): Promise<boolean> {
    const hash = sha256Hex(email);
    const now = this.id.now();
    const cooldownKey = `identity:cooldown:verify:${hash}`;
    const left = await this.id.kv.ttl(cooldownKey);
    if (left > 0) {
      if (!strict) return false;
      throw new IdentityError('REG_RESEND_RATE_LIMITED', 'письмо уже отправлено', {
        retryAfterS: Math.ceil(left / 1000),
      });
    }
    const day = await hit(this.id.kv, `verify-day:${hash}`, DAY, now);
    if (day.count > LIMITS.resendPerDay) {
      if (!strict) return false;
      throw new IdentityError('REG_RESEND_RATE_LIMITED', 'лимит писем на сутки', {
        retryAfterS: day.retryAfterS,
      });
    }
    await this.id.kv.set(cooldownKey, '1', LIMITS.resendCooldown);
    return true;
  }

  async register(input: RegisterInput, meta: RequestMeta) {
    await this.limitIp(meta);
    if (!(await this.id.deps.challenge.verify(input.challengeToken, meta.ip))) {
      throw new IdentityError('REG_CHALLENGE_FAILED', 'антибот-проверка не пройдена');
    }
    const email = this.validate(input);
    // Хэш вычисляется всегда: время ответа не зависит от существования адреса.
    const passwordHash = await this.id.deps.hasher.hash(input.password);
    const existing = await this.id.store.findAccountByEmail(email);
    const now = this.id.now();
    const tos = {
      tosVersion: input.tosVersion as string,
      privacyVersion: input.privacyVersion as string,
      ip: meta.ip,
      userAgent: meta.userAgent,
      acceptedAt: now,
    };
    if (existing?.status === 'active') {
      if (await this.allowVerifyMail(email, false)) {
        await this.id.store.transaction(async (store) => {
          const token = await this.id.emailToken(store, existing.id, 'reset', LIMITS.resetTokenTtl);
          await this.id.email(
            store,
            MAIL.registrationAttempt(email, this.id.link('/reset-password', token)),
          );
        });
      }
      return ACCEPTED;
    }
    if (existing) {
      if (!(await this.allowVerifyMail(email, false))) return ACCEPTED;
      await this.id.store.transaction(async (store) => {
        await store.updateAccount(existing.id, { passwordHash, updatedAt: now });
        await store.insertTos({ id: this.id.id(), accountId: existing.id, ...tos });
        const token = await this.id.emailToken(store, existing.id, 'verify', LIMITS.verifyTokenTtl);
        await this.id.email(store, MAIL.verify(email, this.id.link('/verify-email', token)));
      });
      return ACCEPTED;
    }
    await this.allowVerifyMail(email, false);
    await this.id.store.transaction(async (store) => {
      const accountId = this.id.id();
      await store.insertAccount({
        id: accountId,
        email,
        passwordHash,
        status: 'pending_verification',
        accessLevel: 'player',
        effectiveLevel: 'player',
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await store.insertTos({ id: this.id.id(), accountId, ...tos });
      const token = await this.id.emailToken(store, accountId, 'verify', LIMITS.verifyTokenTtl);
      await this.id.email(store, MAIL.verify(email, this.id.link('/verify-email', token)));
    });
    return ACCEPTED;
  }

  async resend(rawEmail: string, meta: RequestMeta) {
    const ip = await hit(this.id.kv, `resend-ip:${meta.ip}`, 15 * MINUTE, this.id.now());
    if (ip.count > 15) {
      throw new IdentityError('REG_RATE_LIMITED', 'слишком много запросов', {
        retryAfterS: ip.retryAfterS,
      });
    }
    const email = canonicalEmail(rawEmail);
    if (!email) throw new IdentityError('REG_INVALID_EMAIL', 'некорректный адрес');
    // Кулдаун действует для любого адреса: ответ не выдаёт, есть ли аккаунт.
    await this.allowVerifyMail(email, true);
    const account = await this.id.store.findAccountByEmail(email);
    if (account?.status === 'pending_verification') {
      await this.id.store.transaction(async (store) => {
        const token = await this.id.emailToken(store, account.id, 'verify', LIMITS.verifyTokenTtl);
        await this.id.email(store, MAIL.verify(email, this.id.link('/verify-email', token)));
      });
    }
    return ACCEPTED;
  }

  async verify(token: string) {
    const record = await this.id.store.findEmailToken(sha256Hex(token));
    if (!record || record.purpose !== 'verify' || record.usedAt !== null) {
      throw new IdentityError('REG_VERIFICATION_TOKEN_INVALID', 'токен недействителен');
    }
    if (record.expiresAt <= this.id.now()) {
      throw new IdentityError('REG_VERIFICATION_TOKEN_EXPIRED', 'срок токена истёк');
    }
    await this.id.store.transaction(async (store) => {
      const account = await store.findAccount(record.accountId);
      if (
        account?.status !== 'pending_verification' ||
        !(await store.markEmailTokenUsed(record.id, this.id.now()))
      ) {
        throw new IdentityError('REG_VERIFICATION_TOKEN_INVALID', 'токен недействителен');
      }
      await store.updateAccount(account.id, {
        status: 'active',
        emailVerifiedAt: this.id.now(),
        updatedAt: this.id.now(),
      });
    });
    return { status: 'verified' as const };
  }

  /** Фоновая очистка: неподтверждённые старше 7 суток освобождают адрес. */
  cleanup(): Promise<string[]> {
    const now = this.id.now();
    return this.id.store.expirePending(now - LIMITS.pendingTtl, now);
  }
}
