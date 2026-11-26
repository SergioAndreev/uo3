import { hasAccess, isStaff, type AccessLevel, type EntityId } from '@duskmarch/domain';

export type AoiKind = 'being' | 'item' | 'structure';

/** Сущность-кандидат видимости (локальная или теневая копия соседней партиции). */
export interface AoiEntity {
  readonly id: EntityId;
  kind: AoiKind;
  realm: string;
  x: number;
  y: number;
  /** Постройка: прямоугольник клеток. */
  rect?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Скрытность или невидимость: минимальный уровень персонала, который видит цель. */
  concealLevel?: AccessLevel | null;
  /** Только для чтения: копия соседней партиции. */
  shadow?: boolean;
}

export interface Observer {
  readonly id: EntityId;
  realm: string;
  x: number;
  y: number;
  level: AccessLevel;
  /** Выданные сервером права обнаружения скрытых целей. */
  readonly detects: Set<EntityId>;
  /** Боевые цели и агрессоры. */
  readonly targets: Set<EntityId>;
  /** Группа, гильдия, спутники. */
  readonly group: Set<EntityId>;
}

/** Предикат «видит ли наблюдатель цель» поверх радиуса. */
export type VisibilityPredicate = (
  observer: Observer,
  target: AoiEntity,
  distance: number,
) => boolean;

/** Скрытые и невидимые: свой герой, право обнаружения или персонал не ниже уровня невидимости. */
export const concealment: VisibilityPredicate = (o, t) =>
  t.concealLevel == null ||
  t.id === o.id ||
  o.detects.has(t.id) ||
  (isStaff(o.level) && hasAccess(o.level, t.concealLevel));

/** Туман: в клетке тумана цель видна только ближе дальности тумана. */
export const fogPredicate =
  (fogRange: (realm: string, x: number, y: number) => number | null): VisibilityPredicate =>
  (_o, t, distance) => {
    const range = fogRange(t.realm, t.x, t.y);
    return range === null || distance <= range;
  };

export interface InterestOptions {
  radius: number;
  largeRadius: number;
  hysteresis?: number;
  sectorSize?: number;
  maxBeings?: number;
  maxItems?: number;
  predicates?: VisibilityPredicate[];
  /** Отход от мирового контейнера дальше этого — закрытие. */
  containerReach?: number;
}

export interface AoiDiff {
  added: { id: EntityId; kind: AoiKind }[];
  removed: { id: EntityId; kind: AoiKind }[];
  closedContainers: EntityId[];
  /** Полная ресинхронизация: клиент сбрасывает прежнее содержимое. */
  reset: boolean;
}

interface OpenContainer {
  contents: Set<EntityId>;
  /** Позиция мирового контейнера; `null` — свой контейнер без проверки дистанции. */
  at: { realm: string; x: number; y: number } | null;
}

interface ObserverState {
  observer: Observer;
  visible: Map<EntityId, AoiKind>;
  sectors: Set<number>;
  containers: Map<EntityId, OpenContainer>;
  overflow: boolean;
  reset: boolean;
  closed: EntityId[];
}

const KIND_LIMIT = { being: 'maxBeings', item: 'maxItems' } as const;

/**
 * Область интереса партиции: секторы 16×16, вход при `d ≤ R`, выход при `d > R + H`,
 * предикаты, лимиты с приоритетным отбором, контейнеры по разрешению, ресинхронизация.
 * Изменения копятся до `flush()` в конце тика.
 */
export class InterestManager {
  private readonly o: Required<InterestOptions>;
  private readonly entities = new Map<EntityId, AoiEntity>();
  private readonly entitySectors = new Map<EntityId, number[]>();
  private readonly sectorEntities = new Map<number, Set<EntityId>>();
  private readonly sectorObservers = new Map<number, Set<EntityId>>();
  private readonly observers = new Map<EntityId, ObserverState>();
  private readonly dirtyEntities = new Set<EntityId>();
  private readonly dirtyObservers = new Set<EntityId>();
  /** Число проверок пары (для тестов инкрементальности). */
  checks = 0;

  constructor(options: InterestOptions) {
    const hysteresis = options.hysteresis ?? 2;
    if (hysteresis < 0 || hysteresis > 4) throw new Error(`гистерезис ${hysteresis} вне 0..4`);
    this.o = {
      hysteresis,
      sectorSize: 16,
      maxBeings: 512,
      maxItems: 1_024,
      predicates: [concealment],
      containerReach: 2,
      ...options,
    };
  }

