import { parseArgs } from 'node:util';
import { ApiEnvSchema, loadServerConfigOrExit } from '@duskmarch/config/env/server';
import { createDbClient } from '@duskmarch/db';
import { bootstrapOwner } from '../identity/bootstrap.js';
import { systemEntropy } from '../identity/crypto/random.js';
import { DrizzleIdentityStore } from '../identity/infra/drizzle-store.js';

const MESSAGES = {
  owner_exists: 'владелец уже есть: уровни назначает он через /api/v1/staff',
  account_not_found:
    'нет подтверждённого аккаунта с таким email: зарегистрируйтесь и подтвердите адрес',
  invalid_email: 'некорректный email',
} as const;

const { values } = parseArgs({ options: { email: { type: 'string' } } });
if (!values.email) {
  console.error(
    'использование: pnpm --filter @duskmarch/api identity:bootstrap-owner --email <адрес>',
  );
  process.exit(2);
}
const config = loadServerConfigOrExit(ApiEnvSchema);
const client = createDbClient(config.DATABASE_URL);
try {
  const result = await bootstrapOwner(
    new DrizzleIdentityStore(client.db),
    values.email,
    Date.now(),
    systemEntropy,
  );
  if (!result.ok) {
    console.error(`identity:bootstrap-owner: ${MESSAGES[result.reason]}`);
    process.exitCode = 1;
  } else {
    console.log(
      `identity:bootstrap-owner: аккаунт ${result.accountId} назначен владельцем; войдите заново и включите 2FA`,
    );
  }
} finally {
  await client.close();
}
