import type { AccessLevel } from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import { HubCore, type HubClaims } from './hub.js';
import { Scheduler } from './scheduler.js';
import { CLOSE, type ClientLink } from './session.js';

class Client implements ClientLink {
  static n = 0;
  readonly id = `h${Client.n++}`;
  readonly messages: [string, unknown][] = [];
  closed: number | null = null;
  send(type: string, payload: unknown) {
    this.messages.push([type, payload]);
  }
  close(code: number) {
    this.closed = code;
  }
  of(type: string) {
    return this.messages.filter(([t]) => t === type).map(([, p]) => p);
  }
}

function setup() {
  const scheduler = new Scheduler();
  const tickets = new Map<string, HubClaims | 'world'>();
  const audit: string[] = [];
  let id = 0;
  const hub = new HubCore(scheduler, {
    redeem: async (t) => {
      const c = tickets.get(t);
      tickets.delete(t);
      return c && c !== 'world' ? { ok: true, claims: c } : { ok: false };
    },
    audit: (action) => void audit.push(action),
    newId: () => `a${id++}`,
  });
  hub.motd = 'Добро пожаловать на Угли';
  const ticket = (accountId: string, level: AccessLevel = 'player') => {
    const t = `t${Math.random()}`;
    tickets.set(t, {
      accountId,
      characterId: `c-${accountId}`,
      entityId: 1,
      accessLevel: level,
      effectiveLevel: level,
    });
    return t;
  };
  const enter = (
    accountId: string,
    realm = 'dawn',
    level: AccessLevel = 'player',
    stealth = false,
  ) =>
    hub.entered({
      accountId,
      characterId: `c-${accountId}`,
      entityId: 1,
      characterName: accountId,
      realm,
      partitionId: `${realm}-0`,
      accessLevel: level,
      effectiveLevel: level,
      stealth,
    });
  const ms = (n: number) => scheduler.advance(Math.ceil(n / 50));
  return { scheduler, hub, tickets, audit, ticket, enter, ms };
}

