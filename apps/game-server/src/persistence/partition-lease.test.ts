import { describe, expect, it } from 'vitest';
import { PartitionLease, type LeaseRepo } from './partition-lease.js';

function fakeRepo() {
  let epoch = 0;
  let expires = 0;
  let owner = '';
  let failing = false;
  const repo: LeaseRepo = {
    acquire: async (nodeId, ttl, now = new Date()) => {
      if (owner && owner !== nodeId && expires > now.getTime())
        throw Object.assign(new Error('held'), { code: 'PERSIST_PARTITION_LEASE_HELD' });
      owner = nodeId;
      epoch++;
      expires = now.getTime() + ttl;
      return { epoch, expiresAt: new Date(expires) };
    },
    renew: async (e, ttl, now = new Date()) => {
      if (failing) throw new Error('нет связи с БД');
      if (e !== epoch) return false;
      expires = now.getTime() + ttl;
      return true;
    },
    release: async (e) => {
      if (e === epoch) expires = 0;
    },
  };
  return {
    repo,
    steal: () => epoch++,
    fail: (v: boolean) => (failing = v),
    get expires() {
      return expires;
    },
  };
}

function clock() {
  let t = Date.parse('2026-11-26T10:00:00Z');
  const tasks: (() => void)[] = [];
  return {
    now: () => new Date(t),
    timers: {
      every: (_ms: number, cb: () => void) => tasks.push(cb),
      cancel: () => void tasks.splice(0),
    },
    tick: async (ms: number) => {
      t += ms;
      for (const cb of [...tasks]) cb();
      await new Promise((r) => setImmediate(r));
    },
    tasks,
  };
}

describe('persistence/world-store: аренда партиции на узле', () => {
  it('захват, продление, потеря эпохи — остановка партиции', async () => {
    const r = fakeRepo();
    const c = clock();
    const lost: string[] = [];
    const lease = new PartitionLease({
      repo: r.repo,
      nodeId: 'node-a',
      timers: c.timers,
      now: c.now,
      onLost: (why) => lost.push(why),
    });
    expect(await lease.acquire()).toBe(1);
    await c.tick(5_000);
    expect(r.expires).toBe(c.now().getTime() + 15_000);
    r.steal();
    await c.tick(5_000);
    expect(lost).toEqual(['stale']);
    expect(lease.lost).toBe(true);
    expect(c.tasks).toHaveLength(0);
    await lease.release();
  });

  it('сбой связи дольше TTL — аренда истекла; короткий сбой переживается', async () => {
    const r = fakeRepo();
    const c = clock();
    const lost: string[] = [];
    const warns: string[] = [];
    const lease = new PartitionLease({
      repo: r.repo,
      nodeId: 'node-a',
      timers: c.timers,
      now: c.now,
      onLost: (why) => lost.push(why),
      log: (_l, m) => warns.push(m),
    });
    await lease.acquire();
    r.fail(true);
    await c.tick(5_000);
    await c.tick(5_000);
    expect(lost).toEqual([]);
    r.fail(false);
    await c.tick(5_000);
    r.fail(true);
    for (let i = 0; i < 3; i++) await c.tick(5_000);
    expect(lost).toEqual(['expired']);
    expect(warns.length).toBeGreaterThan(0);
  });

  it('плановое освобождение отдаёт партицию следующему узлу', async () => {
    const r = fakeRepo();
    const c = clock();
    const a = new PartitionLease({
      repo: r.repo,
      nodeId: 'node-a',
      timers: c.timers,
      now: c.now,
      onLost: () => undefined,
    });
    await a.acquire();
    const b = new PartitionLease({
      repo: r.repo,
      nodeId: 'node-b',
      timers: c.timers,
      now: c.now,
      onLost: () => undefined,
    });
    await expect(b.acquire()).rejects.toMatchObject({ code: 'PERSIST_PARTITION_LEASE_HELD' });
    await a.release();
    expect(await b.acquire()).toBe(2);
  });
});

describe('persistence/world-store: остановка партиции при потере эпохи', () => {
  it('клиенты закрываются 4117 без сохранения; новый вход отклоняется', async () => {
    const { HeadlessShard } = await import('../testing/harness.js');
    const shard = await HeadlessShard.create();
    const { world, session, characterId } = await shard.player('acc-1');
    const hero = shard.heroes.get(characterId);
    await shard.node.fence('proving-0');
    expect(world.closed?.code).toBe(4117);
    expect(shard.partition.core.get(session.entityId)).toBeUndefined();
    expect(hero?.saves).toEqual([]);
    await expect(shard.player('acc-2')).rejects.toMatchObject({ code: 4117 });
    await shard.node.fence('proving-0');
    await shard.node.fence('nope');
  });
});
