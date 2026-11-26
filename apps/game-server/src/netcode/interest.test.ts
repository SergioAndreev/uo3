import type { AccessLevel, EntityId } from '@duskmarch/domain';
import { describe, expect, it } from 'vitest';
import {
  InterestManager,
  concealment,
  fogPredicate,
  type AoiEntity,
  type Observer,
} from './interest.js';

let nextId = 1_000;
const being = (
  x: number,
  y: number,
  realm = 'dusk',
  extra: Partial<AoiEntity> = {},
): AoiEntity => ({ id: nextId++, kind: 'being', realm, x, y, ...extra });
const item = (x: number, y: number, realm = 'dusk'): AoiEntity => ({
  id: nextId++,
  kind: 'item',
  realm,
  x,
  y,
});

function setup(
  opts: {
    hysteresis?: number;
    maxBeings?: number;
    fog?: (realm: string, x: number, y: number) => number | null;
  } = {},
) {
  const aoi = new InterestManager({
    radius: 20,
    largeRadius: 32,
    ...(opts.hysteresis !== undefined ? { hysteresis: opts.hysteresis } : {}),
    ...(opts.maxBeings !== undefined ? { maxBeings: opts.maxBeings } : {}),
    ...(opts.fog ? { predicates: [concealment, fogPredicate(opts.fog)] } : {}),
  });
  const watch = (x: number, y: number, realm = 'dusk', level: AccessLevel = 'player'): Observer => {
    const e = being(x, y, realm);
    aoi.upsert(e);
    const o: Observer = {
      id: e.id,
      realm,
      x,
      y,
      level,
      detects: new Set(),
      targets: new Set(),
      group: new Set(),
    };
    aoi.addObserver(o);
    return o;
  };
  const sees = (o: Observer, id: EntityId) => aoi.visibleTo(o.id).has(id);
  return { aoi, watch, sees };
}

