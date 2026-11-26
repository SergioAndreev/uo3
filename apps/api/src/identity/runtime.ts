import { randomBytes } from 'node:crypto';
import type { Infra } from '@duskmarch/db/infra';
import type { ApiConfig } from '../platform-config.module.js';
import {
  createIdentityServices,
  OutboxDispatcher,
  PROVIDERS,
  type IdentityServices,
  type OAuthClient,
} from './core/index.js';
import { KeyRing } from './crypto/jwt.js';
import { PasswordHasher } from './crypto/password.js';
import { systemEntropy } from './crypto/random.js';
import { SecretBox } from './crypto/secret-box.js';
import { DrizzleIdentityStore } from './infra/drizzle-store.js';
import { NatsEventPublisher } from './infra/nats-events.js';
import { ValkeyKeyValue } from './infra/valkey-kv.js';
import { LogMailTransport } from './mail/log.js';
import { SmtpTransport } from './mail/smtp.js';
import type { MailTransport } from './ports.js';

export interface IdentityRuntime {
  services: IdentityServices;
  outbox: OutboxDispatcher;
  /** Предупреждения конфигурации разработки. */
  warnings: string[];
  secureCookies: boolean;
}

const placeholder = (value: string | undefined): boolean =>
  value === undefined || value === '' || value.startsWith('CHANGE_ME_');

/** Собирает identity на PostgreSQL, Valkey, NATS и почте из конфигурации. */
export function buildIdentityRuntime(
  config: ApiConfig,
  infra: Pick<Infra, 'db' | 'valkey' | 'nats'>,
): IdentityRuntime {
  const production = config.NODE_ENV === 'production';
  const warnings: string[] = [];
  const devOnly = (name: string): void => {
    if (production) throw new Error(`${name} обязателен в production`);
    warnings.push(`${name} не задан: ключ создан при старте и не переживёт рестарт`);
  };

  let keys: KeyRing;
  if (placeholder(config.IDENTITY_JWT_SIGNING_KEYS_JSON)) {
    devOnly('IDENTITY_JWT_SIGNING_KEYS_JSON');
    keys = KeyRing.generate('dev');
  } else keys = KeyRing.fromJson(config.IDENTITY_JWT_SIGNING_KEYS_JSON as string);

  let box: SecretBox;
  if (placeholder(config.IDENTITY_TOTP_KEYS_JSON)) {
    devOnly('IDENTITY_TOTP_KEYS_JSON');
    box = new SecretBox(
      { [config.IDENTITY_TOTP_KEY_VERSION]: randomBytes(32) },
      config.IDENTITY_TOTP_KEY_VERSION,
      systemEntropy,
    );
  } else {
    box = SecretBox.fromJson(
      config.IDENTITY_TOTP_KEYS_JSON as string,
      config.IDENTITY_TOTP_KEY_VERSION,
      systemEntropy,
    );
  }

  let pepper = config.IDENTITY_BACKUP_CODE_PEPPER;
  if (placeholder(pepper)) {
    devOnly('IDENTITY_BACKUP_CODE_PEPPER');
    pepper = randomBytes(32).toString('base64');
  }

  let mail: MailTransport;
  if (config.MAIL_TRANSPORT === 'smtp') {
    if (!config.MAIL_SMTP_URL) throw new Error('MAIL_TRANSPORT=smtp требует MAIL_SMTP_URL');
    mail = new SmtpTransport({ url: config.MAIL_SMTP_URL, from: config.MAIL_FROM });
  } else {
    if (production) throw new Error('MAIL_TRANSPORT=log запрещён в production');
    mail = new LogMailTransport();
  }

  const clients: Partial<Record<'discord' | 'google', OAuthClient>> = {};
  if (config.OAUTH_DISCORD_CLIENT_ID && config.OAUTH_DISCORD_CLIENT_SECRET) {
    clients.discord = {
      clientId: config.OAUTH_DISCORD_CLIENT_ID,
      clientSecret: config.OAUTH_DISCORD_CLIENT_SECRET,
      endpoints: PROVIDERS.discord,
    };
  }
  if (config.OAUTH_GOOGLE_CLIENT_ID && config.OAUTH_GOOGLE_CLIENT_SECRET) {
    clients.google = {
      clientId: config.OAUTH_GOOGLE_CLIENT_ID,
      clientSecret: config.OAUTH_GOOGLE_CLIENT_SECRET,
      endpoints: PROVIDERS.google,
    };
  }

  const store = new DrizzleIdentityStore(infra.db);
  const clock = { utc: () => Date.now() };
  const services = createIdentityServices(
    {
      store,
      kv: new ValkeyKeyValue(infra.valkey),
      clock,
      entropy: systemEntropy,
      hasher: new PasswordHasher({
        memoryKiB: config.IDENTITY_ARGON2_MEMORY_KIB,
        timeCost: config.IDENTITY_ARGON2_TIME_COST,
      }),
      keys,
      box,
      // Поставщик антибот-проверки не подключён: в режиме required регистрация закрыта.
      challenge: { verify: async () => config.IDENTITY_REGISTRATION_CHALLENGE === 'off' },
      settings: {
        issuer: config.IDENTITY_JWT_ISSUER,
        audience: config.IDENTITY_JWT_AUDIENCE,
        publicUrl: config.IDENTITY_PUBLIC_URL,
        trustedOrigins: config.IDENTITY_TRUSTED_ORIGINS,
        tosVersion: config.IDENTITY_TOS_VERSION,
        privacyVersion: config.IDENTITY_PRIVACY_VERSION,
        blockedEmailDomains: config.IDENTITY_BLOCKED_EMAIL_DOMAINS.map((d) => d.toLowerCase()),
        backupCodePepper: pepper as string,
      },
    },
    { redirectBaseUrl: config.OAUTH_REDIRECT_BASE_URL, clients, fetch: globalThis.fetch },
  );
  const outbox = new OutboxDispatcher(store, mail, new NatsEventPublisher(infra.nats), clock, {
    onDead: (id, error) =>
      console.error(JSON.stringify({ msg: 'identity: outbox dead', id, error })),
  });
  return {
    services,
    outbox,
    warnings,
    secureCookies: config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test',
  };
}
