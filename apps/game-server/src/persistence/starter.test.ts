import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  makeEntityId,
  type EntityId,
} from '@duskmarch/domain';
import { starterLoadout } from '@duskmarch/content';
import { describe, expect, it } from 'vitest';
import { PartitionCore } from '../engine/partition.js';
import { flush, HeadlessShard } from '../testing/harness.js';
import { CriticalTransactionCoordinator, type CommitRequest } from './critical.js';
import { DirtyTracker } from './dirty-tracker.js';
import { entityToRow } from './flush-store.js';
import type { WorldRowOut } from './flush.js';
import { backgroundLedger, isValuable } from './ledger-policy.js';
import { starterTx } from './starter.js';

const HERO = makeEntityId('hero', 7);
const LOADOUT = starterLoadout([{ skill: 'edge', tenths: 300 }]);

async function coordinator() {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 256 });
  await allocator.ready();
  let tracker: DirtyTracker<WorldRowOut> | null = null;
  const core = new PartitionCore({
    partitionId: 'dawn-0',
    realm: { key: 'dawn', width: 64, height: 64 },
    bounds: { minX: 0, minY: 0, maxX: 63, maxY: 63 },
    allocator,
    onDirty: (id, r) => tracker?.onDirty(id, r),
  });
  core.hydrate([
    {
      id: HERO,
      kind: 'hero',
      placement: { kind: 'world', x: 5, y: 5, h: 0 },
      player: true,
      height: 7,
      blocksSight: false,
      behaviors: [],
    },
  ]);
  const serialize = (e: Parameters<typeof entityToRow>[2]) =>
    entityToRow('ember', 'dawn', e, (id) => core.get(id));
  tracker = new DirtyTracker(core, serialize);
  const commits: CommitRequest[] = [];
  const registry = new Map<
    string,
    { txId: string; payloadHash: string; result: Record<string, unknown> }
  >();
  const crit = new CriticalTransactionCoordinator(
    core,
    tracker,
    {
      find: async (k) => registry.get(k) ?? null,
      commit: async (r) => {
        commits.push(r);
        if (r.idempotencyKey)
          registry.set(r.idempotencyKey, {
            txId: r.txId,
            payloadHash: r.payloadHash,
            result: r.result,
          });
      },
      serialize,
    },
    (k) => allocator.next(k),
  );
  return { core, crit, commits };
}

describe('persistence/critical-transactions: стартовый набор и журнал', () => {
  it('выдача: одежда надета, остальное в мешке, монеты; флаг героя; повтор ничего не создаёт', async () => {
    const c = await coordinator();
    const out = await c.crit.run(starterTx(HERO, 'char-1', LOADOUT));
    const items = (out.result['items'] as EntityId[]).map((id) => c.core.get(id));
    const bySlot = Object.fromEntries(
      items
        .filter((e) => e?.placement.kind === 'equipped')
        .map((e) => [(e?.placement as { slot: string }).slot, e?.data?.contentKey]),
    );
    expect(bySlot).toMatchObject({
      torso: 'item.linen-shirt',
      legs: 'item.linen-trousers',
      feet: 'item.travel-boots',
      pack: 'item.satchel',
    });
    const satchel = items.find((e) => e?.data?.contentKey === 'item.satchel');
    const coins = items.find((e) => e?.data?.contentKey === 'item.copper-coin');
    expect(coins).toMatchObject({
      placement: { kind: 'container', parent: satchel?.id },
      data: { amount: 100, entityVersion: 1, rootOwnerId: HERO },
    });
    expect(items.some((e) => e?.data?.contentKey === 'item.short-blade')).toBe(true);
    expect(c.commits[0]).toMatchObject({
      txType: 'STARTER_LOADOUT_GRANT',
      grantStarterFor: 'char-1',
    });
    expect(c.commits[0]?.ledger.every((l) => l.eventKind === 'CREATE')).toBe(true);
    expect(c.commits[0]?.upserts.find((u) => u.row.entityId === coins?.id)?.row).toMatchObject({
      rootOwnerId: HERO,
      parentId: satchel?.id,
    });
    const again = await c.crit.run(starterTx(HERO, 'char-1', LOADOUT));
    expect(again.replayed).toBe(true);
    expect(c.commits).toHaveLength(1);
  });

  it('первый вход героя на стенде: набор выдаётся один раз и выгружается при выходе', async () => {
    const shard = await HeadlessShard.create();
    const granted: string[] = [];
    shard.partition.sessions.useStarterGrant(async (s) => {
      granted.push(s.characterId);
      const item = shard.partition.core.create('item', {
        placement: { kind: 'equipped', holder: s.entityId, slot: 'pack' },
      });
      const hero = shard.heroes.get(s.characterId);
      if (hero?.starter) hero.starter.granted = true;
      return [item.id];
    });
    const { session, characterId } = await shard.player('acc-1');
    void session;
    const hero = shard.heroes.get(characterId);
    expect(hero).toBeDefined();
    // герой стенда создан до флага — проверяем, что без набора выдачи нет
    expect(granted).toEqual([]);
    if (hero) hero.starter = { granted: false, loadout: LOADOUT };
    shard.partition.sessions.logout(session);
    shard.advanceMs(200_000);
    await flush();
    const again = await shard.player('acc-1', { characterId });
    expect(granted).toEqual([characterId]);
    expect(again.session.owned).toHaveLength(1);
    shard.partition.sessions.logout(again.session);
    shard.advanceMs(200_000);
    await flush();
    const third = await shard.player('acc-1', { characterId });
    expect(granted).toHaveLength(1);
    void third;
  });

  it('политика ценности и фоновые события журнала', () => {
    expect(isValuable('item.copper-coin')).toBe(true);
    expect(isValuable('item.deed-stone-house')).toBe(true);
    expect(isValuable('item.rye-bread')).toBe(false);
    expect(isValuable('item.blade', { enchanted: true })).toBe(true);
    expect(isValuable(undefined)).toBe(false);
    const rows = backgroundLedger(
      'ember',
      'tx-1',
      {
        upserts: [
          {
            row: {
              entityId: 1,
              kind: 'item',
              parentId: null,
              contentKey: 'item.copper-coin',
              amount: 50,
              realm: 'dawn',
              x: 1,
              y: 2,
              h: 0,
            },
            expectedVersion: 0,
          },
          {
            row: {
              entityId: 2,
              kind: 'item',
              parentId: 9,
              contentKey: 'item.copper-coin',
              rootOwnerId: 9,
            },
            expectedVersion: 3,
          },
          {
            row: { entityId: 3, kind: 'item', parentId: null, contentKey: 'item.rye-bread' },
            expectedVersion: 0,
          },
          {
            row: { entityId: 4, kind: 'item', parentId: null, contentKey: 'item.copper-coin' },
            expectedVersion: 1,
          },
        ],
        deletes: [
          { entityId: 5, expectedVersion: 1, contentKey: 'item.deed-hut' },
          { entityId: 6, expectedVersion: 1 },
        ],
      },
      { written: [1, 2, 3], deleted: [5, 6], conflicts: [4] },
      new Date(0),
    );
    expect(rows.map((r) => [r.itemId, r.eventKind])).toEqual([
      [1, 'CREATE'],
      [2, 'MODIFY'],
      [5, 'DESTROY'],
    ]);
    expect(rows[0]).toMatchObject({ amountDelta: 50, realm: 'dawn', x: 1, txType: 'BACKGROUND' });
    expect(rows[1]).toMatchObject({ toOwnerId: 9, toParentId: 9 });
  });
});
