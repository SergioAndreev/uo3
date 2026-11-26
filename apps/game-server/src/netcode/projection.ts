import type { StateView } from '@colyseus/schema';
import type { EntityId } from '@duskmarch/domain';
import {
  PartitionState,
  PrivateHeroState,
  ReplicatedBeing,
  ReplicatedContainerItem,
  ReplicatedEquip,
  ReplicatedItem,
  ReplicatedStructure,
} from '@duskmarch/protocol/state';
import type { AoiDiff, AoiKind } from './interest.js';

export type BaseReputation = 'neutral' | 'offender' | 'outcast' | 'invulnerable';
export type Relation = 'ally' | 'enemy' | 'attackable';

export interface BeingView {
  kind: 'hero' | 'creature';
  name: string;
  model: string;
  tint: number;
  x: number;
  y: number;
  h: number;
  direction: number;
  baseReputation: BaseReputation;
  statusFlags: number;
  healthPercent: number;
  mountModel: string;
  mountTint: number;
  /** Видимые слоты снаряжения. */
  equipment: Readonly<Record<string, { model: string; tint: number }>>;
}

export interface ItemView {
  contentKey: string;
  tint: number;
  amount: number;
  x: number;
  y: number;
  h: number;
  directionOrLight: number;
  flags: number;
  structureId: number;
  structureRevision: number;
}

export interface StructureView {
  contentKey: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  h: number;
  revision: number;
  flags: number;
}

export interface ContainerItemView {
  containerId: number;
  contentKey: string;
  tint: number;
  amount: number;
  gridX: number;
  gridY: number;
  flags: number;
}

export interface PrivateView {
  might: number;
  finesse: number;
  will: number;
  health: number;
  maxHealth: number;
  verve: number;
  maxVerve: number;
  resonance: number;
  maxResonance: number;
  weightKg: number;
  maxWeightKg: number;
  money: number;
  defense: number;
  personalLight: number;
  offenderRemainingMs: number;
  outcastKills: number;
}

/** Поставщики вида: ядро P06 не знает о схеме, данные приходят отсюда. */
export interface ViewProvider {
  being(id: EntityId): BeingView | undefined;
  item(id: EntityId): ItemView | undefined;
  structure(id: EntityId): StructureView | undefined;
  containerItem(id: EntityId): ContainerItemView | undefined;
  privateOf(hero: EntityId): PrivateView | undefined;
}

/** Отношение наблюдателя к цели (P17/P26); по умолчанию отношений нет. */
export type RelationProvider = (observer: EntityId, target: EntityId) => Relation | null;

type Obj = Record<string, unknown>;

/** Присваивание только изменённых примитивов: схема не получает лишних изменений. */
function assign(target: Obj, source: Obj): void {
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && typeof v === 'object') continue;
    if (target[k] !== v) target[k] = v;
  }
}

interface Client {
  view: StateView;
  priv: PrivateHeroState;
  /** Содержимое открытых контейнеров, видимое клиенту. */
  contents: Set<EntityId>;
}

type Shared = ReplicatedBeing | ReplicatedItem | ReplicatedStructure;

/**
 * Проекция ядра в состояние схемы: общие объекты сущностей со счётчиком наблюдателей,
 * `StateView` на клиента, приватное состояние только владельцу, отношения — по наблюдателю.
 */
export class ProjectionSync {
  private readonly clients = new Map<EntityId, Client>();
  private readonly shared = new Map<EntityId, { obj: Shared; kind: AoiKind; refs: number }>();
  private readonly containerItems = new Map<
    EntityId,
    { obj: ReplicatedContainerItem; refs: number }
  >();
  private readonly dirty = new Set<EntityId>();

  constructor(
    readonly state: PartitionState,
    private readonly views: ViewProvider,
    private readonly relations: RelationProvider = () => null,
  ) {}

  addClient(hero: EntityId, view: StateView): void {
    const priv = new PrivateHeroState();
    priv.entityId = hero;
    const data = this.views.privateOf(hero);
    if (data) assign(priv as unknown as Obj, data as unknown as Obj);
    this.state.privates.set(String(hero), priv);
    view.add(priv);
    this.clients.set(hero, { view, priv, contents: new Set() });
  }

  removeClient(hero: EntityId): void {
    const client = this.clients.get(hero);
    if (!client) return;
    for (const [id, entry] of this.shared) {
      if (client.view.has(entry.obj)) this.release(id);
    }
    for (const id of client.contents) this.releaseContainerItem(id);
    this.state.privates.delete(String(hero));
    this.clients.delete(hero);
  }

  private create(id: EntityId, kind: AoiKind): Shared | undefined {
    if (kind === 'being') {
      const v = this.views.being(id);
      if (!v) return undefined;
      const b = new ReplicatedBeing();
      b.entityId = id;
      this.fillBeing(b, v);
      this.state.beings.set(String(id), b);
      return b;
    }
    if (kind === 'item') {
      const v = this.views.item(id);
      if (!v) return undefined;
      const it = new ReplicatedItem();
      it.entityId = id;
      assign(it as unknown as Obj, v as unknown as Obj);
      this.state.items.set(String(id), it);
      return it;
    }
    const v = this.views.structure(id);
    if (!v) return undefined;
    const s = new ReplicatedStructure();
    s.entityId = id;
    assign(s as unknown as Obj, v as unknown as Obj);
    this.state.structures.set(String(id), s);
    return s;
  }

