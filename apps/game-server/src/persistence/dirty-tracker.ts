import type { EntityId } from '@duskmarch/domain';
import type { Entity } from '../engine/partition.js';

/** Группы сохраняемых полей. */
export const FIELD = {
  CREATED: 1,
  POSITION: 2,
  VITALS: 4,
  STATS: 8,
  SKILLS: 16,
  APPEARANCE: 32,
  CONTAINER: 64,
  COMPONENTS: 128,
  LIFECYCLE: 256,
  DELETED: 512,
} as const;
export type FieldGroup = keyof typeof FIELD;

export interface DirtyEntry<T> {
  readonly id: EntityId;
  kind: Entity['kind'];
  mask: number;
  changeSeq: number;
  /** Версия в БД (`0` — ещё не записана). */
  version: number;
  /** Строка, снятая при выгрузке из памяти, — сущности в ядре больше нет. */
  frozen?: T;
}

export interface Captured<T> {
  id: EntityId;
  kind: Entity['kind'];
  mask: number;
  changeSeq: number;
  version: number;
  /** Состояние для записи; `null` — удаление без строки (только надгробие). */
  row: T | null;
}

export interface TrackedCore {
  get(id: EntityId): Entity | undefined;
}

/**
 * Отметки изменений сущностей партиции из хука `onDirty` ядра P06 и явных `mark`.
 * Загрузка (сущность с версией в БД) изменением не считается; создание и удаление
 * в одном интервале без записи схлопываются.
 */
export class DirtyTracker<T> {
  private readonly entries = new Map<EntityId, DirtyEntry<T>>();
  private readonly versions = new Map<EntityId, { kind: Entity['kind']; version: number }>();
  private seq = 0;
  /** Время первой несохранённой отметки (для порога RPO). */
  oldestMs: number | null = null;

  constructor(
    private readonly core: TrackedCore,
    private readonly serialize: (entity: Entity) => T,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(id: EntityId): boolean {
    return this.entries.has(id);
  }

  entry(id: EntityId): Readonly<DirtyEntry<T>> | undefined {
    return this.entries.get(id);
  }

  versionOf(id: EntityId): number {
    return (
      this.entries.get(id)?.version ??
      this.versions.get(id)?.version ??
      this.core.get(id)?.data?.entityVersion ??
      0
    );
  }

  /** Обработчик `onDirty` ядра. */
  onDirty(id: EntityId, reason: string): void {
    const entity = this.core.get(id);
    if (entity)
      this.versions.set(id, {
        kind: entity.kind,
        version: entity.data?.entityVersion ?? this.versions.get(id)?.version ?? 0,
      });
    if (reason === 'spawned') {
      if (!entity || entity.kind === 'hero') return;
      if ((entity.data?.entityVersion ?? 0) > 0) return;
      this.mark(id, FIELD.CREATED);
      return;
    }
    if (reason === 'moved') this.mark(id, FIELD.POSITION);
    else if (reason.startsWith('placed:')) this.mark(id, FIELD.CONTAINER | FIELD.POSITION);
    else if (reason === 'deleted') this.mark(id, FIELD.DELETED);
    else if (reason === 'despawned') this.freeze(id);
  }

  /** Явная отметка группы полей (ресурсы, навыки, компоненты…). */
  mark(id: EntityId, mask: number): void {
    const known = this.versions.get(id);
    const entity = this.core.get(id);
    const kind = entity?.kind ?? known?.kind;
    if (!kind) return;
    const current = this.entries.get(id);
    const version = current?.version ?? known?.version ?? entity?.data?.entityVersion ?? 0;
    if (mask & FIELD.DELETED && version === 0 && (current?.mask ?? FIELD.CREATED) & FIELD.CREATED) {
      // Создан и удалён до первой записи: в БД нечего писать, идентификатор не переиспользуется.
      this.entries.delete(id);
      this.versions.delete(id);
      this.touchOldest();
      return;
    }
    this.seq++;
    if (current) {
      current.mask |= mask;
      current.changeSeq = this.seq;
    } else {
      this.entries.set(id, { id, kind, mask, changeSeq: this.seq, version });
      this.oldestMs ??= this.now();
    }
    if (mask & FIELD.DELETED) this.versions.delete(id);
  }

  /** Выгрузка из памяти с несохранёнными изменениями: строка снимается сейчас. */
  private freeze(id: EntityId): void {
    const entry = this.entries.get(id);
    const entity = this.core.get(id);
    if (entry && entity && !(entry.mask & FIELD.DELETED)) entry.frozen = this.serialize(entity);
  }

  /** Снимок не более `limit` записей (порядок — по `EntityId`); строки сериализуются сейчас. */
  capture(limit = Infinity, from?: Iterable<EntityId>): Captured<T>[] {
    const ids = [...(from ?? this.entries.keys())].sort((a, b) => a - b);
    const out: Captured<T>[] = [];
    for (const id of ids) {
      if (out.length >= limit) break;
      const e = this.entries.get(id);
      if (!e) continue;
      const entity = this.core.get(id);
      const row =
        e.mask & FIELD.DELETED ? null : (e.frozen ?? (entity ? this.serialize(entity) : null));
      out.push({ id, kind: e.kind, mask: e.mask, changeSeq: e.changeSeq, version: e.version, row });
    }
    return out;
  }

  /**
   * Запись подтверждена: новая версия; отметка снимается, только если после снимка не было изменений.
   * `version = null` — запись пропущена из-за конфликта версий (состояние в БД новее), отметка снимается.
   */
  ack(id: EntityId, capturedSeq: number, version: number | null): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (version !== null) e.version = version;
    const known = this.versions.get(id);
    if (known && version !== null) known.version = version;
    const entity = this.core.get(id);
    if (entity?.data && version !== null) entity.data.entityVersion = version;
    if (e.changeSeq === capturedSeq) {
      this.entries.delete(id);
      if (e.mask & FIELD.DELETED || !entity) this.versions.delete(id);
    } else {
      e.mask &= ~FIELD.CREATED;
      delete e.frozen;
    }
    this.touchOldest();
  }

  /** Сущность записана критической транзакцией: изменения до `upToSeq` считаются сохранёнными. */
  settle(id: EntityId, version: number, upToSeq = this.seq): void {
    const e = this.entries.get(id);
    if (!e) {
      const known = this.versions.get(id);
      if (known) known.version = version;
      const data = this.core.get(id)?.data;
      if (data) data.entityVersion = version;
      return;
    }
    this.ack(id, e.changeSeq <= upToSeq ? e.changeSeq : -1, version);
  }

  get changeSeq(): number {
    return this.seq;
  }

  private touchOldest(): void {
    if (this.entries.size === 0) this.oldestMs = null;
  }
}
