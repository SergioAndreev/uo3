import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  makeEntityId,
  type EntityId,
} from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { PartitionCore, type Entity } from '../engine/partition.js';
import { CriticalTransactionCoordinator, type CommitRequest, type CriticalTx } from './critical.js';
import { DirtyTracker } from './dirty-tracker.js';
import { entityToRow } from './flush-store.js';
import type { WorldRowOut } from './flush.js';

const A = makeEntityId('hero', 1);
const B = makeEntityId('hero', 2);

async function bench(
  opts: {
    commit?: (r: CommitRequest) => Promise<void>;
    mode?: 'normal' | 'read_only_degraded';
  } = {},
) {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 256 });
  await allocator.ready();
  let tracker: DirtyTracker<WorldRowOut> | null = null;
  const core = new PartitionCore({
    partitionId: 'dawn-0',
    realm: { key: 'dawn', width: 4096, height: 4096 },
    bounds: { minX: 0, minY: 0, maxX: 4095, maxY: 4095 },
    allocator,
    onDirty: (id, r) => tracker?.onDirty(id, r),
  });
  core.hydrate([]);
  tracker = new DirtyTracker(core, (e) => entityToRow('ember', 'dawn', e, (id) => core.get(id)));
  const t = tracker;
  for (const id of [A, B])
    core.spawn({
      id,
      kind: 'hero',
      placement: { kind: 'world', x: 10, y: 10, h: 0 },
      player: true,
      height: 7,
      blocksSight: false,
      behaviors: [],
    });
  const commits: CommitRequest[] = [];
  const registry = new Map<
    string,
    { txId: string; payloadHash: string; result: Record<string, unknown> }
  >();
  const audits: string[] = [];
  const alerts: string[] = [];
  const crit = new CriticalTransactionCoordinator(
    core,
    t,
    {
      find: async (key) => registry.get(key) ?? null,
      commit: async (r) => {
        await opts.commit?.(r);
        commits.push(r);
        if (r.idempotencyKey)
          registry.set(r.idempotencyKey, {
            txId: r.txId,
            payloadHash: r.payloadHash,
            result: r.result,
          });
      },
      serialize: (e) => entityToRow('ember', 'dawn', e, (id) => core.get(id)),
      audit: (type) => void audits.push(type),
    },
    (kind) => allocator.next(kind),
    { mode: () => opts.mode ?? 'normal', onAlert: (code) => alerts.push(code), txTimeoutMs: 50 },
  );
  /** Предмет у героя в мешке, уже записанный в БД (версия 1). */
  const give = (holder: EntityId, contentKey: string, amount: number, version = 1): Entity => {
    const e: Entity = {
      id: allocator.next('item'),
      kind: 'item',
      placement: { kind: 'equipped', holder, slot: 'main-hand' as never },
      player: false,
      height: 0,
      blocksSight: false,
      behaviors: [],
      data: {
        contentKey,
        amount,
        components: {},
        schemaVersion: 1,
        entityVersion: version,
        rootOwnerId: holder,
      },
    };
    if (contentKey !== 'item.blade') e.placement = { kind: 'container', parent: holder };
    core.spawn(e);
    return e;
  };
  return { core, t, crit, commits, audits, alerts, give, allocator };
}

/** Обмен: А отдаёт клинок, Б — часть монет из стопки. */
function trade(blade: Entity, coins: Entity, amount: number, key?: string): CriticalTx {
  return {
    type: 'TRADE_EXCHANGE',
    ...(key ? { idempotencyKey: key } : {}),
    participants: [blade.id, coins.id],
    payload: { blade: blade.id, coins: coins.id, amount },
    plan: (get, newId) => {
      const sword = get(blade.id) as Entity;
      const stack = get(coins.id) as Entity;
      sword.placement = { kind: 'container', parent: B };
      const rest = { ...stack, data: { ...stack.data!, amount: stack.data!.amount - amount } };
      const paid: Entity = {
        ...stack,
        id: newId('item'),
        placement: { kind: 'container', parent: A },
        data: { ...stack.data!, amount, entityVersion: 0 },
      };
      return {
        upserts: [sword, rest, paid],
        deletes: [],
        ledger: [
          { eventKind: 'TRANSFER', itemId: blade.id, fromOwnerId: A, toOwnerId: B },
          { eventKind: 'SPLIT', itemId: coins.id, amountDelta: -amount },
          {
            eventKind: 'CREATE',
            itemId: paid.id,
            sourceItemId: coins.id,
            amountDelta: amount,
            toOwnerId: A,
          },
        ],
        result: { paid: paid.id },
      };
    },
  };
}

