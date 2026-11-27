import type { HeroSnapshot } from '@duskmarch/db/world';
import { describe, expect, it } from 'vitest';
import { gameHarness } from '../game/game-harness.test-helper.js';
import type { IdentityServices } from '../identity/core/index.js';
import { RestoreAdmin, type RestoreStore } from './restore.js';

const META = { ip: '1.1.1.1', userAgent: 't' };

function snapshot(characterId: string, x: number): HeroSnapshot {
  return {
    character: {
      id: characterId,
      entityId: 0x20000001,
      realm: 'dawn',
      x,
      y: 10,
      h: 0,
      stats: {},
      appearance: {},
      health: null,
      verve: null,
      resonance: null,
    },
    skills: [{ skill: 'edge', tenths: 300 }],
    items: [],
  };
}

async function bench(opts: { source?: boolean } = {}) {
  const g = await gameHarness();
  const owner = await g.player();
  const created = (await g.hero(owner)) as { id: string };
  const calls: string[] = [];
  const store: RestoreStore = {
    hero: async (_s, id) => snapshot(id, 99),
    character: async (_s, id) => {
      const c = await g.store.findCharacter(id);
      return c ? { accountId: c.accountId, status: c.status } : null;
    },
    ownerOf: async () => ({ characterId: created.id, accountId: owner.accountId }),
    restoreHero: async (_s, target) => {
      calls.push(`hero:${target.character.x}`);
      return { operationId: 'op-1', txId: 'tx-1' };
    },
    restoreItem: async (_s, itemId, _to, mode) => {
      calls.push(`item:${itemId}:${mode}`);
      return { operationId: 'op-2', itemId, previousOwner: null };
    },
    undo: async (_s, id) => {
      calls.push(`undo:${id}`);
      return { operationId: 'op-3' };
    },
  };
  let now = 1_000_000;
  const admin = new RestoreAdmin(
    g.h as unknown as IdentityServices,
    g.game,
    store,
    opts.source === false ? null : { heroAt: async (_s, id) => snapshot(id, 10) },
    () => now,
    async () => {
      now += 250;
      g.live.sessions.delete(`ember:${owner.accountId}`);
    },
  );
  const fresh = async (principal: Awaited<ReturnType<typeof g.staff>>) => {
    await g.h.security.reauth(principal, { password: g.PASSWORD });
    return principal;
  };
  return {
    g,
    admin,
    owner,
    characterId: created.id,
    calls,
    fresh,
    advance: (ms: number) => (now += ms),
  };
}

describe('persistence/backup-and-restore: точечный откат героя', () => {
  it('предпросмотр — ведущий; без клона — PERSIST_PITR_WINDOW_UNAVAILABLE', async () => {
    const b = await bench();
    const gm = await b.g.staff('game-master');
    const p = await b.admin.preview(gm, META, 'ember', b.characterId, new Date());
    expect(p.diff).toMatchObject({ character: ['x'] });
    expect(p.previewToken).toMatch(/^[\w-]+\.[\w-]+$/);
    const none = await bench({ source: false });
    const gm2 = await none.g.staff('game-master');
    await expect(
      none.admin.preview(gm2, META, 'ember', none.characterId, new Date()),
    ).rejects.toMatchObject({ code: 'PERSIST_PITR_WINDOW_UNAVAILABLE' });
    const player = await b.g.player();
    await expect(
      b.admin.preview(player, META, 'ember', b.characterId, new Date()),
    ).rejects.toMatchObject({ code: 'RBAC_INSUFFICIENT_PERMISSION' });
  });

  it('применение: свежий второй фактор, администратор, действующий токен', async () => {
    const b = await bench();
    const admin = await b.g.staff('administrator');
    const p = await b.admin.preview(admin, META, 'ember', b.characterId, new Date());
    const input = {
      characterId: b.characterId,
      previewToken: p.previewToken,
      kickIfOnline: false,
      reason: 'Возврат после взлома аккаунта',
    };
    b.g.h.clock.advance(11 * 60_000);
    await expect(b.admin.applyCharacter(admin, META, 'ember', input)).rejects.toMatchObject({
      code: 'AUTH_REAUTH_REQUIRED',
    });
    const gm = await b.fresh(await b.g.staff('game-master'));
    await expect(b.admin.applyCharacter(gm, META, 'ember', input)).rejects.toMatchObject({
      code: 'RBAC_INSUFFICIENT_PERMISSION',
    });
    await b.fresh(admin);
    await expect(
      b.admin.applyCharacter(admin, META, 'ember', {
        ...input,
        previewToken: `${p.previewToken}x`,
      }),
    ).rejects.toMatchObject({ code: 'PERSIST_ROLLBACK_PREVIEW_REQUIRED' });
    expect(await b.admin.applyCharacter(admin, META, 'ember', input)).toEqual({
      operationId: 'op-1',
      txId: 'tx-1',
    });
    expect(b.calls).toEqual(['hero:10']);
    await expect(b.admin.applyCharacter(admin, META, 'ember', input)).rejects.toMatchObject({
      code: 'PERSIST_ROLLBACK_PREVIEW_REQUIRED',
    });
    const late = await b.admin.preview(admin, META, 'ember', b.characterId, new Date());
    b.advance(16 * 60_000);
    await expect(
      b.admin.applyCharacter(admin, META, 'ember', { ...input, previewToken: late.previewToken }),
    ).rejects.toMatchObject({ code: 'PERSIST_ROLLBACK_PREVIEW_REQUIRED' });
  });

  it('герой в мире: без разрешения выгнать — отказ; с разрешением — блокировка, выход, откат, снятие блокировки', async () => {
    const b = await bench();
    const admin = await b.fresh(await b.g.staff('administrator'));
    const p = await b.admin.preview(admin, META, 'ember', b.characterId, new Date());
    b.g.live.sessions.set(`ember:${b.owner.accountId}`, { characterId: b.characterId } as never);
    const input = {
      characterId: b.characterId,
      previewToken: p.previewToken,
      kickIfOnline: false,
      reason: 'Возврат после взлома аккаунта',
    };
    await expect(b.admin.applyCharacter(admin, META, 'ember', input)).rejects.toMatchObject({
      code: 'PERSIST_CHARACTER_ONLINE_BLOCKED',
    });
    expect(
      await b.admin.applyCharacter(admin, META, 'ember', { ...input, kickIfOnline: true }),
    ).toMatchObject({ operationId: 'op-1' });
    expect((await b.g.store.findCharacter(b.characterId))?.status).toBe('active');
  });

  it('предмет и отмена: владелец в мире при изъятии — отказ; иначе — операция', async () => {
    const b = await bench();
    const admin = await b.fresh(await b.g.staff('administrator'));
    const req = {
      itemId: 0x60008822,
      toCharacterId: b.characterId,
      mode: 'reclaim_original' as const,
      reason: 'Возврат украденного предмета',
    };
    expect(await b.admin.restoreItem(admin, META, 'ember', req)).toMatchObject({
      operationId: 'op-2',
    });
    expect(await b.admin.undo(admin, META, 'ember', 'op-2', 'Ошибочное восстановление')).toEqual({
      operationId: 'op-3',
    });
    expect(b.calls).toEqual(['item:1610647586:reclaim_original', 'undo:op-2']);
  });
});
