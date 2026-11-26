import {
  TEMP_BAN_MAX_MS,
  canActOn,
  canAssign,
  canSetEffective,
  evaluateAccess,
  isAccessLevel,
  type AccessLevel,
  type Permission,
} from '@duskmarch/domain';
import type { AccountRecord, IdentityStore } from '../ports.js';
import type { AuthService, Principal } from './auth.js';
import { DAY, Identity, LIMITS, bannedKey, type RequestMeta } from './context.js';
import { IdentityError } from './errors.js';
import { MAIL } from './mail-templates.js';
import type { TwoFactorService } from './two-factor.js';

/** Срок ключа постоянного бана в кэше; источник истины — БД. */
const PERMANENT_BAN_CACHE_MS = 400 * DAY;

/** identity/access-levels и баны персонала. */
export class StaffService {
  constructor(
    private readonly id: Identity,
    private readonly auth: AuthService,
    private readonly tfa: TwoFactorService,
  ) {}

  /** Проверка разрешения; отказ пишется в аудит. */
  async authorize(
    principal: Principal,
    permission: Permission,
    action: string,
    meta: RequestMeta,
  ): Promise<AccountRecord> {
    const account = await this.auth.accountOf(principal);
    const banned = (await this.id.store.activeBan(account.id, this.id.now())) !== null;
    const decision = evaluateAccess(
      {
        maxLevel: account.accessLevel,
        effectiveLevel: account.accessLevel,
        mfa: principal.mfa,
        banned,
      },
      permission,
    );
    if (decision.allowed) return account;
    await this.id.store.transaction((store) =>
      this.id.audit(
        store,
        {
          actorId: account.id,
          targetId: null,
          action,
          outcome: 'denied',
          before: null,
          after: { permission, reason: decision.reason },
          reason: null,
        },
        meta,
      ),
    );
    if (decision.reason === 'mfa_required') {
      throw new IdentityError('TFA_SETUP_REQUIRED', 'нужен второй фактор');
    }
    if (decision.reason === 'banned')
      throw new IdentityError('SEC_ACCOUNT_BANNED', 'аккаунт заблокирован');
    throw new IdentityError('RBAC_INSUFFICIENT_PERMISSION', `нет разрешения ${permission}`);
  }

  private async target(store: IdentityStore, actor: AccountRecord, targetId: string) {
    const target = await store.findAccount(targetId);
    if (!target || target.status === 'expired') {
      throw new IdentityError('SEC_ACCOUNT_NOT_FOUND', 'аккаунт не найден');
    }
    if (!canActOn(actor.accessLevel, target.accessLevel)) {
      throw new IdentityError('RBAC_HIERARCHY_VIOLATION', 'цель не младше исполнителя');
    }
    return target;
  }

