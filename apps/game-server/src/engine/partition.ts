import {
  hasAccess,
  isStaff,
  type AccessLevel,
  type EntityId,
  type EntityKind,
  type IdAllocator,
  type Slot,
} from '@duskmarch/domain';
import { EngineError } from './errors.js';
import { SpatialIndex, type Rect, type SectorEvent } from './spatial-index.js';

export type Placement =
  | { kind: 'world'; x: number; y: number; h: number }
  | { kind: 'container'; parent: EntityId }
  | { kind: 'equipped'; holder: EntityId; slot: Slot };

/** Сущность партиции: герой, существо, предмет или постройка. */
export interface Entity {
  readonly id: EntityId;
  readonly kind: Exclude<EntityKind, 'ephemeral'>;
  placement: Placement;
  /** Герой под управлением игрока. */
  player: boolean;
  /** Постройка: прямоугольник клеток. */
  rect?: Rect;
  /** Высота модели в шагах (динамическое препятствие). */
  height: number;
  blocksSight: boolean;
  behaviors: Behavior[];
  /** Сохраняемые данные (P08): ключ контента, количество, компоненты, версии. */
  data?: EntityData;
}

export interface EntityData {
  contentKey: string;
  amount: number;
  components: Record<string, unknown>;
  schemaVersion: number;
  /** Версия в БД; `0` — ещё не записана. */
  entityVersion: number;
  /** Владелец дерева (герой или сущность на земле). */
  rootOwnerId: EntityId | null;
}

export interface Behavior {
  readonly key: string;
  onSpawn?(entity: Entity): void;
  onDespawn?(entity: Entity): void;
  onMove?(
    entity: Entity,
    from: { x: number; y: number; h: number },
    to: { x: number; y: number; h: number },
  ): void;
  onTick?(entity: Entity, tick: number): void;
}

export type PartitionEvent =
  | { type: 'entity.spawned' | 'entity.despawned' | 'entity.deleted'; id: EntityId }
  | { type: 'entity.moved'; id: EntityId; x: number; y: number; h: number }
  | { type: 'sector'; change: SectorEvent['type']; sx: number; sy: number };

export interface PartitionOptions {
  partitionId: string;
  realm: { key: string; width: number; height: number };
  bounds: Rect;
  sectorSize?: number;
  allocator: Pick<IdAllocator, 'next'>;
  hardCapacity?: number;
  staffBuffer?: number;
  onDirty?: (id: EntityId, reason: string) => void;
  onEvent?: (event: PartitionEvent) => void;
}

export type PartitionState = 'LOADING' | 'ACTIVE' | 'DISPOSED';

/** Ядро комнаты партиции без сети: реестр, индекс, поведения, ёмкость. */
export class PartitionCore {
  readonly id: string;
  readonly bounds: Rect;
  readonly index: SpatialIndex;
  state: PartitionState = 'LOADING';
  private readonly entities = new Map<EntityId, Entity>();
  private readonly behaviorKinds = new Map<string, () => Behavior>();
  readonly players = new Set<EntityId>();
  readonly hardCapacity: number;
  readonly staffBuffer: number;

  constructor(private readonly o: PartitionOptions) {
    const size = o.sectorSize ?? 16;
    const b = o.bounds;
    const aligned = [b.minX, b.minY, b.maxX + 1, b.maxY + 1].every((v) => v % size === 0);
    const inside = b.minX >= 0 && b.minY >= 0 && b.maxX < o.realm.width && b.maxY < o.realm.height;
    if (!aligned || !inside || b.minX > b.maxX || b.minY > b.maxY) {
      throw new EngineError(
        'PARTITION_INVALID_BOUNDS',
        `границы ${JSON.stringify(b)} для плана ${o.realm.width}×${o.realm.height}`,
      );
    }
    this.id = o.partitionId;
    this.bounds = { ...b };
    this.index = new SpatialIndex(size, (e) =>
      o.onEvent?.({ type: 'sector', change: e.type, sx: e.sx, sy: e.sy }),
    );
    this.hardCapacity = o.hardCapacity ?? 500;
    this.staffBuffer = o.staffBuffer ?? 20;
  }

