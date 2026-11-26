import type { EntityId } from '@duskmarch/domain';

export type IndexedKind = 'creature' | 'item' | 'structure';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Sector {
  /** Существа и герои. */
  creatures: Set<EntityId>;
  players: Set<EntityId>;
  items: Set<EntityId>;
  structures: Set<EntityId>;
}

interface Tracked {
  kind: IndexedKind;
  player: boolean;
  x: number;
  y: number;
  /** Секторы постройки (несколько) или один сектор точечной сущности. */
  sectors: number[];
  rect?: Rect;
}

/** Радиус активации вокруг сектора игрока, в секторах. */
export const ACTIVATION_RADIUS = 2;

export type SectorEvent = { type: 'activated' | 'deactivated'; sx: number; sy: number };

/** Пространственный индекс секторов N×N клеток в абсолютных координатах плана. */
export class SpatialIndex {
  private readonly sectors = new Map<number, Sector>();
  private readonly tracked = new Map<EntityId, Tracked>();
  private readonly activity = new Map<number, number>();

  constructor(
    readonly sectorSize = 16,
    private readonly onSector: (event: SectorEvent) => void = () => undefined,
  ) {}

  private key(sx: number, sy: number): number {
    return sy * 65_536 + sx;
  }

  sectorOf(x: number, y: number): [number, number] {
    return [Math.floor(x / this.sectorSize), Math.floor(y / this.sectorSize)];
  }

  private sector(key: number): Sector {
    let s = this.sectors.get(key);
    if (!s) {
      s = { creatures: new Set(), players: new Set(), items: new Set(), structures: new Set() };
      this.sectors.set(key, s);
    }
    return s;
  }

  private set(s: Sector, t: Tracked): Set<EntityId> {
    return t.kind === 'creature' ? s.creatures : t.kind === 'item' ? s.items : s.structures;
  }

  private attach(id: EntityId, t: Tracked): void {
    for (const k of t.sectors) {
      const s = this.sector(k);
      this.set(s, t).add(id);
      if (t.player) s.players.add(id);
    }
    if (t.player) this.bump(t.sectors[0] as number, +1);
  }

  private detach(id: EntityId, t: Tracked): void {
    for (const k of t.sectors) {
      const s = this.sectors.get(k);
      if (!s) continue;
      this.set(s, t).delete(id);
      s.players.delete(id);
      if (s.creatures.size + s.items.size + s.structures.size === 0) this.sectors.delete(k);
    }
    if (t.player) this.bump(t.sectors[0] as number, -1);
  }

  /** Счётчик игроков в окрестности сектора; переходы 0↔1 — события активации. */
  private bump(center: number, delta: number): void {
    const cx = center % 65_536;
    const cy = Math.floor(center / 65_536);
    for (let sy = cy - ACTIVATION_RADIUS; sy <= cy + ACTIVATION_RADIUS; sy++) {
      for (let sx = cx - ACTIVATION_RADIUS; sx <= cx + ACTIVATION_RADIUS; sx++) {
        if (sx < 0 || sy < 0) continue;
        const k = this.key(sx, sy);
        const before = this.activity.get(k) ?? 0;
        const after = before + delta;
        if (after === 0) this.activity.delete(k);
        else this.activity.set(k, after);
        if (before === 0 && after > 0) this.onSector({ type: 'activated', sx, sy });
        if (before > 0 && after === 0) this.onSector({ type: 'deactivated', sx, sy });
      }
    }
  }

  isActive(sx: number, sy: number): boolean {
    return (this.activity.get(this.key(sx, sy)) ?? 0) > 0;
  }

  has(id: EntityId): boolean {
    return this.tracked.has(id);
  }

  /** Точечная сущность: существо, герой (`player`) или предмет на земле. */
  insert(id: EntityId, kind: 'creature' | 'item', x: number, y: number, player = false): void {
    const [sx, sy] = this.sectorOf(x, y);
    const t: Tracked = { kind, player, x, y, sectors: [this.key(sx, sy)] };
    this.tracked.set(id, t);
    this.attach(id, t);
  }

  /** Постройка регистрируется во всех секторах своего прямоугольника. */
  insertStructure(id: EntityId, rect: Rect): void {
    const [x0, y0] = this.sectorOf(rect.minX, rect.minY);
    const [x1, y1] = this.sectorOf(rect.maxX, rect.maxY);
    const sectors: number[] = [];
    for (let sy = y0; sy <= y1; sy++)
      for (let sx = x0; sx <= x1; sx++) sectors.push(this.key(sx, sy));
    const t: Tracked = {
      kind: 'structure',
      player: false,
      x: rect.minX,
      y: rect.minY,
      sectors,
      rect: { ...rect },
    };
    this.tracked.set(id, t);
    this.attach(id, t);
  }