  private reason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.length < LIMITS.banReasonMin || trimmed.length > LIMITS.banReasonMax) {
      throw new IdentityError('SEC_BAN_REASON_INVALID', 'причина от 10 до 1000 символов');
    }
    return trimmed;
  }

  /** Отзывает все сессии цели и кладёт их в список немедленного отзыва. */
  private async kick(store: IdentityStore, accountId: string, reason: string) {
    return this.auth.revokeAll(store, accountId, reason);
  }

  async inspect(principal: Principal, targetId: string, meta: RequestMeta) {
    await this.authorize(principal, 'account.inspect', 'account.inspect', meta);
    const target = await this.id.store.findAccount(targetId);
    if (!target) throw new IdentityError('SEC_ACCOUNT_NOT_FOUND', 'аккаунт не найден');
    const now = this.id.now();
    const ban = await this.id.store.activeBan(target.id, now);
    const totp = await this.id.store.getTotp(target.id);
    return {
      id: target.id,
      email: target.email,
      status: target.status,
      accessLevel: target.accessLevel,
      effectiveLevel: target.effectiveLevel,
      emailVerifiedAt: target.emailVerifiedAt === null ? null : this.id.iso(target.emailVerifiedAt),
      createdAt: this.id.iso(target.createdAt),
      tfaEnabled: totp?.status === 'enabled',
      activeSessions: (await this.id.store.listActiveSessions(target.id, now)).length,
      oauthProviders: (await this.id.store.listOAuth(target.id)).map((o) => o.provider),
      ban: ban && {
        id: ban.id,
        reason: ban.reason,
        expiresAt: ban.expiresAt === null ? null : this.id.iso(ban.expiresAt),
      },
    };
  }

  async ban(
    principal: Principal,
    targetId: string,
    input: { reason: string; expiresAt?: string | undefined },
    meta: RequestMeta,
  ) {
    const actor = await this.authorize(principal, 'account.ban.temp', 'account.ban', meta);
    const reason = this.reason(input.reason);
    const now = this.id.now();
    const expiresAt = input.expiresAt === undefined ? null : Date.parse(input.expiresAt);
    if (expiresAt !== null && (Number.isNaN(expiresAt) || expiresAt <= now)) {
      throw new IdentityError('SEC_VALIDATION_FAILED', 'срок бана в прошлом');
    }
    if (expiresAt === null || expiresAt - now > TEMP_BAN_MAX_MS) {
      await this.authorize(principal, 'account.ban.permanent', 'account.ban', meta);
    }
    const banId = this.id.id();
    const revoked = await this.id.store.transaction(async (store) => {
      // Владельца забанить нельзя: над ним нет старшего уровня (canActOn).
      const target = await this.target(store, actor, targetId);
      await store.insertBan({
        id: banId,
        accountId: target.id,
        issuedBy: actor.id,
        reason,
        createdAt: now,
        expiresAt,
        liftedAt: null,
        liftedBy: null,
        liftReason: null,
      });
      const ids = await this.kick(store, target.id, 'banned');
      await this.id.event(store, 'identity.account.banned', {
        accountId: target.id,
        banId,
        reason,
        expiresAt: expiresAt === null ? null : this.id.iso(expiresAt),
      });
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: target.id,
          action: 'account.ban',
          outcome: 'allowed',
          before: null,
          after: { banId, expiresAt },
          reason,
        },
        meta,
      );
      await this.id.securityEvent(store, target.id, 'banned', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(
          target.email,
          'аккаунт заблокирован',
          `Причина: ${reason}\nСрок: ${expiresAt === null ? 'бессрочно' : `до ${this.id.iso(expiresAt)} UTC`}.`,
        ),
      );
      return ids;
    });
    await this.id.markRevoked(revoked);
    await this.id.kv.set(
      bannedKey(targetId),
      banId,
      expiresAt === null ? PERMANENT_BAN_CACHE_MS : expiresAt - now,
    );
    return { banId, revokedSessions: revoked.length };
  }

  async lift(principal: Principal, banId: string, rawReason: string, meta: RequestMeta) {
    const actor = await this.authorize(principal, 'account.unban', 'account.unban', meta);
    const reason = this.reason(rawReason);
    const ban = await this.id.store.findBan(banId);
    if (!ban || ban.liftedAt !== null)
      throw new IdentityError('SEC_BAN_NOT_FOUND', 'бан не найден');
    await this.id.store.transaction(async (store) => {
      const target = await this.target(store, actor, ban.accountId);
      await store.updateBan(ban.id, {
        liftedAt: this.id.now(),
        liftedBy: actor.id,
        liftReason: reason,
      });
      await this.id.event(store, 'identity.account.unbanned', { accountId: target.id, banId });
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: target.id,
          action: 'account.unban',
          outcome: 'allowed',
          before: { banId },
          after: null,
          reason,
        },
        meta,
      );
      await this.id.email(
        store,
        MAIL.notice(
          target.email,
          'блокировка снята',
          `Блокировка снята досрочно. Причина: ${reason}`,
        ),
      );
    });
    if ((await this.id.store.activeBan(ban.accountId, this.id.now())) === null) {
      await this.id.kv.del(bannedKey(ban.accountId));
    }
  }

  async revokeSessions(principal: Principal, targetId: string, meta: RequestMeta) {
    const actor = await this.authorize(
      principal,
      'account.sessions.revoke',
      'account.sessions.revoke',
      meta,
    );
    const ids = await this.id.store.transaction(async (store) => {
      const target = await this.target(store, actor, targetId);
      const revoked = await this.kick(store, target.id, 'staff_revoke');
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: target.id,
          action: 'account.sessions.revoke',
          outcome: 'allowed',
          before: null,
          after: { revoked: revoked.length },
          reason: null,
        },
        meta,
      );
      return revoked;
    });
    await this.id.markRevoked(ids);
    return { revoked: ids.length };
  }

  async resetTwoFactor(
    principal: Principal,
    targetId: string,
    rawReason: string,
    meta: RequestMeta,
  ) {
    const actor = await this.authorize(principal, 'account.tfa.reset', 'account.tfa.reset', meta);
    const reason = this.reason(rawReason);
    const ids = await this.id.store.transaction(async (store) => {
      const target = await this.target(store, actor, targetId);
      await this.tfa.remove(store, target);
      const revoked = await this.kick(store, target.id, 'tfa_reset');
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: target.id,
          action: 'account.tfa.reset',
          outcome: 'allowed',
          before: null,
          after: null,
          reason,
        },
        meta,
      );
      await this.id.securityEvent(store, target.id, 'tfa_reset', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(target.email, '2FA сброшена', `2FA сброшена персоналом. Причина: ${reason}`),
      );
      return revoked;
    });
    await this.id.markRevoked(ids);
  }

  /** После операции у шарда должен остаться активный незаблокированный владелец. */
  private async assertOwnerRemains(store: IdentityStore, leavingId: string) {
    await store.lockOwners();
    const now = this.id.now();
    let others = 0;
    for (const owner of await store.listAccountsByLevel('owner')) {
      if (
        owner.id !== leavingId &&
        owner.status === 'active' &&
        !(await store.activeBan(owner.id, now))
      ) {
        others++;
      }
    }
    if (others === 0)
      throw new IdentityError('RBAC_LAST_OWNER', 'нельзя оставить шард без владельца');
  }

  async changeLevel(
    principal: Principal,
    targetId: string,
    input: { level: string; reason: string; code: string },
    meta: RequestMeta,
  ) {
    const actor = await this.authorize(
      principal,
      'account.access.assign',
      'access_level.change',
      meta,
    );
    if (!isAccessLevel(input.level)) {
      throw new IdentityError('RBAC_UNKNOWN_ACCESS_LEVEL', `неизвестный уровень ${input.level}`);
    }
    const next: AccessLevel = input.level;
    const reason = this.reason(input.reason);
    const result = await this.id.store.transaction(async (store) => {
      await this.tfa.requireCode(store, actor.id, input.code);
      const target = await store.findAccount(targetId);
      if (!target || target.status === 'expired') {
        throw new IdentityError('SEC_ACCOUNT_NOT_FOUND', 'аккаунт не найден');
      }
      if (!canAssign(actor.accessLevel, target.accessLevel, next)) {
        throw new IdentityError('RBAC_HIERARCHY_VIOLATION', 'уровень вне полномочий');
      }
      if (target.accessLevel === 'owner' && next !== 'owner')
        await this.assertOwnerRemains(store, target.id);
      const previous = target.accessLevel;
      await store.updateAccount(target.id, {
        accessLevel: next,
        effectiveLevel: next,
        updatedAt: this.id.now(),
      });
      const revoked = await this.kick(store, target.id, 'access_level_changed');
      await this.id.event(store, 'identity.account.access_level_changed', {
        accountId: target.id,
        previousLevel: previous,
        newLevel: next,
        changedBy: actor.id,
      });
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: target.id,
          action: 'access_level.change',
          outcome: 'allowed',
          before: { level: previous },
          after: { level: next },
          reason,
        },
        meta,
      );
      return { previous, revoked };
    });
    await this.id.markRevoked(result.revoked);
    return { previousLevel: result.previous, newLevel: next };
  }

  async setEffective(principal: Principal, level: string, meta: RequestMeta) {
    const account = await this.auth.accountOf(principal);
    if (!isAccessLevel(level))
      throw new IdentityError('RBAC_UNKNOWN_ACCESS_LEVEL', `неизвестный уровень ${level}`);
    if (account.accessLevel === 'player' || !canSetEffective(account.accessLevel, level)) {
      throw new IdentityError('RBAC_HIERARCHY_VIOLATION', 'выше назначенного уровня');
    }
    if (!principal.mfa) throw new IdentityError('TFA_SETUP_REQUIRED', 'нужен второй фактор');
    await this.id.store.transaction(async (store) => {
      await store.updateAccount(account.id, { effectiveLevel: level, updatedAt: this.id.now() });
      await this.id.event(store, 'identity.account.effective_level_changed', {
        accountId: account.id,
        maxLevel: account.accessLevel,
        effectiveLevel: level,
      });
      await this.id.audit(
        store,
        {
          actorId: account.id,
          targetId: account.id,
          action: 'effective_level.change',
          outcome: 'allowed',
          before: { level: account.effectiveLevel },
          after: { level },
          reason: null,
        },
        meta,
      );
    });
    return { maxLevel: account.accessLevel, effectiveLevel: level };
  }

  async auditLog(principal: Principal, meta: RequestMeta, limit = 50, cursor?: string) {
    await this.authorize(principal, 'audit.read', 'audit.read', meta);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new IdentityError('SEC_VALIDATION_FAILED', 'limit от 1 до 100');
    }
    const page = await this.id.store.listAudit({ limit, cursor });
    return {
      items: page.items.map((a) => ({ ...a, at: this.id.iso(a.at) })),
      nextCursor: page.nextCursor,
    };
  }
}
