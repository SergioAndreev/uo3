import { describe, expect, it } from 'vitest';
import { CLOSE } from '../engine/session.js';
import { HeadlessShard, VirtualClient, diffTraces, flush } from './harness.js';

describe('runtime/simulation-test-harness', () => {
  it('шард в памяти поднимается быстро и без сети', async () => {
    const t0 = performance.now();
    const shard = await HeadlessShard.create();
    expect(performance.now() - t0).toBeLessThan(2_000);
    expect(shard.node.state).toBe('READY');
    expect(shard.partition.core.state).toBe('ACTIVE');
  });

  it('время: точная задержка выхода, advanceUntil, отрицательный шаг', async () => {
    const shard = await HeadlessShard.create();
    const { session } = await shard.player('acc');
    shard.partition.sessions.logout(session);
    shard.advanceMs(119_950);
    await flush();
    expect(shard.partition.core.get(session.entityId)).toBeDefined();
    shard.step();
    await flush();
    expect(shard.partition.core.get(session.entityId)).toBeUndefined();
    expect(() => shard.step(-1)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_TIME_DELTA' }),
    );
    expect(() => shard.advanceMs(-5)).toThrow(
      expect.objectContaining({ code: 'ERR_INVALID_TIME_DELTA' }),
    );
    await expect(shard.advanceUntil(() => false, 3)).rejects.toMatchObject({
      code: 'HARNESS_WAIT_TIMEOUT',
    });
    expect(await shard.advanceUntil(() => shard.scheduler.tick >= shard.scheduler.tick, 1)).toBe(0);
  });

  it('виртуальные клиенты: вход в партицию и хаб, обрыв, переподключение, второй герой', async () => {
    const shard = await HeadlessShard.create();
    const p = await shard.player('acc');
    expect(p.world.messages.map((m) => m.type)).toEqual([
      'session:reconnect_token',
      'session:ready',
    ]);
    expect(p.hub?.messages.map((m) => m.type)).toEqual(['hub:motd', 'hub:presence_summary']);
    const token = (p.world.last('session:reconnect_token') as { token: string }).token;
    shard.node.leaveWorld('proving-0', p.world.id);
    shard.advanceMs(10_000);
    const again = new VirtualClient('again');
    await shard.node.joinWorld('proving-0', again, {
      reconnect: { accountId: 'acc', sessionId: p.session.sessionId, token },
    });
    expect(p.session.state).toBe('ONLINE');
    shard.hero({ characterId: 'second' });
    const t = shard.tickets('acc', 'second');
    await expect(
      shard.node.joinWorld('proving-0', new VirtualClient('b'), { ticket: t.world }),
    ).rejects.toMatchObject({ code: CLOSE.ACCOUNT_ALREADY_IN_WORLD });
    await expect(
      shard.node.joinWorld('proving-0', new VirtualClient('c'), {}),
    ).rejects.toMatchObject({ code: CLOSE.INVALID_TICKET });
  });

  it('фабрики: безопасная зона и политика выхода', async () => {
    const shard = await HeadlessShard.create();
    shard.safeZone(30, 30, 34, 34);
    const ok = await shard.player('a', { x: 31, y: 31 });
    const blocked = await shard.player('b', { x: 32, y: 32 });
    shard.policies.push((id) => id === blocked.session.entityId);
    shard.partition.sessions.logout(ok.session);
    shard.partition.sessions.logout(blocked.session);
    await flush();
    expect(ok.session.state).toBe('EXITED');
    expect(blocked.session.state).toBe('LOGOUT_DELAY');
    expect(shard.sight({ x: 30, y: 20, h: 0 }, { x: 36, y: 26, h: 0 }).visible).toBe(true);
    shard.partition.core.create('item', {
      placement: { kind: 'world', x: 33, y: 23, h: 0 },
      height: 8,
      blocksSight: true,
    });
    expect(shard.sight({ x: 30, y: 20, h: 0 }, { x: 36, y: 26, h: 0 })).toMatchObject({
      visible: false,
      reason: 'dynamic',
    });
  });

  it('отпечаток: два прогона совпадают; снапшот и откат дают тот же отпечаток', async () => {
    const run = async () => {
      const shard = await HeadlessShard.create({ seed: 7 });
      await shard.player('a');
      shard.step(100);
      await shard.player('b', { x: 40, y: 40 });
      shard.step(50);
      return shard;
    };
    const [one, two] = [await run(), await run()];
    expect(one.fingerprint()).toBe(two.fingerprint());
    expect(diffTraces(one.trace, two.trace)).toBeNull();
    const snap = one.snapshot();
    {
      const a = await HeadlessShard.restore({ seed: 7 }, snap);
      expect(a.fingerprint()).toBe(one.fingerprint());
      a.partition.sessions.disconnect(a.partition.sessions.session('a')?.client?.id ?? '');
      a.step(10);
      const b = await HeadlessShard.restore({ seed: 7 }, snap);
      b.step(10);
      expect(a.fingerprint()).not.toBe(b.fingerprint());
      const c = await HeadlessShard.restore({ seed: 7 }, snap);
      c.step(10);
      expect(c.fingerprint()).toBe(b.fingerprint());
    }
  });

  it('трасса: первое расхождение — тик, тип и поля', () => {
    const a = [
      { tick: 1, type: 'x', data: { v: 1 } },
      { tick: 2, type: 'y', data: { v: 2, w: 1 } },
    ];
    const b = [
      { tick: 1, type: 'x', data: { v: 1 } },
      { tick: 2, type: 'y', data: { v: 3, w: 1 } },
    ];
    expect(diffTraces(a, b)).toMatchObject({ index: 1, tick: 2, type: 'y', fields: ['v'] });
    expect(diffTraces(a, a.slice(0, 1))).toMatchObject({ index: 1, right: null });
  });

  it('строгий режим ловит Date.now и Math.random в тике; отчёт об утечках', async () => {
    const shard = await HeadlessShard.create();
    shard.scheduler.register({ name: 'bad', priority: 1, run: () => void Math.random() });
    expect(() => shard.step()).toThrow(
      expect.objectContaining({ code: 'HARNESS_DETERMINISM_VIOLATION' }),
    );
    const lax = await HeadlessShard.create({ strict: false });
    lax.scheduler.register({ name: 'bad', priority: 1, run: () => void Date.now() });
    lax.step();
    expect(lax.dispose()).toMatchObject({ activeTimers: expect.any(Number), errors: 0 });
  });
});

