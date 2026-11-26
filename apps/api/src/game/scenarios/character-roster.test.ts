import { describe, expect, it } from 'vitest';
import { META, rejects } from '../../identity/testing/harness.test-helper.js';
import { RENAME_COOLDOWN_MS } from '../characters.js';
import { createGameServices } from '../index.js';
import { gameHarness } from '../game-harness.test-helper.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('characters/character-roster', () => {
  it('список по слотам, пустой список, удалённые не видны', async () => {
    const g = await gameHarness();
    const p = await g.player();
    expect(await g.game.characters.list(p, 'ember')).toEqual({
      characters: [],
      slots: { used: 0, total: 5 },
    });
    const a = await g.hero(p, 'Ива');
    const b = await g.hero(p, 'Ясна');
    const list = await g.game.characters.list(p, 'ember');
    expect(list.characters.map((c) => [c.name, c.slot])).toEqual([
      ['Ива', 0],
      ['Ясна', 1],
    ]);
    expect(list.characters[0]).toMatchObject({
      topSkills: expect.any(Array),
      appearance: expect.any(Object),
      realm: 'dawn',
    });
    await g.game.characters.remove(p, 'ember', b.id, 'ясна', META);
    g.h.clock.advance(11 * 60_000);
    await g.game.characters.finalizeDue();
    expect((await g.game.characters.list(p, 'ember')).characters.map((c) => c.id)).toEqual([a.id]);
  });

  it('квоты: все слоты, один слот, дополнительные не выше 7', async () => {
    const g = await gameHarness();
    const admin = await g.staff('administrator');
    for (let i = 0; i < 5; i++) await g.hero(admin, `Гер${'абвгд'[i]}`);
    await rejects(g.hero(admin, 'Лишний'), 'CHAR_SLOTS_FULL', 409);
    await g.store.updateShard('ember', { characterSlots: 1 });
    const p = await g.player();
    await g.hero(p, 'Одна');
    await rejects(g.hero(p, 'Вторая'), 'CHAR_SLOTS_FULL');
    await g.store.updateShard('ember', { characterSlots: 5 });
    await g.store.setExtraSlots(p.accountId, 'ember', 4);
    expect((await g.game.characters.list(p, 'ember')).slots.total).toBe(7);
  });

  it('суточный лимит создания; администратору — без лимита', async () => {
    const g = await gameHarness();
    const p = await g.player();
    for (const name of ['Ива', 'Ясна', 'Лада']) await g.hero(p, name);
    const limited = await rejects(g.hero(p, 'Мила'), 'CHAR_CREATION_RATE_LIMITED', 429);
    expect(limited.options.retryAfterS).toBeGreaterThan(0);
    const admin = await g.staff('administrator');
    for (const name of ['Ада', 'Бая', 'Вея', 'Гая']) await g.hero(admin, name);
  });

  it('удаление: 10 минут для нового, 72 часа для развитого; в мире; предохранитель; подтверждение имени', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const fresh = await g.hero(p, 'Ива');
    const removed = await g.game.characters.remove(p, 'ember', fresh.id, 'Ива', META);
    expect(Date.parse(removed.deleteAt ?? '')).toBe(g.h.clock.utc() + 10 * 60_000);
    const old = await g.hero(p, 'Ясна');
    g.h.clock.advance(30 * DAY);
    expect(
      Date.parse((await g.game.characters.remove(p, 'ember', old.id, 'Ясна', META)).deleteAt ?? ''),
    ).toBe(g.h.clock.utc() + 72 * HOUR);
    const online = await g.hero(p, 'Лада');
    g.live.sessions.set(`ember:${p.accountId}`, { characterId: online.id, state: 'online' });
    await rejects(
      g.game.characters.remove(p, 'ember', online.id, 'Лада', META),
      'CHAR_IN_WORLD',
      409,
    );
    await rejects(
      g.game.characters.remove(p, 'ember', fresh.id, 'Ива', META),
      'CHAR_PENDING_DELETION',
    );
    g.live.sessions.clear();
    await rejects(
      g.game.characters.remove(p, 'ember', online.id, 'Не то', META),
      'CHAR_NAME_CONFIRMATION_MISMATCH',
    );
    const guarded = createGameServices(g.h, g.store, g.live, [{ check: async () => 'owns_house' }]);
    const blocked = await rejects(
      guarded.characters.remove(p, 'ember', online.id, 'Лада', META),
      'CHAR_DELETION_BLOCKED',
      409,
    );
    expect(blocked.options.details).toEqual({ reason: 'owns_house' });
  });

  it('отмена удаления до срока; для активного героя — ошибка', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const c = await g.hero(p, 'Ива');
    await rejects(
      g.game.characters.cancelDeletion(p, 'ember', c.id),
      'CHAR_NOT_PENDING_DELETION',
      409,
    );
    await g.game.characters.remove(p, 'ember', c.id, 'Ива', META);
    g.h.clock.advance(5 * 60_000);
    expect((await g.game.characters.cancelDeletion(p, 'ember', c.id)).status).toBe('active');
  });

  it('финализация: слот свободен, удержание имени 24 часа, идемпотентность', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const other = await g.player();
    const c = await g.hero(p, 'Ясна');
    g.h.clock.advance(8 * DAY);
    await g.game.characters.remove(p, 'ember', c.id, 'Ясна', META);
    g.h.clock.advance(72 * HOUR);
    expect(await g.game.characters.finalizeDue()).toBe(1);
    expect(await g.game.characters.finalizeDue()).toBe(0);
    expect((await g.store.findCharacter(c.id))?.status).toBe('deleted');
    await rejects(g.hero(other, 'Ясна'), 'CHAR_NAME_TAKEN');
    expect((await g.hero(p, 'Ясна')).slot).toBe(0);
  });

  it('переименование: обязательное, кулдаун, выключено, в мире, история', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const mod = await g.staff('moderator');
    const c = await g.hero(p, 'Ясна');
    await g.store.updateShard('ember', { renamePolicy: 'disabled' });
    await rejects(g.game.characters.rename(p, 'ember', c.id, 'Ива'), 'CHAR_RENAME_DISABLED', 403);
    await g.game.characters.requireRename(mod, c.id, 'имя нарушает правила шарда', META);
    expect((await g.game.characters.rename(p, 'ember', c.id, 'Ива')).status).toBe('active');
    expect(await g.game.characters.history(c.id)).toEqual([
      expect.objectContaining({ oldName: 'Ясна', newName: 'Ива', reason: 'required' }),
    ]);
    await g.store.updateShard('ember', { renamePolicy: 'cooldown' });
    g.h.clock.advance(10 * DAY);
    const cd = await rejects(
      g.game.characters.rename(p, 'ember', c.id, 'Лада'),
      'CHAR_RENAME_COOLDOWN',
      429,
    );
    expect(cd.options.retryAfterS).toBe((RENAME_COOLDOWN_MS - 10 * DAY) / 1000);
    g.h.clock.advance(20 * DAY);
    g.live.sessions.set(`ember:${p.accountId}`, { characterId: c.id, state: 'online' });
    await rejects(g.game.characters.rename(p, 'ember', c.id, 'Лада'), 'CHAR_IN_WORLD', 409);
    g.live.sessions.clear();
    expect((await g.game.characters.rename(p, 'ember', c.id, 'Лада')).name).toBe('Лада');
    await g.store.updateShard('ember', { renamePolicy: 'free' });
    const other = await g.hero(p, 'Мила');
    await rejects(g.game.characters.rename(p, 'ember', other.id, 'лада'), 'CHAR_NAME_TAKEN');
  });

  it('персонал: принудительное переименование, блокировка, разблокировка, права', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const mod = await g.staff('moderator');
    const helper = await g.staff('helper');
    const c = await g.hero(p, 'Ясна');
    await rejects(
      g.game.characters.lock(helper, c.id, 'нарушение правил чата', META),
      'RBAC_INSUFFICIENT_PERMISSION',
      403,
    );
    await rejects(g.game.characters.lock(mod, c.id, 'кратко', META), 'CHAR_REASON_INVALID');
    await g.game.characters.lock(mod, c.id, 'нарушение правил торговли', META);
    expect((await g.store.findCharacter(c.id))?.status).toBe('locked');
    await rejects(g.game.characters.rename(p, 'ember', c.id, 'Ива'), 'CHAR_LOCKED');
    await g.game.characters.unlock(mod, c.id, 'проверка завершена успешно', META);
    await rejects(
      g.game.characters.unlock(mod, c.id, 'проверка завершена успешно', META),
      'CHAR_NOT_FOUND',
    );
    await g.h.flush();
    expect(g.h.events.of('character.locked')).toEqual([
      expect.objectContaining({ characterId: c.id }),
    ]);
    const audit = await g.h.store.listAudit({ limit: 10 });
    expect(audit.items.map((a) => a.action)).toEqual(
      expect.arrayContaining(['character.lock', 'character.unlock']),
    );
    await rejects(
      g.game.characters.lock(
        mod,
        '00000000-0000-7000-8000-000000000000',
        'нарушение правил торговли',
        META,
      ),
      'CHAR_NOT_FOUND',
    );
  });

  it('восстановление удалённого: свободное имя, занятое имя, срок, без слота', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const gm = await g.staff('game-master');
    const mod = await g.staff('moderator');
    const a = await g.hero(p, 'Ясна');
    await g.game.characters.remove(p, 'ember', a.id, 'Ясна', META);
    g.h.clock.advance(11 * 60_000);
    await g.game.characters.finalizeDue();
    await rejects(
      g.game.characters.restoreDeleted(mod, a.id, 'ошибочное удаление игроком', META),
      'RBAC_INSUFFICIENT_PERMISSION',
    );
    g.h.clock.advance(5 * DAY);
    expect(
      await g.game.characters.restoreDeleted(gm, a.id, 'ошибочное удаление игроком', META),
    ).toMatchObject({ status: 'active', slot: 0 });

    const b = await g.hero(p, 'Ива');
    await g.game.characters.remove(p, 'ember', b.id, 'Ива', META);
    g.h.clock.advance(11 * 60_000);
    await g.game.characters.finalizeDue();
    await g.hero(await g.player(), 'Ива');
    expect(
      (await g.game.characters.restoreDeleted(gm, b.id, 'ошибочное удаление игроком', META)).status,
    ).toBe('rename_required');

    const c = await g.hero(p, 'Лада');
    await g.game.characters.remove(p, 'ember', c.id, 'Лада', META);
    g.h.clock.advance(11 * 60_000);
    await g.game.characters.finalizeDue();
    g.h.clock.advance(91 * DAY);
    await rejects(
      g.game.characters.restoreDeleted(gm, c.id, 'ошибочное удаление игроком', META),
      'CHAR_RESTORE_EXPIRED',
      410,
    );
    await rejects(
      g.game.characters.restoreDeleted(gm, a.id, 'ошибочное удаление игроком', META),
      'CHAR_NOT_FOUND',
    );
    await g.store.updateShard('ember', { characterSlots: 2 });
    await g.store.updateCharacter(c.id, { deletedAt: g.h.clock.utc() });
    await rejects(
      g.game.characters.restoreDeleted(gm, c.id, 'ошибочное удаление игроком', META),
      'CHAR_SLOTS_FULL',
    );
  });

  it('изоляция: чужой герой и путь другого шарда', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const intruder = await g.player();
    const c = await g.hero(p, 'Ясна');
    await rejects(
      g.game.characters.remove(intruder, 'ember', c.id, 'Ясна', META),
      'CHAR_NOT_FOUND',
      404,
    );
    await rejects(g.game.characters.rename(p, 'local-dev', c.id, 'Ива'), 'CHAR_NOT_FOUND');
  });
});
