import { expect } from 'vitest';
import type { AccessLevel } from '@duskmarch/domain';
import {
  createIdentityServices,
  OutboxDispatcher,
  type IdentityError,
  type IssuedSession,
  type RequestMeta,
} from '../core/index.js';
import { KeyRing } from '../crypto/jwt.js';
import { PasswordHasher } from '../crypto/password.js';
import { systemEntropy } from '../crypto/random.js';
import { SecretBox } from '../crypto/secret-box.js';
import { totpAt, base32Decode } from '../crypto/totp.js';
import { MemoryKeyValue } from '../memory/key-value.js';
import { MemoryIdentityStore } from '../memory/store.js';
import { MemoryEvents, MemoryMailbox } from '../memory/transports.js';
import type { OAuthClient } from '../core/oauth.js';

export const PASSWORD = 'сумеречный рубеж 2026';
export const META: RequestMeta = {
  ip: '198.51.100.5',
  userAgent: 'Duskmarch-Test/1.0',
  origin: 'http://localhost:5273',
};
export const START = Date.UTC(2026, 10, 26, 12, 0, 0);

/** Часы стенда (test-kit разрешён только в *.test.ts). */
export class TestClock {
  private ms = START;

  utc(): number {
    return this.ms;
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}

/** Стенд сервисов identity в памяти на `FakeClock`. */
export function harness(
  options: {
    fetch?: typeof fetch;
    clients?: Partial<Record<'discord' | 'google', OAuthClient>>;
  } = {},
) {
  const clock = new TestClock();
  const store = new MemoryIdentityStore();
  const kv = new MemoryKeyValue(clock);
  const mail = new MemoryMailbox();
  const events = new MemoryEvents();
  const challenge = {
    required: false,
    verify: async (token: string | undefined) => !challenge.required || token === 'human',
  };
  const services = createIdentityServices(
    {
      store,
      kv,
      clock,
      entropy: systemEntropy,
      hasher: new PasswordHasher({ memoryKiB: 1024, timeCost: 1 }),
      keys: KeyRing.generate('test'),
      box: new SecretBox({ '1': Buffer.alloc(32, 1) }, '1', systemEntropy),
      challenge,
      settings: {
        issuer: 'duskmarch',
        audience: 'duskmarch-api',
        publicUrl: 'http://localhost:5273',
        trustedOrigins: ['http://localhost:5273'],
        tosVersion: '2026-11-01',
        privacyVersion: '2026-11-01',
        blockedEmailDomains: ['trash.example'],
        backupCodePepper: 'pepper',
      },
    },
    {
      redirectBaseUrl: 'http://localhost:3001',
      clients: options.clients ?? {},
      fetch: options.fetch ?? (async () => new Response('{}', { status: 500 })),
    },
  );
  const outbox = new OutboxDispatcher(store, mail, events, clock);
  const docs = { tosAccepted: true, tosVersion: '2026-11-01', privacyVersion: '2026-11-01' };

  /** Доставляет outbox. */
  const flush = async () => {
    await outbox.runOnce();
  };

  /** Зарегистрированный и подтверждённый аккаунт. */
  let seeded = 0;
  const activeAccount = async (email: string, level: AccessLevel = 'player') => {
    // Свой адрес на каждую регистрацию стенда: лимит IP проверяют отдельные тесты.
    const ip = `192.0.2.${seeded++ % 250}`;
    await services.registration.register({ email, password: PASSWORD, ...docs }, { ...META, ip });
    await flush();
    await services.registration.verify(mail.lastToken(email) ?? '');
    const account = await store.findAccountByEmail(email);
    if (!account) throw new Error('аккаунт не создан');
    if (level !== 'player') {
      await store.updateAccount(account.id, { accessLevel: level, effectiveLevel: level });
    }
    return { ...account, accessLevel: level, effectiveLevel: level };
  };

  /** Включает 2FA; возвращает функцию свежего кода и резервные коды. */
  const enableTfa = async (session: { accessToken: string }) => {
    const principal = await services.auth.authenticate(session.accessToken, true);
    const setup = await services.tfa.setup(principal);
    const secret = base32Decode(setup.manualKey);
    const confirmed = await services.tfa.confirm(
      principal,
      setup.setupToken,
      totpAt(secret, clock.utc()),
      META,
    );
    clock.advance(30_000);
    return {
      code: () => totpAt(secret, clock.utc()),
      backupCodes: confirmed.backupCodes,
      session: confirmed.session,
    };
  };

  /** Сессия сотрудника с включённой 2FA. */
  const staffSession = async (email: string, level: AccessLevel) => {
    await activeAccount(email, level);
    const first = await services.auth.login(email, PASSWORD, META);
    if (first.status !== 'staff_2fa_setup_required') throw new Error(first.status);
    const tfa = await enableTfa(first);
    const principal = await services.auth.authenticate(tfa.session.accessToken);
    return { ...tfa, principal, account: (await store.findAccountByEmail(email))! };
  };

  const login = async (email: string, password = PASSWORD, meta = META) => {
    const result = await services.auth.login(email, password, meta);
    if (result.status !== 'authenticated') throw new Error(result.status);
    return result as IssuedSession;
  };

  return {
    ...services,
    clock,
    store,
    kv,
    mail,
    events,
    challenge,
    outbox,
    docs,
    flush,
    activeAccount,
    enableTfa,
    staffSession,
    login,
  };
}

export type Harness = ReturnType<typeof harness>;

/** Ожидает ошибку identity с кодом. */
export async function rejects(
  promise: Promise<unknown>,
  code: string,
  status?: number,
): Promise<IdentityError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toMatchObject({ name: 'IdentityError', code });
    if (status !== undefined) expect((error as IdentityError).status).toBe(status);
    return error as IdentityError;
  }
  throw new Error(`ожидалась ошибка ${code}`);
}
