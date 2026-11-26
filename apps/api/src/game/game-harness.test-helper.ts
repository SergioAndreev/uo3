import type { AccessLevel } from '@duskmarch/domain';
import { harness, PASSWORD } from '../identity/testing/harness.test-helper.js';
import { createGameServices } from './index.js';
import { MemoryLive } from './memory/live.js';
import { MemoryGameStore } from './memory/store.js';
import type { ShardRecord } from './ports.js';

export const shardRecord = (over: Partial<ShardRecord> = {}): ShardRecord => ({
  id: 'ember',
  name: 'Угли',
  region: 'eu',
  preset: 'standard',
  rulesetOverride: {},
  visibility: 'public',
  manualStatus: 'normal',
  maintenanceEta: null,
  maintenanceMessage: null,
  creationOpen: true,
  characterSlots: 5,
  renamePolicy: 'cooldown',
  ticketTtlS: 30,
  softCapacity: 1000,
  hardCapacity: 1200,
  staffBuffer: 20,
  protocolRange: '>=1.0.0 <2.0.0',
  startCities: ['lad', 'kremnev', 'solyar'],
  sortOrder: 20,
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  ...over,
});

export const APPEARANCE = {
  build: 'average',
  face: 3,
  hairStyle: 5,
  beard: 2,
  skinTint: 1 + 1 * 17 + 8,
  hairTint: 1 + 12 * 17 + 6,
} as const;

/** Стенд P05: identity в памяти, шарды `ember` и `local-dev`, живой узел. */
export async function gameHarness() {
  const h = harness();
  const store = new MemoryGameStore();
  const live = new MemoryLive();
  const game = createGameServices(h, store, live);
  await store.insertShard(shardRecord());
  await store.insertShard(
    shardRecord({
      id: 'local-dev',
      name: 'Испытательный рубеж',
      preset: 'proving',
      startCities: ['proving-camp'],
      sortOrder: 10,
    }),
  );
  live.online('ember', h.clock.utc());
  let n = 0;
  const player = async (email = `p${n++}@example.com`) => {
    await h.activeAccount(email);
    const session = await h.login(email);
    return h.auth.authenticate(session.accessToken);
  };
  const staff = async (level: AccessLevel, email = `s${n++}@example.com`) =>
    (await h.staffSession(email, level)).principal;
  const hero = async (
    principal: Awaited<ReturnType<typeof player>>,
    name = `Ясна${'абвгдежзик'[n++ % 10]}`,
    shard = 'ember',
    over: object = {},
  ) =>
    game.characters.create(
      principal,
      shard,
      shard === 'local-dev'
        ? {
            name,
            stats: { might: 30, finesse: 30, will: 30 },
            skills: [
              { skill: 'edge', tenths: 1000 },
              { skill: 'archery', tenths: 1000 },
            ],
            appearance: { ...APPEARANCE },
            startCity: 'proving-camp',
            ...over,
          }
        : {
            name,
            background: 'resonant',
            appearance: { ...APPEARANCE },
            startCity: 'lad',
            ...over,
          },
      undefined,
      { ip: '1.1.1.1', userAgent: 't' },
    );
  return { h, game, store, live, player, staff, hero, PASSWORD };
}
