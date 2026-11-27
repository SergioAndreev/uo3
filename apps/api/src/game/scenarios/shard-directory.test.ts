import { describe, expect, it } from 'vitest';
import { META, rejects } from '../../identity/testing/harness.test-helper.js';
import { gameHarness, shardRecord } from '../game-harness.test-helper.js';

const anon = { principal: null, protocol: null };

describe('shard/shard-directory', () => {
  it('публичный список без аутентификации, порядок, архив скрыт', async () => {
    const g = await gameHarness();
    await g.store.insertShard(shardRecord({ id: 'aaa', sortOrder: 20 }));
    await g.store.insertShard(shardRecord({ id: 'old', archivedAt: 1 }));
    const { items } = await g.game.shards.list(anon);
    expect(items.map((i) => i.id)).toEqual(['local-dev', 'aaa', 'ember']);
    expect(items[2]).toMatchObject({ status: 'online', load: 'low', onlineCount: 0 });
    expect(items[2]).not.toHaveProperty('canEnter');
  });

  it('контекст игрока: число героев и причина закрытого входа', async () => {
    const g = await gameHarness();
    const p = await g.player();
    await g.hero(p);
    await g.hero(p);
    await g.store.updateShard('local-dev', { manualStatus: 'maintenance' });
    const { items } = await g.game.shards.list({ principal: p, protocol: null });
    expect(items.find((i) => i.id === 'ember')).toMatchObject({ myCharacters: 2, canEnter: true });
    expect(items.find((i) => i.id === 'local-dev')).toMatchObject({
      canEnter: false,
      entryBlockedReason: 'maintenance',
    });
  });

  it('служебный шард виден только персоналу с 2FA; unlisted — по ссылке', async () => {
    const g = await gameHarness();
    await g.store.insertShard(shardRecord({ id: 'staffland', visibility: 'staff' }));
    await g.store.insertShard(shardRecord({ id: 'secret', visibility: 'unlisted' }));
    const p = await g.player();
    expect(
      (await g.game.shards.list({ principal: p, protocol: null })).items.map((i) => i.id),
    ).not.toContain('staffland');
    await rejects(
      g.game.shards.card('staffland', { principal: p, protocol: null }),
      'SHARD_NOT_FOUND',
      404,
    );
    const mod = await g.staff('moderator');
    expect(
      (await g.game.shards.list({ principal: mod, protocol: null })).items.map((i) => i.id),
    ).toContain('staffland');
    expect((await g.game.shards.list(anon)).items.map((i) => i.id)).not.toContain('secret');
    expect((await g.game.shards.card('secret', anon)).id).toBe('secret');
  });

  it('карточка: планы Зари и Мари, только Заря без флага, несуществующий', async () => {
    const g = await gameHarness();
    const card = await g.game.shards.card('ember', anon);
    expect(card.realms).toEqual([
      expect.objectContaining({ key: 'dawn', pvp: 'consent' }),
      expect.objectContaining({ key: 'dusk', pvp: 'open' }),
    ]);
    expect(card.rules).toMatchObject({
      preset: 'standard',
      version: 2,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      caps: { statTotal: 240, statMax: 120, skillTotalTenths: 6_000, skillMaxTenths: 1_000 },
      gameHourMs: 240_000,
    });
    expect(card.startCities.map((c) => c.name)).toEqual(['Ладь', 'Кремнёв', 'Соляр']);
    await g.store.insertShard(
      shardRecord({
        id: 'calm',
        rulesetOverride: {
          features: { realmDusk: false },
          realms: [
            {
              id: 0,
              key: 'dawn',
              name: 'Заря',
              width: 4096,
              height: 4096,
              pvp: 'consent',
              testOnly: false,
            },
          ],
        },
      }),
    );
    expect((await g.game.shards.card('calm', anon)).realms.map((r) => r.key)).toEqual(['dawn']);
    await rejects(g.game.shards.card('nope', anon), 'SHARD_NOT_FOUND', 404);
  });

  it('heartbeat: сумма онлайна, offline, degraded, дренаж узлов', async () => {
    const g = await gameHarness();
    const now = g.h.clock.utc();
    g.live.nodes.set('ember', [
      { nodeId: 'a', onlineCount: 120, tickP99Ms: 20, draining: false, updatedAt: now },
      { nodeId: 'b', onlineCount: 80, tickP99Ms: 20, draining: false, updatedAt: now },
    ]);
    expect(await g.game.shards.card('ember', anon)).toMatchObject({
      onlineCount: 200,
      status: 'online',
    });
    g.live.nodes.set('ember', [
      { nodeId: 'a', onlineCount: 1, tickP99Ms: 90, draining: false, updatedAt: now },
    ]);
    expect((await g.game.shards.card('ember', anon)).status).toBe('degraded');
    g.live.nodes.set('ember', [
      { nodeId: 'a', onlineCount: 1, tickP99Ms: 9, draining: true, updatedAt: now },
    ]);
    expect((await g.game.shards.card('ember', anon)).status).toBe('draining');
    expect((await g.game.shards.card('local-dev', anon)).status).toBe('offline');
  });

  it('загрузка 85 %, полный шард и буфер персонала', async () => {
    const g = await gameHarness();
    g.live.online('ember', g.h.clock.utc(), { onlineCount: 850 });
    expect((await g.game.shards.card('ember', anon)).load).toBe('high');
    g.live.online('ember', g.h.clock.utc(), { onlineCount: 1200 });
    const p = await g.player();
    expect(await g.game.shards.card('ember', { principal: p, protocol: null })).toMatchObject({
      load: 'full',
      canEnter: false,
      entryBlockedReason: 'full',
    });
    const gm = await g.staff('game-master');
    expect((await g.game.shards.card('ember', { principal: gm, protocol: null })).canEnter).toBe(
      true,
    );
  });

  it('обслуживание с ETA, вход ведущего, дренаж, событие', async () => {
    const g = await gameHarness();
    const admin = await g.staff('administrator');
    const etaAt = new Date(g.h.clock.utc() + 3_600_000).toISOString();
    const card = await g.game.shards.setStatus(
      admin,
      'ember',
      { status: 'maintenance', etaAt, message: 'обновление' },
      META,
    );
    expect(card).toMatchObject({
      status: 'maintenance',
      maintenance: { etaAt, message: 'обновление' },
    });
    const gm = await g.staff('game-master');
    const mod = await g.staff('moderator');
    expect((await g.game.shards.card('ember', { principal: gm, protocol: null })).canEnter).toBe(
      true,
    );
    expect((await g.game.shards.card('ember', { principal: mod, protocol: null })).canEnter).toBe(
      false,
    );
    await g.game.shards.setStatus(admin, 'ember', { status: 'draining' }, META);
    expect(
      (await g.game.shards.card('ember', { principal: gm, protocol: null })).entryBlockedReason,
    ).toBe('draining');
    await g.h.flush();
    expect(g.h.events.of('shard.ember.status_changed')).toHaveLength(2);
    await rejects(
      g.game.shards.setStatus(admin, 'nope', { status: 'normal' }, META),
      'SHARD_NOT_FOUND',
    );
  });

  it('версии протокола', async () => {
    const g = await gameHarness();
    const protocol = g.game.shards.protocol('1.2.0');
    expect((await g.game.shards.card('ember', { principal: null, protocol })).compatible).toBe(
      true,
    );
    expect(
      (
        await g.game.shards.card('ember', {
          principal: null,
          protocol: g.game.shards.protocol('0.9.0'),
        })
      ).compatible,
    ).toBe(false);
    expect(g.game.shards.protocol(undefined)).toBeNull();
    expect(() => g.game.shards.protocol('latest')).toThrow(
      expect.objectContaining({ code: 'SHARD_PROTOCOL_HEADER_INVALID' }),
    );
  });

  it('ETag стабилен; при недоступном Valkey статус unknown', async () => {
    const g = await gameHarness();
    const a = await g.game.shards.list(anon);
    const b = await g.game.shards.list(anon);
    expect(a.etag).toBe(b.etag);
    g.live.failing = true;
    const degraded = await g.game.shards.list(anon);
    expect(degraded.degraded).toBe(true);
    expect(degraded.items.every((i) => i.status === 'unknown')).toBe(true);
  });

  it('администрирование: создание, запрет смены правил с героями, права', async () => {
    const g = await gameHarness();
    const admin = await g.staff('administrator');
    const created = await g.game.shards.create(
      admin,
      { id: 'frost', name: 'Иней', region: 'eu', preset: 'standard' },
      META,
    );
    expect(created).toMatchObject({ id: 'frost', status: 'offline' });
    await rejects(
      g.game.shards.create(
        admin,
        { id: 'frost', name: 'x', region: 'eu', preset: 'standard' },
        META,
      ),
      'SHARD_ALREADY_EXISTS',
    );
    await rejects(
      g.game.shards.create(
        admin,
        { id: 'bad', name: 'x', region: 'eu', preset: 'standard', protocolRange: 'всё' },
        META,
      ),
      'SHARD_VALIDATION_FAILED',
    );
    await rejects(
      g.game.shards.create(
        admin,
        { id: 'bad', name: 'x', region: 'eu', preset: 'proving', startCities: ['lad'] },
        META,
      ),
      'SHARD_VALIDATION_FAILED',
    );
    await rejects(
      g.game.shards.create(
        admin,
        {
          id: 'bad',
          name: 'x',
          region: 'eu',
          preset: 'standard',
          rulesetOverride: { creation: { statPool: 999 } },
        },
        META,
      ),
      'SHARD_VALIDATION_FAILED',
    );
    await rejects(
      g.game.shards.create(
        admin,
        {
          id: 'bad',
          name: 'x',
          region: 'eu',
          preset: 'standard',
          softCapacity: 5,
          hardCapacity: 1,
        },
        META,
      ),
      'SHARD_VALIDATION_FAILED',
    );
    expect(
      (
        await g.game.shards.update(
          admin,
          'frost',
          { preset: 'proving', startCities: ['proving-camp'] },
          META,
        )
      ).preset,
    ).toBe('proving');
    const p = await g.player();
    await g.hero(p);
    await rejects(
      g.game.shards.update(
        admin,
        'ember',
        { preset: 'proving', startCities: ['proving-camp'] },
        META,
      ),
      'SHARD_RULES_LOCKED',
      409,
    );
    expect(
      (await g.game.shards.update(admin, 'ember', { characterSlots: 3 }, META)).characterSlots,
    ).toBe(3);
    await rejects(g.game.shards.update(admin, 'nope', {}, META), 'SHARD_NOT_FOUND');
    const gm = await g.staff('game-master');
    await rejects(
      g.game.shards.create(gm, { id: 'x1', name: 'x', region: 'eu', preset: 'standard' }, META),
      'RBAC_INSUFFICIENT_PERMISSION',
      403,
    );
  });
});
