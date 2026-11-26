import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  makeEntityId,
  type AccessLevel,
} from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { PartitionCore } from './partition.js';
import { Scheduler } from './scheduler.js';
import {
  CLOSE,
  CloseError,
  SessionManager,
  type ClientLink,
  type HeroRecord,
  type HeroSave,
  type SessionPorts,
  type SessionRecord,
  type TicketClaims,
} from './session.js';

const DELAY = 120_000;

class FakeClient implements ClientLink {
  static n = 0;
  readonly id = `c${FakeClient.n++}`;
  readonly messages: [string, unknown][] = [];
  closed: { code: number; reason: string } | null = null;
  send(type: string, payload: unknown) {
    this.messages.push([type, payload]);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  token(): string {
    return (
      this.messages.filter(([t]) => t === 'session:reconnect_token').at(-1)?.[1] as {
        token: string;
      }
    ).token;
  }
}

async function setup() {
  const scheduler = new Scheduler();
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: 256 });
  await allocator.ready();
  const partition = new PartitionCore({
    partitionId: 'dawn-0',
    realm: { key: 'dawn', width: 4096, height: 4096 },
    bounds: { minX: 0, minY: 0, maxX: 4095, maxY: 4095 },
    allocator,
    hardCapacity: 2,
    staffBuffer: 1,
  });
  partition.hydrate([]);
  const tickets = new Map<string, TicketClaims>();
  const heroes = new Map<string, HeroRecord>();
  const saves: [string, HeroSave][] = [];
  const records = new Map<string, SessionRecord>();
  const published: [string, Record<string, unknown>][] = [];
  const warnings: string[] = [];
  let tokenN = 0;
  const safe = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
  const ports: SessionPorts = {
    redeem: async (t) => {
      const claims = tickets.get(t);
      tickets.delete(t);
      return claims ? { ok: true, claims } : { ok: false };
    },
    loadHero: async (id) => heroes.get(id) ?? null,
    saveHero: async (id, save) => void saves.push([id, save]),
    claim: async (account, record) => {
      const cur = records.get(account);
      if (cur && cur.characterId !== record.characterId) return cur;
      records.set(account, record);
      return 'claimed';
    },
    updateSession: async (account, record) => void records.set(account, record),
    release: async (account, sessionId) => {
      if (records.get(account)?.sessionId === sessionId) records.delete(account);
    },
    resolveSpawn: (_r, x, y) => (x === 666 ? { x: 667, y, h: 0 } : null),
    isSafeZone: (_r, x, y) => x >= safe.minX && x <= safe.maxX && y >= safe.minY && y <= safe.maxY,
    publish: (subject, payload) => void published.push([subject, payload]),
    newToken: () => `tok${tokenN++}`,
    warn: (m) => void warnings.push(m),
  };
  const sessions = new SessionManager(partition, scheduler, ports, {
    nodeId: 'n1',
    roomId: 'dawn-world',
    logoutDelayMs: DELAY,
  });
  let heroN = 0;
  const ticket = (
    account: string,
    character: string,
    over: Partial<TicketClaims> = {},
    level: AccessLevel = 'player',
  ) => {
    const token = `t${tickets.size}-${account}-${character}-${Math.random()}`;
    const entity = makeEntityId('hero', ++heroN);
    if (!heroes.has(character))
      heroes.set(character, {
        status: 'active',
        realm: 'dawn',
        x: 50,
        y: 50,
        h: 0,
        vitals: { health: 84, verve: 64, resonance: 56 },
      });
    tickets.set(token, {
      accountId: account,
      characterId: character,
      entityId: entity,
      name: character,
      accessLevel: level,
      effectiveLevel: level,
      realm: 'dawn',
      x: 50,
      y: 50,
      h: 0,
      takeover: false,
      ...over,
    });
    return token;
  };
  const advanceMs = (ms: number) => scheduler.advance(Math.round(ms / scheduler.tickMs));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    scheduler,
    partition,
    sessions,
    ports,
    tickets,
    heroes,
    saves,
    records,
    published,
    warnings,
    ticket,
    advanceMs,
    flush,
  };
}

