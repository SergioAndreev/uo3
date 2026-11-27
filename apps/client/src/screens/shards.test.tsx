import { describe, expect, it } from 'vitest';
import { click, fakeApi, settle, shell } from '../testing/shell.js';
import { packCompatible, type ShardSummary } from './shards.js';

const summary = (over: Partial<ShardSummary> = {}): ShardSummary => ({
  id: 'ember',
  name: 'Угли',
  region: 'eu',
  realms: [
    { key: 'dawn', name: 'Заря', pvp: 'consent' },
    { key: 'dusk', name: 'Марь', pvp: 'open' },
  ],
  characterSlots: 5,
  status: 'online',
  load: 'medium',
  onlineCount: 120,
  myCharacters: 2,
  canEnter: true,
  ...over,
});

const card = (over: Record<string, unknown> = {}) => ({
  ...summary(),
  rules: {
    preset: 'standard',
    caps: { statTotal: 240, skillTotalTenths: 6_000 },
    gameHourMs: 240_000,
    creationOpen: true,
  },
  maintenance: null,
  ...over,
});

function visibility() {
  let visible = true;
  const ls = new Set<() => void>();
  return {
    visible: () => visible,
    subscribe: (l: () => void) => {
      ls.add(l);
      return () => void ls.delete(l);
    },
    set: (v: boolean) => {
      visible = v;
      ls.forEach((l) => l());
    },
  };
}

describe('client/login-and-character-select: шарды', () => {
  it('опрос с If-None-Match; 304 не сбрасывает выбор; скрытая вкладка — пауза', async () => {
    const api = fakeApi({
      'GET /api/v1/shards': (c) =>
        c.headers.get('if-none-match') === '"v1"'
          ? { status: 304 }
          : {
              status: 200,
              body: [summary(), summary({ id: 'frost', name: 'Иней' })],
              headers: { etag: '"v1"' },
            },
      'GET /api/v1/shards/:id': () => ({ status: 200, body: card() }),
    });
    const vis = visibility();
    const s = await shell('/shards', api, {
      signedIn: true,
      services: { pollMs: 20, visibility: vis },
    });
    await click(s.host, 'Угли');
    await settle(10);
    const lists = () => api.calls.filter((c) => c.path === '/api/v1/shards').length;
    expect(lists()).toBeGreaterThanOrEqual(2);
    expect(
      api.calls
        .filter((c) => c.path === '/api/v1/shards')
        .slice(1)
        .every((c) => c.headers.get('if-none-match') === '"v1"'),
    ).toBe(true);
    expect(s.host.querySelector('[data-shard=ember]')?.getAttribute('aria-selected')).toBe('true');
    vis.set(false);
    const paused = lists();
    await settle(10);
    expect(lists()).toBe(paused);
    vis.set(true);
    await settle(2);
    expect(lists()).toBeGreaterThan(paused);
  });

  it('ручное обновление не чаще раза в 3 с', async () => {
    let t = 1_000;
    const api = fakeApi({ 'GET /api/v1/shards': () => ({ status: 200, body: [summary()] }) });
    const s = await shell('/shards', api, {
      signedIn: true,
      services: { pollMs: 1_000_000, now: () => t },
    });
    const before = api.calls.length;
    await click(s.host, 'Обновить');
    await click(s.host, 'Обновить');
    expect(api.calls.length).toBe(before + 1);
    t += 3_000;
    await click(s.host, 'Обновить');
    expect(api.calls.length).toBe(before + 2);
  });

  it('подробности: правила, обслуживание; заполненный шард — вход закрыт; метка персонала', async () => {
    const api = fakeApi({
      'GET /api/v1/shards': () => ({
        status: 200,
        body: [
          summary({ canEnter: false, entryBlockedReason: 'SHARD_FULL', load: 'full' }),
          summary({ id: 'vault', name: 'Хранилище', staffOnly: true }),
        ],
      }),
      'GET /api/v1/shards/:id': () => ({
        status: 200,
        body: card({
          canEnter: false,
          entryBlockedReason: 'SHARD_FULL',
          status: 'maintenance',
          maintenance: { etaAt: '2026-11-27T12:00:00.000Z', message: 'Обновление мира' },
        }),
      }),
    });
    const s = await shell('/shards', api, { signedIn: true, services: { pollMs: 1_000_000 } });
    expect(s.host.querySelector('[data-shard=vault] [data-testid=staff-only]')?.textContent).toBe(
      'Только персонал',
    );
    await click(s.host, 'Угли');
    await settle(5);
    const details = s.host.querySelector('[data-testid=shard-details]');
    expect(details?.querySelector('[data-testid=rules]')?.textContent).toContain(
      'Кап характеристик 240 · кап навыков 600.0 · игровой час — 4 мин',
    );
    expect(details?.textContent).toContain('Обновление мира');
    expect(details?.textContent).toContain('Шард заполнен');
    expect(
      (
        [...(details?.querySelectorAll('button') ?? [])].find(
          (b) => b.textContent === 'К героям',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('пакет ассетов: устаревший — предложение обновить; подходящий — вход к героям', async () => {
    expect(packCompatible(null, undefined)).toBe(true);
    expect(
      packCompatible(
        { id: 'pack.duskmarch-core', version: '1.2.0' },
        { id: 'pack.duskmarch-core', minVersion: '1.4.0' },
      ),
    ).toBe(false);
    expect(
      packCompatible(
        { id: 'pack.duskmarch-core', version: '1.10.0' },
        { id: 'pack.duskmarch-core', minVersion: '1.4.0' },
      ),
    ).toBe(true);
    expect(
      packCompatible(
        { id: 'pack.other', version: '9.0.0' },
        { id: 'pack.duskmarch-core', minVersion: '1.0.0' },
      ),
    ).toBe(false);
    let version = '1.2.0';
    const api = fakeApi({
      'GET /api/v1/shards': () => ({
        status: 200,
        body: [summary({ assetPack: { id: 'pack.duskmarch-core', minVersion: '1.4.0' } })],
      }),
      'GET /api/v1/shards/:id': () => ({
        status: 200,
        body: card({ assetPack: { id: 'pack.duskmarch-core', minVersion: '1.4.0' } }),
      }),
    });
    const s = await shell('/shards', api, {
      signedIn: true,
      services: {
        pollMs: 1_000_000,
        assets: { active: () => ({ id: 'pack.duskmarch-core', version }) },
      },
    });
    await click(s.host, 'Угли');
    await settle(5);
    expect(s.host.querySelector('a[href^="/assets?returnTo="]')?.getAttribute('href')).toBe(
      '/assets?returnTo=%2Fshards%2Fember%2Fcharacters',
    );
    version = '1.4.0';
    await click(s.host, 'Обновить');
    await click(s.host, 'Угли');
    await click(s.host, 'К героям');
    expect(s.router.state.location.pathname).toBe('/shards/ember/characters');
  });
});