  private key(realm: string, sx: number, sy: number): number {
    return (this.realmIndex(realm) * 4_096 + sy) * 4_096 + sx;
  }

  private readonly realms = new Map<string, number>();
  private realmIndex(realm: string): number {
    let index = this.realms.get(realm);
    if (index === undefined) {
      index = this.realms.size;
      this.realms.set(realm, index);
    }
    return index;
  }

  private sectorsFor(e: AoiEntity): number[] {
    const s = this.o.sectorSize;
    const r = e.rect ?? { minX: e.x, minY: e.y, maxX: e.x, maxY: e.y };
    const keys: number[] = [];
    for (let sy = Math.floor(r.minY / s); sy <= Math.floor(r.maxY / s); sy++) {
      for (let sx = Math.floor(r.minX / s); sx <= Math.floor(r.maxX / s); sx++)
        keys.push(this.key(e.realm, sx, sy));
    }
    return keys;
  }

  private windowOf(o: Observer): Set<number> {
    const s = this.o.sectorSize;
    const reach = Math.max(this.o.radius, this.o.largeRadius) + this.o.hysteresis;
    const keys = new Set<number>();
    for (
      let sy = Math.max(0, Math.floor((o.y - reach) / s));
      sy <= Math.floor((o.y + reach) / s);
      sy++
    ) {
      for (
        let sx = Math.max(0, Math.floor((o.x - reach) / s));
        sx <= Math.floor((o.x + reach) / s);
        sx++
      ) {
        keys.add(this.key(o.realm, sx, sy));
      }
    }
    return keys;
  }

  // ——— сущности ———

  upsert(entity: AoiEntity): void {
    const old = this.entitySectors.get(entity.id);
    for (const k of old ?? []) this.sectorEntities.get(k)?.delete(entity.id);
    this.entities.set(entity.id, entity);
    const keys = this.sectorsFor(entity);
    this.entitySectors.set(entity.id, keys);
    for (const k of keys) {
      let set = this.sectorEntities.get(k);
      if (!set) this.sectorEntities.set(k, (set = new Set()));
      set.add(entity.id);
    }
    this.dirtyEntities.add(entity.id);
    if (old) for (const k of old) this.markSectorObservers(k);
  }

  move(id: EntityId, x: number, y: number, realm?: string): void {
    const e = this.entities.get(id);
    if (!e) return;
    this.upsert({ ...e, x, y, realm: realm ?? e.realm });
    if (this.observers.has(id)) {
      const st = this.observers.get(id) as ObserverState;
      st.observer.x = x;
      st.observer.y = y;
      if (realm) st.observer.realm = realm;
      this.dirtyObservers.add(id);
    }
  }

  /** Изменение состояния цели (скрытность и т. п.): пересчёт затронутых пар в этом тике. */
  touch(id: EntityId, patch: Partial<Omit<AoiEntity, 'id'>> = {}): void {
    const e = this.entities.get(id);
    if (e) this.upsert({ ...e, ...patch });
    if (this.observers.has(id)) this.dirtyObservers.add(id);
  }

  remove(id: EntityId): void {
    for (const k of this.entitySectors.get(id) ?? []) {
      this.sectorEntities.get(k)?.delete(id);
      this.markSectorObservers(k);
    }
    this.entitySectors.delete(id);
    this.entities.delete(id);
    this.dirtyEntities.add(id);
    for (const st of this.observers.values()) {
      if (st.containers.has(id)) this.closeInternal(st, id);
    }
  }

  private markSectorObservers(k: number): void {
    for (const oid of this.sectorObservers.get(k) ?? []) {
      if (this.observers.get(oid)?.overflow) this.dirtyObservers.add(oid);
    }
  }

  // ——— наблюдатели ———

  addObserver(observer: Observer): void {
    this.observers.set(observer.id, {
      observer,
      visible: new Map(),
      sectors: new Set(),
      containers: new Map(),
      overflow: false,
      reset: false,
      closed: [],
    });
    this.dirtyObservers.add(observer.id);
  }

  removeObserver(id: EntityId): void {
    const st = this.observers.get(id);
    if (!st) return;
    for (const k of st.sectors) this.sectorObservers.get(k)?.delete(id);
    this.observers.delete(id);
    this.dirtyObservers.delete(id);
  }

