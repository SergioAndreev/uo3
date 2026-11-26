import { randomUUID } from 'node:crypto';
import { gameStoreContract } from '../contracts.test-helper.js';
import { shardRecord } from '../game-harness.test-helper.js';
import { MemoryGameStore } from './store.js';

gameStoreContract('память', async () => {
  const store = new MemoryGameStore();
  await store.insertShard(shardRecord());
  return { store, account: async () => randomUUID() };
});
