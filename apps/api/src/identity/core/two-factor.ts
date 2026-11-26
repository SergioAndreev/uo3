import { isStaff } from '@duskmarch/domain';
import {
  BACKUP_CODE_COUNT,
  hashBackupCode,
  looksLikeBackupCode,
  newBackupCode,
} from '../crypto/backup-codes.js';
import { newToken, safeEqual, sha256Hex } from '../crypto/random.js';
import { base32Encode, matchTotp, otpauthUri } from '../crypto/totp.js';
import type { AccountRecord, IdentityStore, TotpRecord } from '../ports.js';
import { mfaKey, type AuthService, type MfaChallenge, type Principal } from './auth.js';
import { Identity, LIMITS, type RequestMeta } from './context.js';
import { IdentityError } from './errors.js';
import { MAIL } from './mail-templates.js';

const aad = (accountId: string) => `dm:totp:v1:${accountId}`;
const attemptsKey = (token: string) => `identity:mfa-attempts:${sha256Hex(token)}`;

type CodeMatch = { kind: 'totp'; step: number } | { kind: 'backup'; id: string } | null;

/** identity/two-factor-auth. */
export class TwoFactorService {
  constructor(
    private readonly id: Identity,
    private readonly auth: AuthService,
  ) {}

  private secretOf(totp: TotpRecord): Buffer {
    return this.id.deps.box.open(totp, aad(totp.accountId));
  }

  /** Сверка кода: TOTP в окне ±1 шаг или, если разрешено, неиспользованный резервный код. */
  private async match(totp: TotpRecord, code: string, allowBackup: boolean): Promise<CodeMatch> {
    if (/^\d{6}$/.test(code)) {
      const step = matchTotp(this.secretOf(totp), code, this.id.now());
      return step === null ? null : { kind: 'totp', step };
    }
    if (!allowBackup || !looksLikeBackupCode(code)) return null;
    const hash = hashBackupCode(this.id.settings.backupCodePepper, totp.accountId, code);
    const codes = await this.id.store.listBackupCodes(totp.accountId);
    let found: string | null = null;
    for (const row of codes) {
      if (safeEqual(row.codeHash, hash) && row.usedAt === null) found = row.id;
    }
    return found === null ? null : { kind: 'backup', id: found };
  }

  /** Применяет совпадение: шаг TOTP только растёт, резервный код одноразовый. */
  private async consume(store: IdentityStore, accountId: string, m: NonNullable<CodeMatch>) {
    if (m.kind === 'totp') {
      if (!(await store.advanceTotpStep(accountId, m.step))) {
        throw new IdentityError('TFA_CODE_REPLAYED', 'код уже использован');
      }
      return;
    }
    if (!(await store.markBackupCodeUsed(m.id, this.id.now()))) {
      throw new IdentityError('TFA_INVALID_CODE', 'резервный код уже использован');
    }
  }

