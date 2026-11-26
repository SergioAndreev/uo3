import { describe, expect, it } from 'vitest';
import { META, rejects } from '../../identity/testing/harness.test-helper.js';
import { gameHarness } from '../game-harness.test-helper.js';

const V = [1, 2, 0] as const;

async function ready() {
  const g = await gameHarness();
  const p = await g.player();
  const hero = await g.hero(p, 'Ясна');
  const issue = (over: object = {}, principal = p) =>
    g.game.tickets.issue(principal, 'ember', { characterId: hero.id, ...over }, V);
  return { ...g, p, main: hero, issue };
}

describe('shard/game-tickets', () => {
  it('пара билетов: разные токены base64url, срок 30 секунд, хэши в хранилище', async () => {
    const g = await ready();
    const bundle = await g.issue();
    expect(bundle.world.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(bundle.hub.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(bundle.world.ticket).not.toBe(bundle.hub.ticket);
    expect(Date.parse(bundle.expiresAt)).toBe(g.h.clock.utc() + 30_000);
    expect(bundle.world.roomId).toBe('ember-world');
    expect(JSON.stringify([...g.live.tickets.entries()])).not.toContain(bundle.world.ticket);
  });

  it('чужой герой; несовместимый и отсутствующий протокол', async () => {
    const g = await ready();
    const other = await g.player();
    await rejects(g.issue({}, other), 'CHAR_NOT_FOUND', 404);
    await rejects(
      g.game.tickets.issue(g.p, 'ember', { characterId: g.main.id }, [0, 9, 0]),
      'SHARD_PROTOCOL_INCOMPATIBLE',
      426,
    );
    await rejects(
      g.game.tickets.issue(g.p, 'ember', { characterId: g.main.id }, null),
      'SHARD_PROTOCOL_HEADER_INVALID',
      400,
    );
  });

  it('погашение: доверенные атрибуты, повтор, подмена комнаты, истечение', async () => {
    const g = await ready();
    const bundle = await g.issue();
    const now = g.h.clock.utc();
    const redeemed = g.live.redeem(
      bundle.world.ticket,
      { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
      now,
    );
    expect(redeemed).toMatchObject({
      ok: true,
      payload: {
        accountId: g.p.accountId,
        characterId: g.main.id,
        entityId: g.main.entityId,
        accessLevel: 'player',
        realm: 'dawn',
        x: 1180,
        y: 2140,
        purpose: 'initial_login',
        takeover: false,
      },
    });
    expect(
      g.live.redeem(
        bundle.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        now,
      ),
    ).toMatchObject({ ok: false });
    expect(
      g.live.redeem(
        bundle.hub.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        now,
      ),
    ).toEqual({ ok: false, reason: 'ROOM_MISMATCH' });
    g.h.clock.advance(1000);
    const late = await g.issue();
    expect(
      g.live.redeem(
        late.hub.ticket,
        { shardId: 'ember', roomType: 'hub', roomId: 'ember-hub' },
        g.h.clock.utc() + 30_000,
      ),
    ).toMatchObject({ ok: false });
  });

  it('маршрутизация: партиция в дренаже; позиция вне плана → город', async () => {
    const g = await ready();
    await g.store.updateCharacter(g.main.id, { x: 99_999 });
    const bundle = await g.issue();
    expect(
      g.live.redeem(
        bundle.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        g.h.clock.utc(),
      ),
    ).toMatchObject({ payload: { x: 1180, y: 2140 } });
    g.live.online('ember', g.h.clock.utc(), { draining: true });
    await rejects(g.issue(), 'SHARD_PARTITION_UNAVAILABLE', 503);
    g.live.hubs.delete('ember');
    g.live.online('ember', g.h.clock.utc());
    g.live.hubs.delete('ember');
    await rejects(g.issue(), 'SHARD_PARTITION_UNAVAILABLE');
  });

  it('резервы: учёт, освобождение по сроку, переполнение для игрока', async () => {
    const g = await ready();
    await g.issue();
    expect(await g.live.reserved('ember', 'ember-world', g.h.clock.utc())).toBe(1);
    expect(await g.live.reserved('ember', 'ember-world', g.h.clock.utc() + 30_000)).toBe(0);
    g.live.online('ember', g.h.clock.utc(), { onlineCount: 100, hardCapacity: 100 });
    g.h.clock.advance(60_000);
    await rejects(g.issue(), 'SHARD_FULL', 503);
  });

  it('новый пакет заменяет прежний; лимит 10 в минуту', async () => {
    const g = await ready();
    const first = await g.issue();
    await g.issue();
    expect(
      g.live.redeem(
        first.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        g.h.clock.utc(),
      ).ok,
    ).toBe(false);
    expect(await g.live.reserved('ember', 'ember-world', g.h.clock.utc())).toBe(1);
    for (let i = 0; i < 8; i++) await g.issue();
    await rejects(g.issue(), 'TICKET_RATE_LIMITED', 429);
  });

  it('статусы героя и одна сессия аккаунта', async () => {
    const g = await ready();
    const second = await g.hero(g.p, 'Ива');
    g.live.sessions.set(`ember:${g.p.accountId}`, { characterId: second.id, state: 'online' });
    await rejects(g.issue(), 'ACCOUNT_ALREADY_IN_WORLD', 409);
    g.live.sessions.set(`ember:${g.p.accountId}`, { characterId: g.main.id, state: 'online' });
    await rejects(g.issue(), 'ACCOUNT_ALREADY_IN_WORLD');
    const takeover = await g.issue({ takeover: true });
    expect(
      g.live.redeem(
        takeover.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        g.h.clock.utc(),
      ),
    ).toMatchObject({ payload: { takeover: true } });
    g.live.sessions.clear();
    await g.store.updateCharacter(g.main.id, { status: 'rename_required' });
    await rejects(g.issue(), 'CHAR_RENAME_REQUIRED', 409);
    await g.store.updateCharacter(g.main.id, { status: 'locked' });
    await rejects(g.issue(), 'CHAR_LOCKED');
    await g.store.updateCharacter(g.main.id, { status: 'pending_deletion' });
    await rejects(g.issue(), 'CHAR_PENDING_DELETION');
  });

  it('отзыв: бан аккаунта, обслуживание шарда (кроме ведущего), блокировка героя', async () => {
    const g = await ready();
    const mod = await g.staff('moderator');
    const admin = await g.staff('administrator');
    const gm = await g.staff('game-master');
    const bundle = await g.issue();
    g.h.clock.advance(1);
    await g.h.staff.ban(
      mod,
      g.p.accountId,
      {
        reason: 'нарушение правил торговли',
        expiresAt: new Date(g.h.clock.utc() + 86_400_000).toISOString(),
      },
      META,
    );
    expect(
      g.live.redeem(
        bundle.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        g.h.clock.utc(),
      ),
    ).toEqual({ ok: false, reason: 'REVOKED' });

    const gmHero = await g.hero(gm, 'Ведомая');
    const p2 = await g.player();
    const h2 = await g.hero(p2, 'Мила');
    const playerBundle = await g.game.tickets.issue(p2, 'ember', { characterId: h2.id }, V);
    const gmBundle = await g.game.tickets.issue(gm, 'ember', { characterId: gmHero.id }, V);
    g.h.clock.advance(1);
    await g.game.shards.setStatus(admin, 'ember', { status: 'maintenance' }, META);
    expect(
      g.live.redeem(
        playerBundle.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        g.h.clock.utc(),
      ),
    ).toEqual({ ok: false, reason: 'REVOKED' });
    expect(
      g.live.redeem(
        gmBundle.world.ticket,
        { shardId: 'ember', roomType: 'world', roomId: 'ember-world' },
        g.h.clock.utc(),
      ).ok,
    ).toBe(true);
    await rejects(
      g.game.tickets.issue(p2, 'ember', { characterId: h2.id }, V),
      'SHARD_MAINTENANCE',
      503,
    );
  });

  it('назначение: initial_login по умолчанию, служебные назначения запрещены', async () => {
    const g = await ready();
    const bundle = await g.issue();
    expect(
      g.live.redeem(
        bundle.hub.ticket,
        { shardId: 'ember', roomType: 'hub', roomId: 'ember-hub' },
        g.h.clock.utc(),
      ),
    ).toMatchObject({ payload: { purpose: 'initial_login' } });
    await rejects(g.issue({ purpose: 'partition_handoff' }), 'TICKET_PURPOSE_FORBIDDEN', 400);
  });

  it('шард без узлов и шард в дренаже', async () => {
    const g = await ready();
    const p = await g.player();
    const dev = await g.hero(p, 'Ясна', 'local-dev');
    await rejects(
      g.game.tickets.issue(p, 'local-dev', { characterId: dev.id }, [0, 5, 0]),
      'SHARD_PROTOCOL_INCOMPATIBLE',
    );
    await g.store.updateShard('local-dev', { protocolRange: '>=1.0.0' });
    await rejects(
      g.game.tickets.issue(p, 'local-dev', { characterId: dev.id }, V),
      'SHARD_OFFLINE',
      503,
    );
    await g.store.updateShard('ember', { manualStatus: 'draining' });
    await rejects(g.issue(), 'SHARD_DRAINING', 503);
  });
});
