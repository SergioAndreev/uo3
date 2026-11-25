import { expect, it } from 'vitest';
import { checkReadiness, createInfra } from './infra.js';

it('стартует без зависимостей, сообщает down и закрывается', async () => {
  const infra = createInfra({
    DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
    VALKEY_URL: 'redis://127.0.0.1:1',
    VALKEY_PASSWORD: 'x',
    NATS_URL: 'nats://u:p@127.0.0.1:1',
  });
  const { dependencies } = await checkReadiness(infra.probes, 1_000);
  expect(dependencies).toEqual({ postgres: 'down', valkey: 'down', nats: 'down' });
  expect(infra.nats()).toBeUndefined();
  await infra.close();
});