  /** Секторная сетка партиции: столбцы × строки. */
  get grid(): [number, number] {
    const size = this.index.sectorSize;
    return [
      (this.bounds.maxX + 1 - this.bounds.minX) / size,
      (this.bounds.maxY + 1 - this.bounds.minY) / size,
    ];
  }

  contains(x: number, y: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }

  get(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  get size(): number {
    return this.entities.size;
  }

  registerBehavior(key: string, factory: () => Behavior): void {
    this.behaviorKinds.set(key, factory);
  }

  attach(id: EntityId, key: string): void {
    const entity = this.entities.get(id);
    const factory = this.behaviorKinds.get(key);
    if (entity && factory) entity.behaviors.push(factory());
  }

  private emit(event: PartitionEvent): void {
    this.o.onEvent?.(event);
  }

  private dirty(id: EntityId, reason: string): void {
    this.o.onDirty?.(id, reason);
  }

  private check(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      throw new EngineError('ERR_ENTITY_ID_COLLISION', `идентификатор ${entity.id} уже в партиции`);
    }
    const p = entity.placement;
    const rect = entity.rect;
    if (rect && !(this.contains(rect.minX, rect.minY) && this.contains(rect.maxX, rect.maxY))) {
      throw new EngineError(
        'PARTITION_ENTITY_OUT_OF_BOUNDS',
        `постройка ${entity.id} вне партиции`,
      );
    }
    if (p.kind === 'world' && !this.contains(p.x, p.y)) {
      throw new EngineError(
        'PARTITION_ENTITY_OUT_OF_BOUNDS',
        `(${p.x}, ${p.y}) вне партиции ${this.id}`,
      );
    }
    if (p.kind !== 'world' && entity.kind !== 'item') {
      throw new EngineError(
        'PARTITION_PLACEMENT_INVALID',
        'в контейнере или снаряжении бывают только предметы',
      );
    }
  }

  private index_(entity: Entity): void {
    const p = entity.placement;
    if (entity.kind === 'structure' && entity.rect)
      this.index.insertStructure(entity.id, entity.rect);
    else if (p.kind === 'world')
      this.index.insert(
        entity.id,
        entity.kind === 'item' ? 'item' : 'creature',
        p.x,
        p.y,
        entity.player,
      );
  }