  private async newBackupCodes(store: IdentityStore, accountId: string): Promise<string[]> {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      newBackupCode(this.id.deps.entropy),
    );
    await store.replaceBackupCodes(
      accountId,
      codes.map((code) => ({
        id: this.id.id(),
        accountId,
        codeHash: hashBackupCode(this.id.settings.backupCodePepper, accountId, code),
        usedAt: null,
      })),
    );
    return codes;
  }

  private async enabled(accountId: string): Promise<TotpRecord> {
    const totp = await this.id.store.getTotp(accountId);
    if (totp?.status !== 'enabled') throw new IdentityError('TFA_NOT_ENABLED', '2FA не включена');
    return totp;
  }

  async status(principal: Principal) {
    const totp = await this.id.store.getTotp(principal.accountId);
    const enabled = totp?.status === 'enabled';
    const codes = enabled ? await this.id.store.listBackupCodes(principal.accountId) : [];
    return {
      enabled,
      enabledAt: enabled && totp.enabledAt !== null ? this.id.iso(totp.enabledAt) : null,
      remainingBackupCodes: codes.filter((c) => c.usedAt === null).length,
    };
  }

  async setup(principal: Principal, password?: string) {
    const account = await this.auth.requireFresh(principal, password);
    const current = await this.id.store.getTotp(account.id);
    if (current?.status === 'enabled')
      throw new IdentityError('TFA_ALREADY_ENABLED', '2FA уже включена');
    const secret = this.id.deps.entropy.bytes(20);
    const setupToken = newToken(this.id.deps.entropy);
    const sealed = this.id.deps.box.seal(secret, aad(account.id));
    await this.id.store.putTotp({
      accountId: account.id,
      status: 'pending',
      ...sealed,
      lastUsedStep: null,
      setupTokenHash: sha256Hex(setupToken),
      setupExpiresAt: this.id.now() + LIMITS.totpSetupTtl,
      enabledAt: null,
    });
    const manualKey = base32Encode(secret);
    return { setupToken, otpauthUri: otpauthUri('Duskmarch', account.email, manualKey), manualKey };
  }

  async confirm(principal: Principal, setupToken: string, code: string, meta: RequestMeta) {
    const account = await this.auth.accountOf(principal);
    const totp = await this.id.store.getTotp(account.id);
    if (
      totp?.status !== 'pending' ||
      totp.setupTokenHash === null ||
      !safeEqual(totp.setupTokenHash, sha256Hex(setupToken)) ||
      (totp.setupExpiresAt ?? 0) <= this.id.now()
    ) {
      throw new IdentityError('TFA_SETUP_EXPIRED', 'настройка 2FA истекла или не начата');
    }
    const step = matchTotp(this.secretOf(totp), code, this.id.now());
    if (step === null) throw new IdentityError('TFA_INVALID_CODE', 'неверный код', { status: 400 });
    const { codes, revoked } = await this.id.store.transaction(async (store) => {
      await store.putTotp({
        ...totp,
        status: 'enabled',
        lastUsedStep: step,
        setupTokenHash: null,
        setupExpiresAt: null,
        enabledAt: this.id.now(),
      });
      const backup = await this.newBackupCodes(store, account.id);
      const others = await this.auth.revokeAll(
        store,
        account.id,
        'tfa_enabled',
        principal.sessionId,
      );
      await this.id.securityEvent(store, account.id, 'tfa_enabled', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(
          account.email,
          '2FA включена',
          'Для входа теперь нужен код из приложения или резервный код.',
        ),
      );
      return { codes: backup, revoked: others };
    });
    await this.id.markRevoked(revoked);
    const session = await this.auth.upgradeSession(principal, principal.setupOnly);
    return { backupCodes: codes, session };
  }

  /** Второй шаг входа по `mfaChallengeToken`. */
  async verifyChallenge(token: string, code: string, meta: RequestMeta) {
    const raw = await this.id.kv.get(mfaKey(token));
    if (!raw) throw new IdentityError('TFA_CHALLENGE_EXPIRED', 'challenge истёк');
    const challenge = JSON.parse(raw) as MfaChallenge;
    const account = await this.id.store.findAccount(challenge.accountId);
    const totp = account ? await this.id.store.getTotp(account.id) : null;
    const failure = async (error: IdentityError): Promise<never> => {
      const attempts = await this.id.kv.incr(attemptsKey(token), LIMITS.mfaChallengeTtl);
      if (attempts >= LIMITS.mfaAttempts) {
        await this.id.kv.del(mfaKey(token));
        await this.id.store.transaction((store) =>
          this.id.securityEvent(
            store,
            challenge.accountId,
            'mfa_exhausted',
            'failure',
            meta,
            'TFA_CHALLENGE_EXHAUSTED',
          ),
        );
        throw new IdentityError('TFA_CHALLENGE_EXHAUSTED', 'исчерпаны попытки');
      }
      throw error;
    };
    if (!account || totp?.status !== 'enabled') {
      return failure(new IdentityError('TFA_INVALID_CODE', 'неверный код'));
    }
    const found = await this.match(totp, code, true);
    if (!found) return failure(new IdentityError('TFA_INVALID_CODE', 'неверный код'));
    try {
      await this.id.store.transaction((store) => this.consume(store, account.id, found));
    } catch (error) {
      if (error instanceof IdentityError) return failure(error);
      throw error;
    }
    if ((await this.id.kv.take(mfaKey(token))) === null) {
      throw new IdentityError('TFA_CHALLENGE_EXPIRED', 'challenge уже использован');
    }
    await this.auth.assertNotBanned(this.id.store, account.id);
    if (found.kind === 'backup') {
      const left = (await this.id.store.listBackupCodes(account.id)).filter(
        (c) => c.usedAt === null,
      );
      await this.id.store.transaction((store) =>
        this.id.email(
          store,
          MAIL.notice(
            account.email,
            'использован резервный код',
            `Осталось резервных кодов: ${left.length}.`,
          ),
        ),
      );
    }
    return this.auth.issue(account, meta, true);
  }

  async regenerateBackupCodes(
    principal: Principal,
    code: string,
    password: string | undefined,
    meta: RequestMeta,
  ) {
    const account = await this.auth.requireFresh(principal, password);
    const totp = await this.enabled(account.id);
    const found = await this.match(totp, code, false);
    if (!found) throw new IdentityError('TFA_INVALID_CODE', 'нужен актуальный код из приложения');
    const codes = await this.id.store.transaction(async (store) => {
      await this.consume(store, account.id, found);
      const fresh = await this.newBackupCodes(store, account.id);
      await this.id.securityEvent(store, account.id, 'backup_codes_regenerated', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(
          account.email,
          'новые резервные коды',
          'Прежние резервные коды больше не действуют.',
        ),
      );
      return fresh;
    });
    return { backupCodes: codes };
  }

  /** Удаляет 2FA аккаунта в транзакции (общая часть отключения и сброса). */
  async remove(store: IdentityStore, account: AccountRecord): Promise<void> {
    await store.deleteTotp(account.id);
    await store.replaceBackupCodes(account.id, []);
  }

  async disable(
    principal: Principal,
    code: string,
    password: string | undefined,
    meta: RequestMeta,
  ) {
    const account = await this.auth.accountOf(principal);
    if (isStaff(account.accessLevel)) {
      throw new IdentityError('TFA_REQUIRED_FOR_STAFF', 'персонал не может отключить 2FA');
    }
    await this.auth.requireFresh(principal, password);
    const totp = await this.enabled(account.id);
    const found = await this.match(totp, code, true);
    if (!found) throw new IdentityError('TFA_INVALID_CODE', 'неверный код');
    const revoked = await this.id.store.transaction(async (store) => {
      await this.consume(store, account.id, found);
      await this.remove(store, account);
      const others = await this.auth.revokeAll(
        store,
        account.id,
        'tfa_disabled',
        principal.sessionId,
      );
      await this.id.securityEvent(store, account.id, 'tfa_disabled', 'success', meta);
      await this.id.email(
        store,
        MAIL.notice(account.email, '2FA отключена', 'Вход теперь выполняется только по паролю.'),
      );
      return others;
    });
    await this.id.markRevoked(revoked);
  }

  /** Проверка TOTP для чувствительных действий (смена пароля, email, уровня). */
  async requireCode(
    store: IdentityStore,
    accountId: string,
    code: string | undefined,
  ): Promise<void> {
    const totp = await store.getTotp(accountId);
    if (totp?.status !== 'enabled') return;
    const found = code === undefined ? null : await this.match(totp, code, false);
    if (!found) throw new IdentityError('TFA_INVALID_CODE', 'нужен код 2FA');
    await this.consume(store, accountId, found);
  }
}