describe('runtime/shard-hub-room', () => {
  it('вход по hub-билету: MOTD и сводка; world-билет — 4101; второе соединение — 4104', async () => {
    const t = setup();
    const c1 = new Client();
    expect(await t.hub.join(c1, t.ticket('acc'))).toMatchObject({ accountId: 'acc' });
    expect(c1.of('hub:motd')).toEqual([{ text: 'Добро пожаловать на Угли' }]);
    expect(c1.of('hub:presence_summary')).toEqual([{ onlineCount: 0 }]);
    t.tickets.set('w', 'world');
    await expect(t.hub.join(new Client(), 'w')).rejects.toMatchObject({
      code: CLOSE.INVALID_TICKET,
    });
    const c2 = new Client();
    await t.hub.join(c2, t.ticket('acc'));
    expect(c1.closed).toBe(CLOSE.DUPLICATE_SESSION);
    expect(t.hub.connected('acc')).toBe(true);
    t.hub.leave(c2.id);
    expect(t.hub.connected('acc')).toBe(false);
  });

  it('присутствие: смена партиции, lingering, выход, сверка с упавшей партицией', () => {
    const t = setup();
    t.enter('a', 'dusk');
    t.enter('b', 'dawn');
    t.enter('a', 'dawn');
    expect(t.hub.query(['c-a', 'c-b', 'c-x'], 'player')).toEqual({
      'c-a': 'online',
      'c-b': 'online',
      'c-x': 'offline',
    });
    t.hub.lingering('a');
    expect(t.hub.query(['c-a'], 'player')).toEqual({ 'c-a': 'lingering' });
    t.hub.exited('a');
    expect(t.hub.visibleCount('player')).toBe(1);
    t.enter('c', 'dusk');
    expect(t.hub.reconcile(new Set(['dawn-0']))).toBe(1);
    expect(t.hub.visibleCount('player')).toBe(1);
  });

  it('сводка онлайна не чаще раза в секунду, без списков персонажей', async () => {
    const t = setup();
    const c = new Client();
    await t.hub.join(c, t.ticket('watcher'));
    t.ms(1_000);
    c.messages.length = 0;
    for (let i = 0; i < 150; i++) t.enter(`p${i}`);
    t.ms(200);
    t.ms(1_000);
    const summaries = c.of('hub:presence_summary');
    expect(summaries).toEqual([{ onlineCount: 150 }]);
    expect(c.messages.every(([type]) => type === 'hub:presence_summary')).toBe(true);
  });

  it('скрытность: игрок и помощник не видят; ведущий и выше видят; переход в player снимает', () => {
    const t = setup();
    for (let i = 0; i < 10; i++) t.enter(`p${i}`);
    t.enter('gm', 'dawn', 'game-master', true);
    expect(t.hub.visibleCount('player')).toBe(10);
    expect(t.hub.visibleCount('helper')).toBe(10);
    expect(t.hub.query(['c-gm'], 'helper')).toEqual({ 'c-gm': 'offline' });
    for (const level of ['game-master', 'administrator', 'owner'] as const) {
      expect(t.hub.query(['c-gm'], level)).toEqual({ 'c-gm': 'online' });
    }
    t.hub.levelsChanged('gm', 'game-master', 'player');
    expect(t.hub.visibleCount('player')).toBe(11);
    t.hub.setStealth('gm', true);
    expect(t.hub.visibleCount('player')).toBe(11);
  });

  it('объявления: область плана и персонала, проверка текста, закреплённые и MOTD новым', async () => {
    const t = setup();
    const dusk = new Client();
    const dawn = new Client();
    const staff = new Client();
    await t.hub.join(dusk, t.ticket('d'));
    await t.hub.join(dawn, t.ticket('w'));
    await t.hub.join(staff, t.ticket('s', 'helper'));
    t.enter('d', 'dusk');
    t.enter('w', 'dawn');
    t.hub.announce({
      severity: 'info',
      displayMode: 'chat',
      text: 'Туман над Марью',
      scope: { kind: 'realm', realm: 'dusk' },
      pinned: false,
      expiresAtMs: null,
    });
    t.hub.announce({
      severity: 'warning',
      displayMode: 'banner',
      text: 'Только персоналу',
      scope: { kind: 'staff_only' },
      pinned: false,
      expiresAtMs: null,
    });
    expect(dusk.of('hub:announcement')).toHaveLength(1);
    expect(dawn.of('hub:announcement')).toHaveLength(0);
    expect(staff.of('hub:announcement')).toHaveLength(1);
    for (const text of ['', ' ', 'я'.repeat(513)]) {
      expect(() =>
        t.hub.announce({
          severity: 'info',
          displayMode: 'chat',
          text,
          scope: { kind: 'all' },
          pinned: false,
          expiresAtMs: null,
        }),
      ).toThrow(expect.objectContaining({ code: 'HUB_ANNOUNCEMENT_INVALID' }));
    }
    const countdown = t.hub.announce({
      severity: 'shutdown_countdown',
      displayMode: 'both',
      text: 'Перезапуск через 60 секунд',
      scope: { kind: 'all' },
      pinned: true,
      expiresAtMs: t.scheduler.timeMs + 60_000,
    });
    expect(dawn.of('hub:announcement').at(-1)).toMatchObject({ severity: 'shutdown_countdown' });
    t.ms(20_000);
    const late = new Client();
    await t.hub.join(late, t.ticket('late'));
    expect(late.of('hub:announcement')).toEqual([countdown]);
    for (let i = 0; i < 24; i++)
      t.hub.announce({
        severity: 'info',
        displayMode: 'banner',
        text: `№${i}`,
        scope: { kind: 'all' },
        pinned: true,
        expiresAtMs: i < 12 ? t.scheduler.timeMs + 1 : null,
      });
    expect(t.hub.pinnedCount).toBe(20);
    t.ms(100);
    const fresh = new Client();
    await t.hub.join(fresh, t.ticket('fresh'));
    expect(fresh.of('hub:announcement').length).toBe(12);
  });

  it('ручные объявления: права, частота, аудит', () => {
    const t = setup();
    const msg = {
      severity: 'info' as const,
      displayMode: 'chat' as const,
      text: 'Событие у маяка',
      scope: { kind: 'all' as const },
      pinned: false,
      expiresAtMs: null,
    };
    for (const level of ['player', 'helper'] as const) {
      expect(() =>
        t.hub.staffAnnounce(
          {
            accountId: level,
            characterId: 'c',
            entityId: 1,
            accessLevel: level,
            effectiveLevel: level,
          },
          msg,
        ),
      ).toThrow(expect.objectContaining({ code: 'HUB_ANNOUNCEMENT_FORBIDDEN' }));
    }
    const gm = {
      accountId: 'gm',
      characterId: 'c',
      entityId: 1,
      accessLevel: 'game-master' as const,
      effectiveLevel: 'game-master' as const,
    };
    for (let i = 0; i < 10; i++) t.hub.staffAnnounce(gm, msg);
    expect(() => t.hub.staffAnnounce(gm, msg)).toThrow(
      expect.objectContaining({ code: 'HUB_ANNOUNCEMENT_RATE_LIMITED' }),
    );
    expect(t.audit.filter((a) => a === 'hub.announce')).toHaveLength(10);
    expect(t.audit.filter((a) => a === 'hub.announce.denied')).toHaveLength(2);
    t.ms(60_000);
    t.hub.staffAnnounce(gm, msg);
  });

  it('бан закрывает соединение 4103; обслуживание — неперсонал 4127; расширения', async () => {
    const t = setup();
    const p = new Client();
    const g = new Client();
    const b = new Client();
    await t.hub.join(p, t.ticket('p'));
    await t.hub.join(g, t.ticket('g', 'game-master'));
    await t.hub.join(b, t.ticket('b'));
    t.hub.disconnect('b', CLOSE.BANNED, 'бан');
    expect(b.closed).toBe(CLOSE.BANNED);
    t.hub.disconnect('nobody', CLOSE.BANNED, 'бан');
    expect(t.hub.maintenance()).toBe(1);
    expect(p.closed).toBe(CLOSE.SHARD_MAINTENANCE);
    expect(g.closed).toBeNull();
    const handled: unknown[] = [];
    t.hub.registerExtension('guild:say', {
      validate: (x) => typeof x === 'string' && x.length < 10,
      handle: (ctx, x) => handled.push([ctx.accountId, x]),
    });
    expect(t.hub.message(g.id, 'guild:say', 'привет')).toBe(true);
    expect(t.hub.message(g.id, 'guild:say', 42)).toBe(false);
    expect(t.hub.message(g.id, 'unknown', 'x')).toBe(false);
    expect(t.hub.message('ghost', 'guild:say', 'x')).toBe(false);
    expect(handled).toEqual([['g', 'привет']]);
  });
});