  /** Загрузка начальных сущностей: всё проверяется до регистрации, ошибка — ни одной сущности. */
  hydrate(initial: Entity[]): void {
    const ids = new Set<EntityId>();
    try {
      for (const e of initial) {
        if (ids.has(e.id)) throw new EngineError('ERR_ENTITY_ID_COLLISION', `повтор ${e.id}`);
        ids.add(e.id);
        this.check(e);
      }
    } catch (error) {
      throw new EngineError(
        'PARTITION_HYDRATION_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
    for (const e of initial) this.add(e, false);
    this.state = 'ACTIVE';
  }

  private add(entity: Entity, notify: boolean): void {
    this.entities.set(entity.id, entity);
    this.index_(entity);
    if (entity.player) this.players.add(entity.id);
    if (notify) {
      for (const b of entity.behaviors) b.onSpawn?.(entity);
      this.emit({ type: 'entity.spawned', id: entity.id });
      this.dirty(entity.id, 'spawned');
    }
  }

  spawn(entity: Entity): Entity {
    this.check(entity);
    this.add(entity, true);
    return entity;
  }

  /** Новая сущность с идентификатором из аллокатора партиции. */
  create(
    kind: 'creature' | 'item' | 'structure',
    init: Omit<Entity, 'id' | 'kind' | 'behaviors' | 'player' | 'height' | 'blocksSight'> &
      Partial<Pick<Entity, 'height' | 'blocksSight'>>,
  ): Entity {
    return this.spawn({
      id: this.o.allocator.next(kind),
      kind,
      player: false,
      height: 0,
      blocksSight: false,
      behaviors: [],
      ...init,
    });
  }

  /** Убирает сущность из мира партиции (выход героя, уход в другую партицию). */
  despawn(id: EntityId, deleted = false): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    for (const b of entity.behaviors) b.onDespawn?.(entity);
    // Отметка до удаления: слой сохранения (P08) успевает снять строку выгружаемой сущности.
    this.dirty(id, deleted ? 'deleted' : 'despawned');
    this.index.remove(id);
    this.entities.delete(id);
    this.players.delete(id);
    this.emit({ type: deleted ? 'entity.deleted' : 'entity.despawned', id });
    return true;
  }

  move(id: EntityId, x: number, y: number, h: number): void {
    const entity = this.entities.get(id);
    if (!entity || entity.placement.kind !== 'world') return;
    if (!this.contains(x, y)) {
      throw new EngineError(
        'PARTITION_ENTITY_OUT_OF_BOUNDS',
        `(${x}, ${y}) вне партиции ${this.id}`,
      );
    }
    const from = { x: entity.placement.x, y: entity.placement.y, h: entity.placement.h };
    entity.placement = { kind: 'world', x, y, h };
    this.index.move(id, x, y);
    for (const b of entity.behaviors) b.onMove?.(entity, from, { x, y, h });
    this.emit({ type: 'entity.moved', id, x, y, h });
    this.dirty(id, 'moved');
  }

  /** Перенос предмета: ровно одно состояние размещения; в индексе только предметы на земле. */
  place(id: EntityId, placement: Placement): void {
    const item = this.entities.get(id);
    if (!item || item.kind !== 'item')
      throw new EngineError('PARTITION_PLACEMENT_INVALID', `${id} не предмет партиции`);
    if (placement.kind === 'world' && !this.contains(placement.x, placement.y)) {
      throw new EngineError(
        'PARTITION_ENTITY_OUT_OF_BOUNDS',
        `(${placement.x}, ${placement.y}) вне партиции`,
      );
    }
    const parent =
      placement.kind === 'container'
        ? placement.parent
        : placement.kind === 'equipped'
          ? placement.holder
          : null;
    if (parent !== null && (parent === id || !this.entities.has(parent))) {
      throw new EngineError('PARTITION_PLACEMENT_INVALID', `родитель ${String(parent)} не найден`);
    }
    this.index.remove(id);
    item.placement = { ...placement };
    if (placement.kind === 'world') this.index.insert(id, 'item', placement.x, placement.y);
    this.emit({
      type: 'entity.moved',
      id,
      ...(placement.kind === 'world' ? placement : { x: -1, y: -1, h: 0 }),
    });
    this.dirty(id, `placed:${placement.kind}`);
  }

  /** Динамические препятствия клетки для линии видимости и опор (предметы на земле и постройки). */
  forEachDynamicAt(x: number, y: number, visitor: (entity: Entity) => boolean | void): void {
    this.index.forEachAt(x, y, (id, kind) => {
      if (kind === 'creature') return undefined;
      return visitor(this.entities.get(id) as Entity);
    });
  }

  /** Препятствия для `lineOfSight(..., { dynamic })` P03. */
  obstaclesAt = (x: number, y: number) => {
    const out: { base: number; top: number; blocksSight: boolean }[] = [];
    this.forEachDynamicAt(x, y, (e) => {
      const base = e.placement.kind === 'world' ? e.placement.h : 0;
      out.push({ base, top: base + e.height, blocksSight: e.blocksSight });
    });
    return out;
  };

  /** Хуки `onTick` поведений в детерминированном порядке (по идентификатору). */
  tick(tick: number): void {
    const ids = [...this.entities.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const entity = this.entities.get(id);
      if (entity) for (const b of entity.behaviors) b.onTick?.(entity, tick);
    }
  }

  /** Можно ли впустить ещё одного героя с этим уровнем. */
  admits(level: AccessLevel): boolean {
    const n = this.players.size;
    if (n < this.hardCapacity) return true;
    return isStaff(level) && hasAccess(level, 'helper') && n < this.hardCapacity + this.staffBuffer;
  }

  /** Утилизация: финальное сохранение, очистка реестра. */
  dispose(finalFlush?: (entities: Entity[]) => void): void {
    finalFlush?.([...this.entities.values()]);
    for (const id of [...this.entities.keys()]) this.index.remove(id);
    this.entities.clear();
    this.players.clear();
    this.state = 'DISPOSED';
  }

  /** Сущности по возрастанию идентификатора (для отпечатка стенда). */
  all(): Entity[] {
    return [...this.entities.values()].sort((a, b) => a.id - b.id);
  }
}
