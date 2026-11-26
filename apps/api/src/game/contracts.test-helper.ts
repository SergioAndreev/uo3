import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { shardRecord } from './game-harness.test-helper.js';
import type { CharacterRecord, GameStore } from './ports.js';

const T = Date.UTC(2026, 10, 26);

export const characterRecord = (
  accountId: string,
  over: Partial<CharacterRecord> = {},
): CharacterRecord => ({
  id: randomUUID(),
  shardId: 'ember',
  accountId,
  entityId: Math.floor(Math.random() * 1e8) + 1,
  slot: 0,
  name: 'Ясна',
  nameKey: 'ясна',
  status: 'active',
  stats: { might: 15, finesse: 30, will: 45 },
  skills: [
    { skill: 'heat', tenths: 500 },
    { skill: 'binding', tenths: 300 },
  ],
  appearance: { build: 'average', face: 1, hairStyle: 1, beard: 0, skinTint: 10, hairTint: 30 },
  background: 'resonant',
  startCity: 'lad',
  realm: 'dawn',
  x: 1,
  y: 2,
  h: 0,
  starterLoadout: [{ key: 'item.satchel', count: 1 }],
  createdAt: T,
  lastPlayedAt: null,
  deleteAt: null,
  deletedAt: null,
  statusBeforeDeletion: null,
  renamedAt: null,
  lockReason: null,
  ...over,
});

/** `make` создаёт хранилище с шардом `ember`; `account` — существующий аккаунт. */
export function gameStoreContract(
  name: string,
  make: () => Promise<{ store: GameStore; account: () => Promise<string> }>,
) {
  describe(`GameStore: ${name}`, () => {
    it('шарды: вставка, чтение, изменение, номера героев', async () => {
      const { store } = await make();
      const id = `s${randomUUID().slice(0, 8)}`;
      await store.insertShard(shardRecord({ id, maintenanceEta: T }));
      expect(await store.findShard(id)).toMatchObject({
        id,
        maintenanceEta: T,
        startCities: ['lad', 'kremnev', 'solyar'],
      });
      await store.updateShard(id, { manualStatus: 'maintenance', maintenanceEta: null });
      expect(await store.findShard(id)).toMatchObject({
        manualStatus: 'maintenance',
        maintenanceEta: null,
      });
      expect((await store.listShards()).map((s) => s.id)).toContain(id);
      expect([await store.nextHeroNumber(id), await store.nextHeroNumber(id)]).toEqual([1, 2]);
      expect(await store.findShard('нет')).toBeNull();
    });

    it('герои: навыки, уникальность имени и слота, удалённые не мешают', async () => {
      const { store, account } = await make();
      const a = await account();
      const hero = characterRecord(a);
      await store.insertCharacter(hero);
      expect(await store.findCharacter(hero.id)).toEqual(hero);
      expect((await store.findByNameKey('ember', 'ясна'))?.id).toBe(hero.id);
      await expect(store.insertCharacter(characterRecord(a, { slot: 1 }))).rejects.toThrow();
      await expect(
        store.insertCharacter(characterRecord(a, { name: 'Ива', nameKey: 'ива' })),
      ).rejects.toThrow();
      await store.updateCharacter(hero.id, { status: 'deleted', deletedAt: T });
      expect(await store.listCharacters(a, 'ember')).toEqual([]);
      await store.insertCharacter(characterRecord(a));
      expect(await store.countCharacters('ember')).toBeGreaterThanOrEqual(2);
      expect(await store.findCharacter(randomUUID())).toBeNull();
    });

    it('очередь удаления, история имён, удержания, слоты, откат транзакции', async () => {
      const { store, account } = await make();
      const a = await account();
      const due = characterRecord(a, {
        name: 'Ива',
        nameKey: 'ива',
        status: 'pending_deletion',
        deleteAt: T,
      });
      const later = characterRecord(a, {
        slot: 1,
        name: 'Лада',
        nameKey: 'лада',
        status: 'pending_deletion',
        deleteAt: T + 1000,
      });
      await store.insertCharacter(due);
      await store.insertCharacter(later);
      expect((await store.dueDeletions(T)).map((c) => c.id)).toContain(due.id);
      expect((await store.dueDeletions(T)).map((c) => c.id)).not.toContain(later.id);
      await store.insertNameHistory({
        id: randomUUID(),
        characterId: due.id,
        oldName: 'Ива',
        newName: 'Ия',
        reason: 'voluntary',
        changedBy: a,
        at: T,
      });
      expect(await store.listNameHistory(due.id)).toEqual([
        expect.objectContaining({ oldName: 'Ива', at: T }),
      ]);
      await store.putNameHold({ shardId: 'ember', nameKey: 'ива', accountId: a, until: T + 10 });
      await store.putNameHold({ shardId: 'ember', nameKey: 'ива', accountId: a, until: T + 20 });
      expect(await store.findNameHold('ember', 'ива', T + 15)).toMatchObject({ until: T + 20 });
      expect(await store.findNameHold('ember', 'ива', T + 20)).toBeNull();
      expect(await store.extraSlots(a, 'ember')).toBe(0);
      await store.setExtraSlots(a, 'ember', 2);
      await store.setExtraSlots(a, 'ember', 3);
      expect(await store.extraSlots(a, 'ember')).toBe(3);
      const ghost = characterRecord(a, { slot: 4, name: 'Мила', nameKey: 'мила' });
      await expect(
        store.transaction(async (tx) => {
          await tx.lockAccountShard(a, 'ember');
          await tx.insertCharacter(ghost);
          throw new Error('откат');
        }),
      ).rejects.toThrow('откат');
      expect(await store.findCharacter(ghost.id)).toBeNull();
    });
  });
}
