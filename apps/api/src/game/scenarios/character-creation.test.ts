import { describe, expect, it } from 'vitest';
import { isDomainError, kindOf } from '@duskmarch/domain';
import { META, rejects } from '../../identity/testing/harness.test-helper.js';
import { APPEARANCE, gameHarness, shardRecord } from '../game-harness.test-helper.js';

const custom = (over: object = {}) => ({
  name: 'Мирослава',
  stats: { might: 40, finesse: 30, will: 20 },
  skills: [
    { skill: 'edge', tenths: 500 },
    { skill: 'archery', tenths: 500 },
  ],
  appearance: { ...APPEARANCE },
  startCity: 'lad',
  ...over,
});

describe('characters/character-creation', () => {
  it('опции стандартного шарда и шарда разработки; закрытое создание', async () => {
    const g = await gameHarness();
    const ember = await g.game.characters.options('ember', null);
    expect(ember).toMatchObject({
      creationOpen: true,
      stats: { pool: 90, min: 10, max: 60 },
      skills: { poolTenths: 1000 },
    });
    expect(ember.backgrounds).toHaveLength(6);
    expect(ember.startCities.map((c) => c.key)).toEqual(['lad', 'kremnev', 'solyar']);
    const dev = await g.game.characters.options('local-dev', null);
    expect(dev.startCities).toEqual([
      expect.objectContaining({ key: 'proving-camp', realm: 'proving' }),
    ]);
    await g.store.updateShard('ember', { creationOpen: false });
    expect((await g.game.characters.options('ember', null)).creationOpen).toBe(false);
    const p = await g.player();
    await rejects(
      g.game.characters.create(p, 'ember', custom(), undefined, META),
      'CHAR_CREATION_CLOSED',
      403,
    );
  });

  it('проверка имени: нормализация, нарушения, занятость, частота', async () => {
    const g = await gameHarness();
    const p = await g.player();
    expect(await g.game.characters.validateName(p, 'ember', '  мирослава   ясная ')).toEqual({
      valid: true,
      normalized: 'Мирослава Ясная',
      violations: [],
    });
    expect((await g.game.characters.validateName(p, 'ember', 'Модератор Ив')).violations).toEqual([
      'reserved_prefix',
    ]);
    expect((await g.game.characters.validateName(p, 'ember', 'Иvan')).violations).toEqual([
      'mixed_script',
    ]);
    expect((await g.game.characters.validateName(p, 'ember', 'Соляр')).violations).toEqual([
      'reserved_name',
    ]);
    await g.hero(p, 'Ясна');
    expect((await g.game.characters.validateName(p, 'ember', 'ЯСНА')).violations).toEqual([
      'taken',
    ]);
    for (let i = 0; i < 25; i++) await g.game.characters.validateName(p, 'ember', 'Ива');
    await rejects(g.game.characters.validateName(p, 'ember', 'Ива'), 'CHAR_NAME_RATE_LIMITED', 429);
  });

  it('уникальность: регистр, двойники, разные шарды', async () => {
    const g = await gameHarness();
    const a = await g.player();
    const b = await g.player();
    await g.hero(a, 'Ясна');
    await rejects(g.hero(b, 'ЯСНА'), 'CHAR_NAME_TAKEN', 409);
    await g.hero(a, 'Орех');
    await rejects(g.hero(b, 'Opex'), 'CHAR_NAME_TAKEN');
    expect((await g.hero(b, 'Ясна', 'local-dev')).name).toBe('Ясна');
  });

  it('конкурентное создание одного имени', async () => {
    const g = await gameHarness();
    const [a, b] = [await g.player(), await g.player()];
    const results = await Promise.allSettled([g.hero(a, 'Ясна'), g.hero(b, 'Ясна')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'CHAR_NAME_TAKEN' },
    });
  });

  it('характеристики и ресурсы', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const hero = await g.game.characters.create(p, 'ember', custom(), undefined, META);
    expect(hero.vitals).toMatchObject({ health: 84, verve: 64, resonance: 56 });
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', stats: { might: 40, finesse: 30, will: 30 } }),
        undefined,
        META,
      ),
      'CHAR_INVALID_STATS',
      400,
    );
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', stats: { might: 70, finesse: 10, will: 10 } }),
        undefined,
        META,
      ),
      'CHAR_INVALID_STATS',
    );
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        { name: 'Ива', appearance: { ...APPEARANCE }, startCity: 'lad' },
        undefined,
        META,
      ),
      'CHAR_VALIDATION_FAILED',
    );
  });

  it('предыстория, собственный набор, недопустимые навыки', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const resonant = await g.hero(p, 'Созвучная');
    expect(resonant.stats).toEqual({ might: 15, finesse: 30, will: 45 });
    const c = await g.store.findCharacter(resonant.id);
    expect(c?.skills).toEqual([
      { skill: 'heat', tenths: 500 },
      { skill: 'binding', tenths: 300 },
      { skill: 'lore', tenths: 200 },
    ]);
    expect(
      (await g.game.characters.create(p, 'ember', custom(), undefined, META)).topSkills,
    ).toHaveLength(2);
    for (const skills of [
      [
        { skill: 'edge', tenths: 500 },
        { skill: 'edge', tenths: 500 },
      ],
      [
        { skill: 'edge', tenths: 600 },
        { skill: 'archery', tenths: 400 },
      ],
    ]) {
      await rejects(
        g.game.characters.create(p, 'ember', custom({ name: 'Ива', skills }), undefined, META),
        'CHAR_INVALID_SKILLS',
        400,
      );
    }
    await g.store.insertShard(
      shardRecord({ id: 'dry', rulesetOverride: { features: { seafaring: false } } }),
    );
    await rejects(
      g.game.characters.create(
        p,
        'dry',
        custom({
          skills: [
            { skill: 'sailing', tenths: 500 },
            { skill: 'edge', tenths: 500 },
          ],
        }),
        undefined,
        META,
      ),
      'CHAR_INVALID_SKILLS',
    );
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', background: 'pirate' }),
        undefined,
        META,
      ),
      'CHAR_INVALID_BACKGROUND',
    );
  });

  it('внешность: допустимая и зарезервированный оттенок', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const hero = await g.game.characters.create(p, 'ember', custom(), undefined, META);
    expect(hero.appearance).toEqual(APPEARANCE);
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', appearance: { ...APPEARANCE, hairTint: 1 + 3 * 17 + 16 } }),
        undefined,
        META,
      ),
      'CHAR_INVALID_APPEARANCE',
      400,
    );
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', appearance: { ...APPEARANCE, skinTint: 1 + 9 * 17 + 8 } }),
        undefined,
        META,
      ),
      'CHAR_INVALID_APPEARANCE',
    );
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', appearance: { ...APPEARANCE, skinTint: 0 } }),
        undefined,
        META,
      ),
      'CHAR_INVALID_APPEARANCE',
    );
  });

  it('город: точка назначает сервер; город шарда разработки; отключённый город', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const lad = await g.game.characters.create(p, 'ember', custom(), undefined, META);
    expect(await g.store.findCharacter(lad.id)).toMatchObject({
      realm: 'dawn',
      x: 1180,
      y: 2140,
      startCity: 'lad',
    });
    const camp = await g.hero(p, 'Лагерная', 'local-dev');
    expect(await g.store.findCharacter(camp.id)).toMatchObject({ realm: 'proving', x: 32, y: 32 });
    await rejects(
      g.game.characters.create(
        p,
        'ember',
        custom({ name: 'Ива', startCity: 'proving-camp' }),
        undefined,
        META,
      ),
      'CHAR_INVALID_START_CITY',
      400,
    );
  });

  it('снаряжение: набор созвучника; одна школа — один набор', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const resonant = await g.store.findCharacter((await g.hero(p, 'Созвучная')).id);
    expect(resonant?.starterLoadout.map((e) => e.key)).toEqual(
      expect.arrayContaining(['item.tuning-fork', 'item.chalk']),
    );
    const blade = await g.game.characters.create(
      p,
      'ember',
      custom({
        skills: [
          { skill: 'edge', tenths: 500 },
          { skill: 'tactics', tenths: 500 },
        ],
      }),
      undefined,
      META,
    );
    const kit = (await g.store.findCharacter(blade.id))?.starterLoadout ?? [];
    expect(kit.filter((e) => e.key === 'item.short-blade')).toEqual([
      { key: 'item.short-blade', count: 1 },
    ]);
  });

  it('слот 0 и EntityId героя; идемпотентность', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const first = await g.game.characters.create(p, 'ember', custom(), 'key-1', META);
    expect(first.slot).toBe(0);
    expect(kindOf(first.entityId)).toBe('hero');
    expect(await g.game.characters.create(p, 'ember', custom(), 'key-1', META)).toEqual(first);
    expect((await g.game.characters.list(p, 'ember')).characters).toHaveLength(1);
    await rejects(
      g.game.characters.create(p, 'ember', custom({ name: 'Ива' }), 'key-1', META),
      'IDEMPOTENCY_KEY_REUSED',
      409,
    );
    await rejects(
      g.game.characters.create(p, 'ember', custom({ name: 'Ива' }), 'плохой ключ', META),
      'IDEMPOTENCY_KEY_INVALID',
    );
    const second = await g.game.characters.create(
      p,
      'ember',
      custom({ name: 'Ива' }),
      'key-2',
      META,
    );
    expect(second.entityId).toBe(first.entityId + 1);
    expect(isDomainError(null)).toBe(false);
  });

  it('гонка за последний слот', async () => {
    const g = await gameHarness();
    await g.store.updateShard('ember', { characterSlots: 1 });
    const p = await g.player();
    const results = await Promise.allSettled([g.hero(p, 'Ива'), g.hero(p, 'Ясна')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'CHAR_SLOTS_FULL' },
    });
  });

  it('правила из профиля шарда: пул 200,0 на шарде разработки', async () => {
    const g = await gameHarness();
    const p = await g.player();
    const big = {
      skills: [
        { skill: 'edge', tenths: 1000 },
        { skill: 'archery', tenths: 1000 },
      ],
      startCity: 'proving-camp',
    };
    expect(
      (await g.game.characters.create(p, 'local-dev', custom(big), undefined, META)).name,
    ).toBe('Мирослава');
    await rejects(
      g.game.characters.create(p, 'ember', custom({ ...big, startCity: 'lad' }), undefined, META),
      'CHAR_INVALID_SKILLS',
    );
  });
});