  observer(id: EntityId): Observer | undefined {
    return this.observers.get(id)?.observer;
  }

  /** Изменение наблюдателя (уровень, обнаружение, цели): пересчёт его видимости. */
  refresh(id: EntityId): void {
    if (this.observers.has(id)) this.dirtyObservers.add(id);
  }

  visibleTo(id: EntityId): ReadonlyMap<EntityId, AoiKind> {
    return this.observers.get(id)?.visible ?? new Map();
  }

  /** Полная перестройка по `aoi.resync_request`, после переподключения или передачи. */
  resync(id: EntityId): void {
    const st = this.observers.get(id);
    if (!st) return;
    st.visible.clear();
    st.reset = true;
    this.dirtyObservers.add(id);
  }

  // ——— контейнеры ———

  openContainer(
    observerId: EntityId,
    containerId: EntityId,
    contents: Iterable<EntityId>,
    at: OpenContainer['at'],
  ): void {
    const st = this.observers.get(observerId);
    if (!st) return;
    st.containers.set(containerId, { contents: new Set(contents), at });
  }

  closeContainer(observerId: EntityId, containerId: EntityId): void {
    const st = this.observers.get(observerId);
    if (st?.containers.has(containerId)) this.closeInternal(st, containerId);
  }

  /** Потеря доступа к контейнеру у всех, кто его открыл (уничтожение, перенос). */
  dropContainer(containerId: EntityId): void {
    for (const st of this.observers.values())
      if (st.containers.has(containerId)) this.closeInternal(st, containerId);
  }

  containerContents(observerId: EntityId): ReadonlySet<EntityId> {
    const out = new Set<EntityId>();
    for (const c of this.observers.get(observerId)?.containers.values() ?? [])
      for (const id of c.contents) out.add(id);
    return out;
  }

  private closeInternal(st: ObserverState, containerId: EntityId): void {
    st.containers.delete(containerId);
    st.closed.push(containerId);
  }

  // ——— видимость ———

  private distance(o: Observer, e: AoiEntity): number {
    if (e.rect) {
      const dx = o.x < e.rect.minX ? e.rect.minX - o.x : o.x > e.rect.maxX ? o.x - e.rect.maxX : 0;
      const dy = o.y < e.rect.minY ? e.rect.minY - o.y : o.y > e.rect.maxY ? o.y - e.rect.maxY : 0;
      return Math.max(dx, dy);
    }
    return Math.max(Math.abs(e.x - o.x), Math.abs(e.y - o.y));
  }

  /** Подходит ли пара без учёта лимитов; `visible` — была ли видима (гистерезис). */
  private eligible(st: ObserverState, e: AoiEntity, visible: boolean): number | null {
    this.checks++;
    const o = st.observer;
    if (e.id === o.id) return 0;
    if (e.realm !== o.realm) return null;
    const d = this.distance(o, e);
    const r = e.kind === 'structure' ? this.o.largeRadius : this.o.radius;
    if (d > (visible ? r + this.o.hysteresis : r)) return null;
    for (const p of this.o.predicates) if (!p(o, e, d)) return null;
    return d;
  }

  private rank(o: Observer, id: EntityId, d: number): number {
    if (id === o.id) return -3;
    if (o.targets.has(id)) return -2;
    if (o.group.has(id)) return -1;
    return d;
  }

  /** Полный пересчёт наблюдателя по окну секторов. */
  private recompute(st: ObserverState): void {
    const window = this.windowOf(st.observer);
    for (const k of st.sectors)
      if (!window.has(k)) this.sectorObservers.get(k)?.delete(st.observer.id);
    for (const k of window) {
      let set = this.sectorObservers.get(k);
      if (!set) this.sectorObservers.set(k, (set = new Set()));
      set.add(st.observer.id);
    }
    st.sectors = window;
    const candidates: { e: AoiEntity; d: number }[] = [];
    const seen = new Set<EntityId>();
    for (const k of window) {
      for (const id of this.sectorEntities.get(k) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = this.entities.get(id) as AoiEntity;
        const d = this.eligible(st, e, st.visible.has(id));
        if (d !== null) candidates.push({ e, d });
      }
    }
    const self = this.entities.get(st.observer.id);
    if (self && !seen.has(self.id)) candidates.push({ e: self, d: 0 });
    st.overflow = false;
    const next = new Map<EntityId, AoiKind>();
    for (const kind of ['being', 'item', 'structure'] as const) {
      let list = candidates.filter((c) => c.e.kind === kind);
      const limitKey = kind === 'structure' ? null : KIND_LIMIT[kind];
      const limit = limitKey ? this.o[limitKey] : Infinity;
      if (list.length > limit) {
        st.overflow = true;
        list = list
          .map((c) => ({ ...c, rank: this.rank(st.observer, c.e.id, c.d) }))
          .sort((a, b) => a.rank - b.rank || a.e.id - b.e.id)
          .slice(0, limit);
      }
      for (const c of list) next.set(c.e.id, kind);
    }
    this.apply(st, next);
  }

