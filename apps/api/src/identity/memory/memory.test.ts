import { FakeClock } from '@duskmarch/test-kit';
import { expect, it } from 'vitest';
import { keyValueContract, storeContract } from '../testing/contracts.test-helper.js';
import { MemoryKeyValue } from './key-value.js';
import { MemoryIdentityStore } from './store.js';
import { MemoryEvents, MemoryMailbox } from './transports.js';

storeContract('память', async () => new MemoryIdentityStore());
keyValueContract('память', async () => {
  const clock = new FakeClock();
  return { kv: new MemoryKeyValue(clock), advance: async (ms) => void clock.advance(ms) };
});

it('почтовый ящик и события в памяти', async () => {
  const mail = new MemoryMailbox();
  await mail.send({ to: 'a@b.cd', subject: 's', text: 'ссылка https://x/verify?token=abc_DEF-1' });
  expect(mail.lastToken('a@b.cd')).toBe('abc_DEF-1');
  expect(mail.lastToken('x@y.zz')).toBeUndefined();
  mail.failing = true;
  await expect(mail.send({ to: 'a', subject: 's', text: 't' })).rejects.toThrow();
  const events = new MemoryEvents();
  await events.publish('identity.account.banned', { id: 1 });
  expect(events.of('identity.account.banned')).toEqual([{ id: 1 }]);
  const store = new MemoryIdentityStore();
  expect(store.outboxRows()).toEqual([]);
});
