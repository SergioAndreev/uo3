import { expect, it } from 'vitest';
import { bootstrapOwner } from './bootstrap.js';
import { systemEntropy } from './crypto/random.js';
import { harness } from './testing/harness.test-helper.js';

it('первый владелец: повышение, аудит, отказ при существующем владельце', async () => {
  const h = harness();
  const account = await h.activeAccount('founder@example.com');
  await h.login('founder@example.com');
  expect(await bootstrapOwner(h.store, 'bad', 0, systemEntropy)).toEqual({
    ok: false,
    reason: 'invalid_email',
  });
  expect(await bootstrapOwner(h.store, 'ghost@example.com', 0, systemEntropy)).toEqual({
    ok: false,
    reason: 'account_not_found',
  });
  expect(await bootstrapOwner(h.store, ' Founder@Example.com ', 5, systemEntropy)).toEqual({
    ok: true,
    accountId: account.id,
  });
  expect(await h.store.findAccount(account.id)).toMatchObject({
    accessLevel: 'owner',
    effectiveLevel: 'owner',
  });
  expect(await h.store.listActiveSessions(account.id, h.clock.utc())).toEqual([]);
  expect((await h.store.listAudit({ limit: 1 })).items[0]).toMatchObject({
    action: 'access_level.bootstrap',
  });
  await h.activeAccount('second@example.com');
  expect(await bootstrapOwner(h.store, 'second@example.com', 6, systemEntropy)).toEqual({
    ok: false,
    reason: 'owner_exists',
  });
});