describe('runtime/session-lifecycle', () => {
  it('вход: доверенные атрибуты, ресурсы, событие; повтор билета — 4101', async () => {
    const t = await setup();
    const token = t.ticket('acc', 'A');
    const c = new FakeClient();
    const s = await t.sessions.join(c, token);
    expect(s).toMatchObject({
      accountId: 'acc',
      characterId: 'A',
      accessLevel: 'player',
      state: 'ONLINE',
    });
    expect(c.messages.map(([type]) => type)).toEqual(['session:reconnect_token', 'session:ready']);
    expect(t.partition.get(s.entityId)?.placement).toEqual({ kind: 'world', x: 50, y: 50, h: 0 });
    expect(t.published.map(([sub]) => sub)).toEqual(['session.entered']);
    expect(t.records.get('acc')).toMatchObject({ characterId: 'A', state: 'online' });
    await expect(t.sessions.join(new FakeClient(), token)).rejects.toMatchObject({
      code: CLOSE.INVALID_TICKET,
    });
  });

  it('точка появления исправляется; статусы героя закрывают вход; партиция загружается', async () => {
    const t = await setup();
    const s = await t.sessions.join(new FakeClient(), t.ticket('acc', 'A', { x: 666 }));
    expect(t.partition.get(s.entityId)?.placement).toMatchObject({ x: 667 });
    expect(t.warnings).toHaveLength(1);
    for (const [status, code] of [
      ['locked', CLOSE.CHARACTER_LOCKED],
      ['rename_required', CLOSE.CHARACTER_FORCE_RENAME],
      ['pending_deletion', CLOSE.CHARACTER_NOT_FOUND],
    ] as const) {
      const token = t.ticket(`acc-${status}`, `H-${status}`);
      t.heroes.set(`H-${status}`, { ...(t.heroes.get(`H-${status}`) as HeroRecord), status });
      await expect(t.sessions.join(new FakeClient(), token)).rejects.toMatchObject({ code });
    }
    const loading = await setup();
    loading.partition.state = 'LOADING';
    await expect(
      loading.sessions.join(new FakeClient(), loading.ticket('a', 'B')),
    ).rejects.toMatchObject({ code: CLOSE.PARTITION_NOT_READY });
  });

  it('перехват: старое соединение 4104, та же сущность; во время задержки выхода — таймер отменён', async () => {
    const t = await setup();
    const c1 = new FakeClient();
    const s = await t.sessions.join(c1, t.ticket('acc', 'A'));
    t.partition.move(s.entityId, 60, 61, 0);
    const c2 = new FakeClient();
    const again = await t.sessions.join(c2, t.ticket('acc', 'A'));
    expect(c1.closed?.code).toBe(CLOSE.DUPLICATE_SESSION);
    expect(again).toBe(s);
    expect(t.partition.get(s.entityId)?.placement).toMatchObject({ x: 60, y: 61 });
    t.sessions.logout(s);
    expect(s.state).toBe('LOGOUT_DELAY');
    t.advanceMs(30_000);
    const c3 = new FakeClient();
    await t.sessions.join(c3, t.ticket('acc', 'A'));
    expect(s.state).toBe('ONLINE');
    expect(t.records.get('acc')?.state).toBe('online');
    t.advanceMs(DELAY);
    expect(t.partition.get(s.entityId)).toBeDefined();
  });

  it('второй герой аккаунта — 4124, в том числе во время задержки выхода', async () => {
    const t = await setup();
    const c = new FakeClient();
    const a = await t.sessions.join(c, t.ticket('acc', 'A'));
    await expect(t.sessions.join(new FakeClient(), t.ticket('acc', 'B'))).rejects.toMatchObject({
      code: CLOSE.ACCOUNT_ALREADY_IN_WORLD,
    });
    t.sessions.disconnect(c.id);
    t.advanceMs(40_000);
    await expect(t.sessions.join(new FakeClient(), t.ticket('acc', 'B'))).rejects.toMatchObject({
      code: CLOSE.ACCOUNT_ALREADY_IN_WORLD,
    });
    t.advanceMs(DELAY);
    await t.flush();
    expect(a.state).toBe('EXITED');
    expect((await t.sessions.join(new FakeClient(), t.ticket('acc', 'B'))).characterId).toBe('B');
  });

  it('переподключение в окне; после окна — LOGOUT_DELAY с остатком; плохой токен — 4101', async () => {
    const t = await setup();
    const c = new FakeClient();
    const s = await t.sessions.join(c, t.ticket('acc', 'A'));
    const token = c.token();
    t.sessions.disconnect(c.id);
    expect(s.state).toBe('RECONNECT_WINDOW');
    t.advanceMs(12_000);
    expect(() => t.sessions.reconnect(new FakeClient(), 'acc', s.sessionId, 'чужой')).toThrow(
      CloseError,
    );
    const c2 = new FakeClient();
    t.sessions.reconnect(c2, 'acc', s.sessionId, token);
    expect(s.state).toBe('ONLINE');
    expect(t.partition.get(s.entityId)).toBeDefined();
    expect(c2.token()).not.toBe(token);
    expect(() => t.sessions.reconnect(new FakeClient(), 'acc', s.sessionId, token)).toThrow(
      expect.objectContaining({ code: CLOSE.INVALID_TICKET }),
    );
    t.sessions.disconnect(c2.id);
    t.advanceMs(30_000);
    expect(s.state).toBe('LOGOUT_DELAY');
    expect(() => t.sessions.reconnect(new FakeClient(), 'acc', s.sessionId, c2.token())).toThrow(
      CloseError,
    );
    t.advanceMs(89_950);
    await t.flush();
    expect(t.partition.get(s.entityId)).toBeDefined();
    t.advanceMs(50);
    await t.flush();
    expect(t.partition.get(s.entityId)).toBeUndefined();
  });

  it('выход вне безопасной зоны: 4122 delayed, исчезновение ровно через задержку, сохранение', async () => {
    const t = await setup();
    const c = new FakeClient();
    const s = await t.sessions.join(c, t.ticket('acc', 'A'));
    t.sessions.logout(s);
    expect(c.closed).toEqual({
      code: CLOSE.LOGOUT_COMPLETE,
      reason: JSON.stringify({ delayed: true }),
    });
    t.advanceMs(DELAY - 50);
    await t.flush();
    expect(t.partition.get(s.entityId)).toBeDefined();
    t.advanceMs(50);
    await t.flush();
    expect(t.partition.get(s.entityId)).toBeUndefined();
    expect(t.saves).toEqual([
      [
        'A',
        {
          realm: 'dawn',
          x: 50,
          y: 50,
          h: 0,
          vitals: { health: 84, verve: 64, resonance: 56 },
          playtimeDeltaS: 0,
        },
      ],
    ]);
    expect(t.records.has('acc')).toBe(false);
    expect(t.published.at(-1)?.[0]).toBe('session.exited');
  });

  it('мгновенный выход: безопасная зона, персонал; политика боя — полная задержка', async () => {
    const t = await setup();
    const c = new FakeClient();
    const s = await t.sessions.join(c, t.ticket('acc', 'A', { x: 105, y: 105 }));
    t.sessions.logout(s);
    await t.flush();
    expect(c.closed?.reason).toBe(JSON.stringify({ delayed: false }));
    expect(t.partition.get(s.entityId)).toBeUndefined();
    const gm = await t.sessions.join(new FakeClient(), t.ticket('gm', 'G', {}, 'game-master'));
    t.sessions.logout(gm);
    await t.flush();
    expect(gm.state).toBe('EXITED');
    const fighting = new Set<number>();
    t.sessions.addLogoutPolicy((id) => fighting.has(id));
    const fc = new FakeClient();
    const f = await t.sessions.join(fc, t.ticket('f', 'F', { x: 105, y: 105 }));
    fighting.add(f.entityId);
    t.sessions.logout(f);
    expect(f.state).toBe('LOGOUT_DELAY');
    expect(fc.messages.map(([type]) => type)).toContain('session:logout_pending');
  });

  it('бан — 4103 и немедленный выход; переименование — 4126 и задержка; смена уровня на лету', async () => {
    const t = await setup();
    const c = new FakeClient();
    const s = await t.sessions.join(c, t.ticket('acc', 'A'));
    t.sessions.logout(s);
    await t.sessions.securityEvent('acc', 'banned');
    expect(s.state).toBe('EXITED');
    const c2 = new FakeClient();
    const r = await t.sessions.join(c2, t.ticket('r', 'R'));
    await t.sessions.securityEvent('r', 'rename_required', 'другой');
    expect(r.state).toBe('ONLINE');
    await t.sessions.securityEvent('r', 'rename_required', 'R');
    expect(c2.closed?.code).toBe(CLOSE.CHARACTER_FORCE_RENAME);
    expect(r.state).toBe('LOGOUT_DELAY');
    t.advanceMs(DELAY);
    await t.flush();
    expect(r.state).toBe('EXITED');
    const staff = await t.sessions.join(new FakeClient(), t.ticket('st', 'S', {}, 'game-master'));
    await t.sessions.accessChanged('st', 'game-master', 'player', false);
    expect(staff).toMatchObject({ state: 'ONLINE', effectiveLevel: 'player' });
    const lc = new FakeClient();
    await t.sessions.join(lc, t.ticket('l', 'L'));
    await t.sessions.securityEvent('l', 'locked');
    expect(lc.closed?.code).toBe(CLOSE.CHARACTER_LOCKED);
    await t.sessions.securityEvent('nobody', 'banned');
  });

  it('обслуживание и остановка', async () => {
    const t = await setup();
    const pc = new FakeClient();
    await t.sessions.join(pc, t.ticket('p', 'P'));
    const gc = new FakeClient();
    await t.sessions.join(gc, t.ticket('g', 'G', {}, 'game-master'));
    expect(await t.sessions.maintenance()).toBe(1);
    expect(pc.closed?.code).toBe(CLOSE.SHARD_MAINTENANCE);
    await t.sessions.accessChanged('g', 'moderator', 'moderator', true);
    expect(gc.closed?.code).toBe(CLOSE.SHARD_MAINTENANCE);
    const sc = new FakeClient();
    await t.sessions.join(sc, t.ticket('s', 'S'));
    await t.sessions.shutdown();
    expect(sc.closed?.code).toBe(CLOSE.SERVER_SHUTDOWN);
    expect(t.sessions.count).toBe(0);
  });

  it('время игры только в ONLINE', async () => {
    const t = await setup();
    const c = new FakeClient();
    await t.sessions.join(c, t.ticket('acc', 'A'));
    t.advanceMs(600_000);
    t.sessions.disconnect(c.id);
    t.advanceMs(DELAY);
    await t.flush();
    expect(t.saves.at(-1)?.[1].playtimeDeltaS).toBe(600);
    const c2 = new FakeClient();
    const s = await t.sessions.join(c2, t.ticket('acc', 'A', { x: 105, y: 105 }));
    t.advanceMs(240_000);
    t.sessions.disconnect(c2.id);
    t.advanceMs(20_000);
    const c3 = new FakeClient();
    t.sessions.reconnect(c3, 'acc', s.sessionId, c2.token());
    t.advanceMs(60_000);
    t.sessions.logout(s);
    await t.flush();
    expect(t.saves.at(-1)?.[1].playtimeDeltaS).toBe(300);
  });

  it('бездействие: игрок — 4109 после 30 минут, действие сбрасывает отсчёт; персонал не отключается', async () => {
    const t = await setup();
    const c = new FakeClient();
    const s = await t.sessions.join(c, t.ticket('acc', 'A', { x: 105, y: 105 }));
    const ac = new FakeClient();
    await t.sessions.join(ac, t.ticket('adm', 'D', {}, 'administrator'));
    t.advanceMs(29 * 60_000);
    t.sessions.touch(s);
    t.advanceMs(29 * 60_000);
    expect(c.closed).toBeNull();
    t.advanceMs(60_000);
    await t.flush();
    expect(c.closed?.code).toBe(CLOSE.IDLE_TIMEOUT);
    expect(ac.closed).toBeNull();
  });

  it('ёмкость: игрок — 4106, персонал — в буфер', async () => {
    const t = await setup();
    await t.sessions.join(new FakeClient(), t.ticket('a', 'A'));
    await t.sessions.join(new FakeClient(), t.ticket('b', 'B'));
    await expect(t.sessions.join(new FakeClient(), t.ticket('c', 'C'))).rejects.toMatchObject({
      code: CLOSE.PARTITION_FULL,
    });
    expect(
      (await t.sessions.join(new FakeClient(), t.ticket('g', 'G', {}, 'game-master'))).state,
    ).toBe('ONLINE');
  });

  it('handoff: подтверждение выгружает без задержки и без освобождения записи; отказ — назад в ONLINE', async () => {
    const t = await setup();
    const s = await t.sessions.join(new FakeClient(), t.ticket('acc', 'A'));
    expect(await t.sessions.beginHandoff(s, async () => false)).toBe(false);
    expect(s.state).toBe('ONLINE');
    const pending = t.sessions.beginHandoff(s, () => new Promise(() => undefined));
    t.advanceMs(5_000);
    expect(await pending).toBe(false);
    expect(s.state).toBe('ONLINE');
    expect(await t.sessions.beginHandoff(s, async () => true)).toBe(true);
    expect(t.partition.get(s.entityId)).toBeUndefined();
    expect(t.records.has('acc')).toBe(true);
  });
});