describe('netcode/interest-management', () => {
  it('радиусы 20 и 32, изоляция планов', () => {
    const { aoi, watch, sees } = setup();
    const o = watch(1_000, 1_000);
    const near = being(1_020, 1_020);
    const far = being(1_021, 1_000);
    const house: AoiEntity = {
      id: nextId++,
      kind: 'structure',
      realm: 'dusk',
      x: 1_032,
      y: 1_000,
      rect: { minX: 1_032, minY: 1_000, maxX: 1_040, maxY: 1_008 },
    };
    const loot = item(1_025, 1_000);
    for (const e of [near, far, house, loot]) aoi.upsert(e);
    const diff = aoi.flush().get(o.id);
    expect(sees(o, near.id)).toBe(true);
    expect(sees(o, far.id)).toBe(false);
    expect(sees(o, house.id)).toBe(true);
    expect(sees(o, loot.id)).toBe(false);
    expect(sees(o, o.id)).toBe(true);
    expect(diff?.added.map((a) => a.id).sort()).toEqual([o.id, near.id, house.id].sort());
    const a = watch(1_500, 1_500, 'dusk');
    const b = watch(1_500, 1_500, 'dawn');
    aoi.flush();
    expect(sees(a, b.id)).toBe(false);
    expect(sees(b, a.id)).toBe(false);
  });

  it('гистерезис H = 2 и H = 0', () => {
    const { aoi, watch, sees } = setup();
    const o = watch(100, 100);
    const c = being(120, 100);
    aoi.upsert(c);
    aoi.flush();
    for (const x of [121, 122, 120]) {
      aoi.move(c.id, x, 100);
      const diff = aoi.flush().get(o.id);
      expect(diff?.removed ?? []).toEqual([]);
      expect(sees(o, c.id)).toBe(true);
    }
    aoi.move(c.id, 123, 100);
    expect(aoi.flush().get(o.id)?.removed).toEqual([{ id: c.id, kind: 'being' }]);
    expect(() => new InterestManager({ radius: 20, largeRadius: 32, hysteresis: 5 })).toThrow();
    const zero = setup({ hysteresis: 0 });
    const z = zero.watch(100, 100);
    const zc = being(120, 100);
    zero.aoi.upsert(zc);
    zero.aoi.flush();
    zero.aoi.move(zc.id, 121, 100);
    zero.aoi.flush();
    expect(zero.sees(z, zc.id)).toBe(false);
  });

  it('секторы: шаг в чужом секторе не проверяется; переход наблюдателя — только окно', () => {
    const { aoi, watch } = setup();
    const o = watch(10 * 16 + 8, 10 * 16 + 8);
    const crowd = Array.from({ length: 5_000 }, (_, i) =>
      being(1_200 + (i % 70), 1_200 + Math.floor(i / 70)),
    );
    for (const e of crowd) aoi.upsert(e);
    aoi.flush();
    aoi.checks = 0;
    const npc = crowd[0] as AoiEntity;
    aoi.move(npc.id, npc.x + 1, npc.y);
    aoi.flush();
    expect(aoi.checks).toBe(0);
    aoi.move(o.id, 11 * 16 + 1, o.y);
    aoi.flush();
    expect(aoi.checks).toBeLessThan(10);
  });

  it('свой герой виден всегда; скрытность и права обнаружения; невидимость персонала', () => {
    const { aoi, watch, sees } = setup();
    const a = watch(300, 300);
    const b = watch(303, 300);
    const gm = watch(305, 300, 'dusk', 'game-master');
    const v = watch(300, 305);
    aoi.flush();
    expect(sees(b, a.id)).toBe(true);
    aoi.touch(a.id, { concealLevel: 'player' });
    v.detects.add(a.id);
    aoi.refresh(v.id);
    const diff = aoi.flush();
    expect(diff.get(b.id)?.removed).toEqual([{ id: a.id, kind: 'being' }]);
    expect(sees(a, a.id)).toBe(true);
    expect(sees(gm, a.id)).toBe(true);
    expect(sees(v, a.id)).toBe(true);
    aoi.move(a.id, 301, 300);
    expect(aoi.flush().get(b.id)).toBeUndefined();
    v.detects.delete(a.id);
    aoi.refresh(v.id);
    aoi.flush();
    expect(sees(v, a.id)).toBe(false);
    const admin = watch(400, 400, 'dusk', 'administrator');
    const helper = watch(402, 400, 'dusk', 'helper');
    const mod = watch(404, 400, 'dusk', 'moderator');
    aoi.flush();
    aoi.touch(admin.id, { concealLevel: 'administrator' });
    aoi.touch(mod.id, { concealLevel: 'moderator' });
    const gm2 = watch(403, 401, 'dusk', 'game-master');
    aoi.flush();
    expect(sees(helper, admin.id)).toBe(false);
    expect(sees(helper, mod.id)).toBe(false);
    expect(sees(gm2, mod.id)).toBe(true);
    expect(sees(mod, mod.id)).toBe(true);
  });

  it('туман Мари: дальность 6', () => {
    const { aoi, watch, sees } = setup({ fog: (_r, x) => (x >= 500 ? 6 : null) });
    const o = watch(490, 100);
    const c = being(500, 100);
    aoi.upsert(c);
    aoi.flush();
    expect(sees(o, c.id)).toBe(false);
    aoi.move(o.id, 494, 100);
    aoi.flush();
    expect(sees(o, c.id)).toBe(true);
  });

  it('контейнеры: только открывшему; отход > 2 и уничтожение закрывают', () => {
    const { aoi, watch } = setup();
    const a = watch(500, 500);
    const b = watch(501, 500);
    aoi.flush();
    aoi.openContainer(a.id, 77, [78, 79], null);
    expect([...aoi.containerContents(a.id)]).toEqual([78, 79]);
    expect(aoi.containerContents(b.id).size).toBe(0);
    aoi.openContainer(a.id, 90, [91], { realm: 'dusk', x: 500, y: 500 });
    aoi.move(a.id, 502, 500);
    expect(aoi.flush().get(a.id)?.closedContainers ?? []).toEqual([]);
    aoi.move(a.id, 503, 500);
    expect(aoi.flush().get(a.id)?.closedContainers).toEqual([90]);
    expect([...aoi.containerContents(a.id)]).toEqual([78, 79]);
    aoi.dropContainer(77);
    expect(aoi.flush().get(a.id)?.closedContainers).toEqual([77]);
    expect(aoi.containerContents(a.id).size).toBe(0);
    aoi.openContainer(a.id, 95, [96], null);
    aoi.closeContainer(a.id, 95);
    expect(aoi.flush().get(a.id)?.closedContainers).toEqual([95]);
  });

  it('телепорт: старое удалено, новое добавлено за один flush; рождение и удаление в одном тике', () => {
    const { aoi, watch } = setup();
    const o = watch(100, 100);
    const old = [being(105, 100), item(101, 101)];
    const fresh = [being(3_005, 2_000), item(3_001, 2_001)];
    for (const e of [...old, ...fresh]) aoi.upsert(e);
    aoi.flush();
    aoi.move(o.id, 3_000, 2_000);
    const diff = aoi.flush().get(o.id);
    expect(diff?.removed.map((r) => r.id).sort()).toEqual(old.map((e) => e.id).sort());
    expect(diff?.added.map((r) => r.id).sort()).toEqual(fresh.map((e) => e.id).sort());
    const ghost = item(3_003, 2_000);
    aoi.upsert(ghost);
    aoi.remove(ghost.id);
    expect(aoi.flush().get(o.id)).toBeUndefined();
    aoi.move(o.id, 3_000, 2_000, 'dawn');
    const realm = aoi.flush().get(o.id);
    expect(realm?.removed).toHaveLength(2);
  });

  it('лимит 512: свой герой, цель и ближние; освобождение мест возвращает вытесненных', () => {
    const { aoi, watch, sees } = setup();
    const o = watch(1_000, 1_000);
    const target = being(1_015, 1_000);
    aoi.upsert(target);
    o.targets.add(target.id);
    const crowd: AoiEntity[] = [];
    for (let i = 0; i < 699; i++) {
      const d = 1 + (i % 18);
      crowd.push(being(1_000 + d, 1_000 - 9 + (Math.floor(i / 18) % 19)));
    }
    for (const e of crowd) aoi.upsert(e);
    aoi.flush();
    const visible = aoi.visibleTo(o.id);
    expect(visible.size).toBe(512);
    expect(sees(o, o.id)).toBe(true);
    expect(sees(o, target.id)).toBe(true);
    const nearest = crowd.filter((e) => e.x === 1_001);
    for (const e of nearest) expect(sees(o, e.id)).toBe(true);
    const leaving = crowd.slice(0, 250);
    for (const e of leaving) aoi.remove(e.id);
    aoi.flush();
    expect(aoi.visibleTo(o.id).size).toBe(451);
  });

  it('ресинхронизация: полный набор ровно по одному разу; теневые копии', () => {
    const { aoi, watch } = setup();
    const o = watch(200, 200);
    const ids = [being(205, 200), item(201, 200), being(215, 200, 'dusk', { shadow: true })].map(
      (e) => {
        aoi.upsert(e);
        return e.id;
      },
    );
    aoi.flush();
    aoi.resync(o.id);
    const diff = aoi.flush().get(o.id);
    expect(diff?.reset).toBe(true);
    expect(diff?.removed).toEqual([]);
    expect(diff?.added.map((a) => a.id).sort()).toEqual([o.id, ...ids].sort());
    aoi.removeObserver(o.id);
    expect(aoi.visibleTo(o.id).size).toBe(0);
    expect(aoi.observer(o.id)).toBeUndefined();
  });
});