  remove(id: EntityId): boolean {
    const t = this.tracked.get(id);
    if (!t) return false;
    this.detach(id, t);
    this.tracked.delete(id);
    return true;
  }

  /** Перемещение: внутри сектора меняются только координаты. */
  move(id: EntityId, x: number, y: number): void {
    const t = this.tracked.get(id);
    if (!t || t.kind === 'structure') return;
    const [sx, sy] = this.sectorOf(x, y);
    const next = this.key(sx, sy);
    if (next !== t.sectors[0]) {
      this.detach(id, t);
      t.sectors = [next];
      t.x = x;
      t.y = y;
      this.attach(id, t);
      return;
    }
    t.x = x;
    t.y = y;
  }

  position(id: EntityId): { x: number; y: number } | undefined {
    const t = this.tracked.get(id);
    return t ? { x: t.x, y: t.y } : undefined;
  }

  /** Множество секторов сущности (для тестов и отладки). */
  sectorsOf(id: EntityId): [number, number][] {
    return (this.tracked.get(id)?.sectors ?? []).map((k) => [k % 65_536, Math.floor(k / 65_536)]);
  }

  /** Сущности вида в секторе (копия). */
  inSector(sx: number, sy: number, set: keyof Sector): EntityId[] {
    return [...(this.sectors.get(this.key(sx, sy))?.[set] ?? [])];
  }

  private visit(
    set: keyof Sector,
    x: number,
    y: number,
    r: number,
    visitor: (id: EntityId) => boolean | void,
  ) {
    const [x0, y0] = this.sectorOf(x - r, y - r);
    const [x1, y1] = this.sectorOf(x + r, y + r);
    for (let sy = Math.max(0, y0); sy <= y1; sy++) {
      for (let sx = Math.max(0, x0); sx <= x1; sx++) {
        const s = this.sectors.get(this.key(sx, sy));
        if (!s) continue;
        for (const id of s[set]) {
          const t = this.tracked.get(id) as Tracked;
          if (Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= r && visitor(id) === false)
            return false;
        }
      }
    }
    return true;
  }

  /**
   * Обход по расстоянию Чебышёва без выделения памяти; посетитель может прервать обход, вернув `false`.
   * `ordered` собирает результаты и сортирует по идентификатору.
   */
  forEachInRange(
    set: 'creatures' | 'players' | 'items',
    x: number,
    y: number,
    radius: number,
    visitor: (id: EntityId) => boolean | void,
    ordered = false,
  ): void {
    if (!ordered) {
      this.visit(set, x, y, radius, visitor);
      return;
    }
    const ids: EntityId[] = [];
    this.visit(set, x, y, radius, (id) => void ids.push(id));
    ids.sort((a, b) => a - b);
    for (const id of ids) if (visitor(id) === false) return;
  }

  /** Постройки, прямоугольник которых ближе `radius` по Чебышёву; каждая ровно один раз. */
  structuresInRange(x: number, y: number, radius: number): EntityId[] {
    const seen = new Set<EntityId>();
    const [x0, y0] = this.sectorOf(x - radius, y - radius);
    const [x1, y1] = this.sectorOf(x + radius, y + radius);
    for (let sy = Math.max(0, y0); sy <= y1; sy++) {
      for (let sx = Math.max(0, x0); sx <= x1; sx++) {
        for (const id of this.sectors.get(this.key(sx, sy))?.structures ?? []) {
          if (seen.has(id)) continue;
          const r = this.tracked.get(id)?.rect as Rect;
          const dx = x < r.minX ? r.minX - x : x > r.maxX ? x - r.maxX : 0;
          const dy = y < r.minY ? r.minY - y : y > r.maxY ? y - r.maxY : 0;
          if (Math.max(dx, dy) <= radius) seen.add(id);
        }
      }
    }
    return [...seen].sort((a, b) => a - b);
  }

  /** Сущности на одной клетке: существа, предметы на земле и постройки, покрывающие клетку. */
  forEachAt(
    x: number,
    y: number,
    visitor: (id: EntityId, kind: IndexedKind) => boolean | void,
  ): void {
    const [sx, sy] = this.sectorOf(x, y);
    const s = this.sectors.get(this.key(sx, sy));
    if (!s) return;
    for (const [set, kind] of [
      [s.items, 'item'],
      [s.creatures, 'creature'],
    ] as const) {
      for (const id of set) {
        const t = this.tracked.get(id) as Tracked;
        if (t.x === x && t.y === y && visitor(id, kind) === false) return;
      }
    }
    for (const id of s.structures) {
      const r = this.tracked.get(id)?.rect as Rect;
      if (
        x >= r.minX &&
        x <= r.maxX &&
        y >= r.minY &&
        y <= r.maxY &&
        visitor(id, 'structure') === false
      )
        return;
    }
  }

  get activeSectorCount(): number {
    return this.activity.size;
  }
}