  private fillBeing(b: ReplicatedBeing, v: BeingView): void {
    assign(b as unknown as Obj, v as unknown as Obj);
    for (const slot of [...b.equipment.keys()])
      if (!(slot in v.equipment)) b.equipment.delete(slot);
    for (const [slot, e] of Object.entries(v.equipment)) {
      let eq = b.equipment.get(slot);
      if (!eq) {
        eq = new ReplicatedEquip();
        b.equipment.set(slot, eq);
      }
      assign(eq as unknown as Obj, e as unknown as Obj);
    }
  }

  private collection(kind: AoiKind) {
    return kind === 'being'
      ? this.state.beings
      : kind === 'item'
        ? this.state.items
        : this.state.structures;
  }

  private release(id: EntityId): void {
    const entry = this.shared.get(id);
    if (!entry) return;
    if (--entry.refs > 0) return;
    this.collection(entry.kind).delete(String(id));
    this.shared.delete(id);
  }

  /** Изменения области интереса одного наблюдателя. */
  apply(observer: EntityId, diff: AoiDiff): void {
    const client = this.clients.get(observer);
    if (!client) return;
    for (const { id } of diff.removed) {
      const entry = this.shared.get(id);
      if (entry && client.view.has(entry.obj)) {
        client.view.remove(entry.obj);
        this.release(id);
      }
      client.priv.relations.delete(String(id));
    }
    for (const { id, kind } of diff.added) {
      let entry = this.shared.get(id);
      if (!entry) {
        const obj = this.create(id, kind);
        if (!obj) continue;
        entry = { obj, kind, refs: 0 };
        this.shared.set(id, entry);
      }
      if (client.view.has(entry.obj)) continue;
      entry.refs++;
      client.view.add(entry.obj);
      if (kind === 'being' && id !== observer) {
        const relation = this.relations(observer, id);
        if (relation) client.priv.relations.set(String(id), relation);
      }
    }
  }

  /** Содержимое открытых контейнеров клиента (из `InterestManager.containerContents`). */
  syncContents(observer: EntityId, contents: ReadonlySet<EntityId>): void {
    const client = this.clients.get(observer);
    if (!client) return;
    for (const id of [...client.contents]) {
      if (contents.has(id)) continue;
      const entry = this.containerItems.get(id);
      if (entry) client.view.remove(entry.obj);
      client.contents.delete(id);
      this.releaseContainerItem(id);
    }
    for (const id of contents) {
      if (client.contents.has(id)) continue;
      let entry = this.containerItems.get(id);
      if (!entry) {
        const v = this.views.containerItem(id);
        if (!v) continue;
        const obj = new ReplicatedContainerItem();
        obj.entityId = id;
        assign(obj as unknown as Obj, v as unknown as Obj);
        this.state.containerItems.set(String(id), obj);
        entry = { obj, refs: 0 };
        this.containerItems.set(id, entry);
      }
      entry.refs++;
      client.contents.add(id);
      client.view.add(entry.obj);
    }
  }

  private releaseContainerItem(id: EntityId): void {
    const entry = this.containerItems.get(id);
    if (!entry || --entry.refs > 0) return;
    this.state.containerItems.delete(String(id));
    this.containerItems.delete(id);
  }

  /** Отношение изменилось (вступление в гильдию, объявление вражды). */
  refreshRelation(observer: EntityId, target: EntityId): void {
    const client = this.clients.get(observer);
    const entry = this.shared.get(target);
    if (!client || !entry || !client.view.has(entry.obj)) return;
    const relation = this.relations(observer, target);
    if (relation) client.priv.relations.set(String(target), relation);
    else client.priv.relations.delete(String(target));
  }

  /** Сущность изменилась: поля копируются в конце тика (коалесценция). */
  markDirty(id: EntityId): void {
    this.dirty.add(id);
  }

  /** Конец тика: перенос изменённых полей в схему. */
  flush(): void {
    for (const id of this.dirty) {
      const entry = this.shared.get(id);
      if (entry?.kind === 'being') {
        const v = this.views.being(id);
        if (v) this.fillBeing(entry.obj as ReplicatedBeing, v);
      } else if (entry?.kind === 'item') {
        const v = this.views.item(id);
        if (v) assign(entry.obj as unknown as Obj, v as unknown as Obj);
      } else if (entry?.kind === 'structure') {
        const v = this.views.structure(id);
        if (v) assign(entry.obj as unknown as Obj, v as unknown as Obj);
      }
      const ci = this.containerItems.get(id);
      const civ = ci && this.views.containerItem(id);
      if (ci && civ) assign(ci.obj as unknown as Obj, civ as unknown as Obj);
      const client = this.clients.get(id);
      const pv = client && this.views.privateOf(id);
      if (client && pv) assign(client.priv as unknown as Obj, pv as unknown as Obj);
    }
    this.dirty.clear();
  }

  /** Метаданные партиции. */
  setMeta(
    meta: Partial<
      Pick<
        PartitionState,
        'serverTick' | 'onlineCount' | 'gameTimeMinutes' | 'lightLevel' | 'season'
      >
    >,
  ): void {
    assign(this.state as unknown as Obj, meta as Obj);
  }

  /** Число клиентов, видящих сущность (для тестов). */
  refsOf(id: EntityId): number {
    return this.shared.get(id)?.refs ?? 0;
  }
}