  private pending = new Map<EntityId, AoiDiff>();

  private diffOf(id: EntityId): AoiDiff {
    let diff = this.pending.get(id);
    if (!diff)
      this.pending.set(id, (diff = { added: [], removed: [], closedContainers: [], reset: false }));
    return diff;
  }

  private apply(st: ObserverState, next: Map<EntityId, AoiKind>): void {
    const diff = this.diffOf(st.observer.id);
    for (const [id, kind] of st.visible) if (!next.has(id)) diff.removed.push({ id, kind });
    for (const [id, kind] of next) if (!st.visible.has(id)) diff.added.push({ id, kind });
    st.visible = next;
  }

  /** Пересчёт одной пары после изменения сущности. */
  private recheck(st: ObserverState, id: EntityId): void {
    const e = this.entities.get(id);
    const was = st.visible.get(id);
    const d = e ? this.eligible(st, e, was !== undefined) : null;
    if (d === null && was !== undefined) {
      if (id === st.observer.id && e) return;
      st.visible.delete(id);
      this.diffOf(st.observer.id).removed.push({ id, kind: was });
    } else if (d !== null && e && was === undefined) {
      const limitKey = e.kind === 'structure' ? null : KIND_LIMIT[e.kind];
      const count = limitKey ? [...st.visible.values()].filter((k) => k === e.kind).length : 0;
      if (limitKey && count >= this.o[limitKey]) {
        st.overflow = true;
        this.dirtyObservers.add(st.observer.id);
        return;
      }
      st.visible.set(id, e.kind);
      this.diffOf(st.observer.id).added.push({ id, kind: e.kind });
    }
  }

  /** Конец тика: изменения видимости по наблюдателям. Сущность, рождённая и удалённая в одном тике, не попадает никуда. */
  flush(): Map<EntityId, AoiDiff> {
    const initial = new Set(this.dirtyObservers);
    for (const id of initial) {
      const st = this.observers.get(id);
      if (st) this.recompute(st);
    }
    for (const id of this.dirtyEntities) {
      const affected = new Set<EntityId>();
      for (const k of this.entitySectors.get(id) ?? [])
        for (const oid of this.sectorObservers.get(k) ?? []) affected.add(oid);
      for (const st of this.observers.values())
        if (st.visible.has(id)) affected.add(st.observer.id);
      for (const oid of affected) {
        if (!initial.has(oid)) this.recheck(this.observers.get(oid) as ObserverState, id);
      }
    }
    this.dirtyEntities.clear();
    // Переполнение, обнаруженное по ходу: полный приоритетный отбор.
    for (const id of this.dirtyObservers) {
      const st = this.observers.get(id);
      if (st && !initial.has(id)) this.recompute(st);
    }
    this.dirtyObservers.clear();
    for (const st of this.observers.values()) {
      for (const [cid, c] of st.containers) {
        if (!c.at) continue;
        const o = st.observer;
        const far =
          c.at.realm !== o.realm ||
          Math.max(Math.abs(c.at.x - o.x), Math.abs(c.at.y - o.y)) > this.o.containerReach;
        if (far) this.closeInternal(st, cid);
      }
      if (st.closed.length > 0 || st.reset) {
        const diff = this.diffOf(st.observer.id);
        diff.closedContainers.push(...st.closed);
        diff.reset ||= st.reset;
        st.closed = [];
        st.reset = false;
      }
    }
    const out = new Map<EntityId, AoiDiff>();
    for (const [id, diff] of this.pending) {
      if (diff.added.length || diff.removed.length || diff.closedContainers.length || diff.reset)
        out.set(id, diff);
    }
    this.pending = new Map();
    return out;
  }
}