describe('persistence/critical-transactions', () => {
  it('обмен: одна транзакция, память меняется только после коммита, версии растут', async () => {
    let seenBefore: unknown = null;
    const b = await bench({
      commit: async () => void (seenBefore = b.core.get(blade.id)?.placement),
    });
    const blade = b.give(A, 'item.blade', 1);
    const coins = b.give(B, 'item.copper-coin', 5_000);
    const out = await b.crit.run(trade(blade, coins, 300));
    expect(seenBefore).toEqual({ kind: 'equipped', holder: A, slot: 'main-hand' });
    expect(b.core.get(blade.id)?.placement).toEqual({ kind: 'container', parent: B });
    expect(b.core.get(coins.id)?.data).toMatchObject({ amount: 4_700, entityVersion: 2 });
    const paid = b.core.get(out.result.paid as EntityId);
    expect(paid?.data).toMatchObject({ amount: 300, entityVersion: 1 });
    expect(b.commits[0]?.upserts.map((u) => [u.row.entityId, u.expectedVersion])).toEqual([
      [blade.id, 1],
      [coins.id, 1],
      [paid?.id, 0],
    ]);
    expect(b.commits[0]?.upserts[0]?.row).toMatchObject({ rootOwnerId: B, parentId: B });
    expect(b.commits[0]?.ledger.map((l) => l.eventKind)).toEqual(['TRANSFER', 'SPLIT', 'CREATE']);
    expect(b.t.size).toBe(0);
  });

  it('сбой коммита: память без изменений, блокировки сняты; таймаут — PERSIST_TX_TIMEOUT', async () => {
    let mode: 'fail' | 'hang' = 'fail';
    const b = await bench({
      commit: () =>
        mode === 'fail' ? Promise.reject(new Error('ECONNRESET')) : new Promise(() => undefined),
    });
    const blade = b.give(A, 'item.blade', 1);
    const coins = b.give(B, 'item.copper-coin', 1_000);
    await expect(b.crit.run(trade(blade, coins, 300))).rejects.toMatchObject({
      code: 'PERSIST_TX_UNAVAILABLE',
    });
    expect(b.core.get(coins.id)?.data?.amount).toBe(1_000);
    expect(b.crit.isLocked(blade.id)).toBe(false);
    mode = 'hang';
    await expect(b.crit.run(trade(blade, coins, 300))).rejects.toMatchObject({
      code: 'PERSIST_TX_TIMEOUT',
    });
    expect(b.core.get(blade.id)?.placement.kind).toBe('equipped');
    expect(b.crit.isLocked(coins.id)).toBe(false);
  });

  it('блокировка: намерение к предмету во время коммита — PERSIST_ENTITY_TX_LOCKED; встречные пары без взаимной блокировки', async () => {
    let release = () => undefined as void;
    const b = await bench({ commit: () => new Promise<void>((r) => (release = r)) });
    const blade = b.give(A, 'item.blade', 1);
    const coins = b.give(B, 'item.copper-coin', 1_000);
    const first = b.crit.run(trade(blade, coins, 100));
    await new Promise((r) => setImmediate(r));
    expect(() => b.crit.guard(blade.id)).toThrow(
      expect.objectContaining({ code: 'PERSIST_ENTITY_TX_LOCKED' }),
    );
    const reversed = { ...trade(blade, coins, 50), participants: [coins.id, blade.id] };
    await expect(b.crit.run(reversed)).rejects.toMatchObject({ code: 'PERSIST_ENTITY_TX_LOCKED' });
    release();
    await first;
    expect(b.crit.isLocked(blade.id) || b.crit.isLocked(coins.id)).toBe(false);
    b.crit.guard(blade.id);
  });

  it('несохранённые изменения участника и его контейнера входят в ту же транзакцию', async () => {
    const b = await bench();
    const bag = b.core.create('item', { placement: { kind: 'container', parent: B } });
    bag.data = {
      contentKey: 'item.sack',
      amount: 1,
      components: {},
      schemaVersion: 1,
      entityVersion: 0,
      rootOwnerId: B,
    };
    const fresh = b.core.create('item', { placement: { kind: 'container', parent: bag.id } });
    fresh.data = {
      contentKey: 'item.copper-coin',
      amount: 100,
      components: {},
      schemaVersion: 1,
      entityVersion: 0,
      rootOwnerId: B,
    };
    const blade = b.give(A, 'item.blade', 1);
    await b.crit.run(trade(blade, fresh, 40));
    const c = b.commits[0] as CommitRequest;
    expect(c.prior.map((p) => [p.row.entityId, p.expectedVersion]).sort()).toEqual(
      [
        [bag.id, 0],
        [fresh.id, 0],
      ].sort(),
    );
    expect(c.upserts.find((u) => u.row.entityId === fresh.id)?.expectedVersion).toBe(1);
    expect(b.t.has(fresh.id)).toBe(false);
    b.core.move(A, 11, 10, 0);
    expect(b.t.has(A)).toBe(true);
  });

  it('идемпотентность: повтор возвращает тот же результат; другой запрос с ключом — отказ', async () => {
    const b = await bench();
    const blade = b.give(A, 'item.blade', 1);
    const coins = b.give(B, 'item.copper-coin', 1_000);
    const first = await b.crit.run(trade(blade, coins, 100, 'bank-op-91'));
    const again = await b.crit.run(trade(blade, coins, 100, 'bank-op-91'));
    expect(again).toEqual({ ...first, replayed: true });
    expect(b.commits).toHaveLength(1);
    await expect(b.crit.run(trade(blade, coins, 200, 'bank-op-91'))).rejects.toMatchObject({
      code: 'PERSIST_TX_IDEMPOTENCY_MISMATCH',
    });
  });

  it('баланс стопок: покупка с явным стоком проходит; размножение и повтор участника — отказ', async () => {
    const b = await bench();
    const coins = b.give(A, 'item.copper-coin', 1_000);
    await b.crit.run({
      type: 'MERCHANT_BUY',
      participants: [coins.id],
      payload: { price: 300 },
      plan: (get) => {
        const s = get(coins.id) as Entity;
        return {
          upserts: [{ ...s, data: { ...s.data!, amount: 700 } }],
          deletes: [],
          burned: { 'item.copper-coin': 300 },
          ledger: [{ eventKind: 'SPLIT', itemId: coins.id, amountDelta: -300 }],
        };
      },
    });
    expect(b.core.get(coins.id)?.data?.amount).toBe(700);
    const dupe: CriticalTx = {
      type: 'TRADE_EXCHANGE',
      participants: [coins.id],
      payload: {},
      plan: (get, newId) => {
        const s = get(coins.id) as Entity;
        return {
          upserts: [
            { ...s, data: { ...s.data!, amount: 600 } },
            { ...s, id: newId('item'), data: { ...s.data!, amount: 600, entityVersion: 0 } },
          ],
          deletes: [],
          ledger: [],
        };
      },
    };
    await expect(b.crit.run(dupe)).rejects.toMatchObject({
      code: 'PERSIST_CONSERVATION_VIOLATION',
    });
    expect(b.alerts).toEqual(['PERSIST_CONSERVATION_VIOLATION']);
    expect(b.core.get(coins.id)?.data?.amount).toBe(700);
    await expect(b.crit.run({ ...dupe, participants: [coins.id, coins.id] })).rejects.toMatchObject(
      { code: 'PERSIST_OWNERSHIP_INVARIANT_VIOLATION' },
    );
    await expect(
      b.crit.run({ ...dupe, participants: [0x60009999 as EntityId] }),
    ).rejects.toMatchObject({ code: 'PERSIST_OWNERSHIP_INVARIANT_VIOLATION' });
  });

  it('деградация и операции персонала: обоснование, аудит, удаление', async () => {
    const down = await bench({ mode: 'read_only_degraded' });
    const x = down.give(A, 'item.blade', 1);
    await expect(down.crit.run(trade(x, x, 0))).rejects.toMatchObject({
      code: 'PERSIST_SERVICE_DEGRADED',
    });
    const b = await bench();
    const junk = b.give(A, 'item.rye-bread', 3);
    const del: CriticalTx = {
      type: 'STAFF_ITEM_DELETE',
      actor: { accountId: 'gm-1', accessLevel: 'game-master' },
      reason: 'коротко',
      participants: [junk.id],
      payload: {},
      plan: () => ({
        upserts: [],
        deletes: [junk.id],
        burned: { 'item.rye-bread': 3 },
        ledger: [{ eventKind: 'DESTROY', itemId: junk.id, amountDelta: -3 }],
      }),
    };
    await expect(b.crit.run(del)).rejects.toMatchObject({ code: 'PERSIST_AUDIT_REASON_REQUIRED' });
    await b.crit.run({ ...del, reason: 'Удаление по обращению #1842' });
    expect(b.core.get(junk.id)).toBeUndefined();
    expect(b.commits[0]?.deletes).toEqual([{ entityId: junk.id, expectedVersion: 1 }]);
    expect(b.commits[0]?.actor).toMatchObject({ accessLevel: 'game-master' });
    expect(b.audits).toEqual(['STAFF_ITEM_DELETE']);
    expect(b.t.size).toBe(0);
  });
});