describe('runtime/game-server-host: узел шарда', () => {
  it('heartbeat и реестр комнат в формате P05', async () => {
    const shard = await HeadlessShard.create();
    await shard.player('a');
    shard.advanceMs(5_000);
    await flush();
    expect(shard.registry.heartbeats.at(-1)).toMatchObject({
      nodeId: 'headless',
      onlineCount: 1,
      draining: false,
    });
    expect(shard.registry.partitions.get('proving-0')).toMatchObject({
      realm: 'proving',
      minX: 0,
      maxX: 63,
      roomId: 'local-dev-proving-0',
      hardCapacity: 500,
      onlineCount: 1,
    });
    expect(shard.registry.hub).toMatchObject({ roomId: 'local-dev-hub', onlineCount: 1 });
  });

  it('события P04: бан, отзыв сессий по причине, уровни; повтор eventId — без эффекта', async () => {
    const shard = await HeadlessShard.create();
    const a = await shard.player('a');
    expect(await shard.inject('identity.account.banned', { eventId: 'e1', accountId: 'a' })).toBe(
      true,
    );
    await flush();
    expect(a.world.closed?.code).toBe(CLOSE.BANNED);
    expect(a.hub?.closed?.code).toBe(CLOSE.BANNED);
    expect(await shard.inject('identity.account.banned', { eventId: 'e1', accountId: 'a' })).toBe(
      false,
    );
    const b = await shard.player('b');
    await shard.inject('identity.account.sessions_revoked', {
      eventId: 'e2',
      accountId: 'b',
      reason: 'logout',
    });
    expect(b.session.state).toBe('ONLINE');
    await shard.inject('identity.account.sessions_revoked', {
      eventId: 'e3',
      accountId: 'b',
      reason: 'password_changed',
    });
    expect(b.world.closed?.code).toBe(CLOSE.SESSION_REVOKED);
    expect(b.session.state).toBe('LOGOUT_DELAY');
    const g = await shard.player('g', { level: 'game-master' });
    await shard.inject('identity.account.effective_level_changed', {
      eventId: 'e4',
      accountId: 'g',
      maxLevel: 'game-master',
      effectiveLevel: 'player',
    });
    expect(g.session.effectiveLevel).toBe('player');
    expect(await shard.inject('identity.account.unbanned', { eventId: 'e5', accountId: 'a' })).toBe(
      false,
    );
  });

  it('события P05: блокировка и переименование героя; обслуживание и дренаж', async () => {
    const shard = await HeadlessShard.create();
    const a = await shard.player('a');
    await shard.inject('character.locked', {
      eventId: 'c1',
      shardId: 'other',
      accountId: 'a',
      characterId: a.characterId,
    });
    expect(a.session.state).toBe('ONLINE');
    await shard.inject('character.locked', {
      eventId: 'c2',
      shardId: 'local-dev',
      accountId: 'a',
      characterId: a.characterId,
    });
    expect(a.world.closed?.code).toBe(CLOSE.CHARACTER_LOCKED);
    const r = await shard.player('r');
    await shard.inject('character.rename_required', {
      eventId: 'c3',
      shardId: 'local-dev',
      accountId: 'r',
      characterId: r.characterId,
    });
    expect(r.world.closed?.code).toBe(CLOSE.CHARACTER_FORCE_RENAME);
    const p = await shard.player('p');
    const gm = await shard.player('gm', { level: 'game-master' });
    await shard.inject('shard.local-dev.status_changed', { eventId: 's1', status: 'maintenance' });
    expect(p.world.closed?.code).toBe(CLOSE.SHARD_MAINTENANCE);
    expect(gm.world.closed).toBeNull();
    await expect(shard.player('late')).rejects.toMatchObject({ code: CLOSE.SHARD_MAINTENANCE });
    expect((await shard.player('gm2', { level: 'game-master' })).session.state).toBe('ONLINE');
    await shard.inject('shard.local-dev.status_changed', { eventId: 's2', status: 'normal' });
    await shard.inject('shard.local-dev.status_changed', { eventId: 's3', status: 'draining' });
    await expect(shard.player('x')).rejects.toMatchObject({ code: CLOSE.PARTITION_DRAINING });
    await flush();
    expect(shard.registry.heartbeats.at(-1)).toMatchObject({ draining: true });
  });

  it('присутствие хаба следует за сессиями; события других узлов', async () => {
    const shard = await HeadlessShard.create();
    const a = await shard.player('a');
    expect(shard.node.hub?.visibleCount('player')).toBe(1);
    shard.node.leaveWorld('proving-0', a.world.id);
    expect(shard.node.hub?.query([a.characterId], 'player')).toEqual({
      [a.characterId]: 'lingering',
    });
    await shard.inject('shard.local-dev.session.entered', {
      eventId: 'n1',
      nodeId: 'other',
      accountId: 'z',
      characterId: 'z-hero',
      entityId: 5,
      name: 'z',
      realm: 'proving',
      partitionId: 'proving-1',
      accessLevel: 'player',
      effectiveLevel: 'player',
    });
    expect(shard.node.hub?.visibleCount('player')).toBe(2);
    await shard.inject('shard.local-dev.session.exited', {
      eventId: 'n2',
      nodeId: 'other',
      accountId: 'z',
    });
    expect(shard.node.hub?.visibleCount('player')).toBe(1);
  });

  it('сообщения клиента идут через очередь тика; остановка: 4112, сохранение, очистка реестра, один цикл', async () => {
    const shard = await HeadlessShard.create();
    const a = await shard.player('a', { x: 40, y: 40 });
    shard.node.worldMessage('proving-0', a.world.id, 'session:logout_request', 1);
    expect(a.session.state).toBe('ONLINE');
    shard.step();
    expect(a.session.state).toBe('LOGOUT_DELAY');
    const b = await shard.player('b');
    let hard = 0;
    const first = shard.node.shutdown(() => hard++);
    const second = shard.node.shutdown();
    expect(second).toBe(first);
    await first;
    expect(b.world.closed?.code).toBe(CLOSE.SERVER_SHUTDOWN);
    expect(shard.heroes.get(b.characterId)?.saves).toHaveLength(1);
    expect(shard.registry.cleared).toBe(true);
    expect(shard.node.state).toBe('STOPPED');
    expect(hard).toBe(0);
  });
});
