import type { EntityId, Slot } from '@duskmarch/domain';
import type { Database } from '@duskmarch/db';
import {
  loadOwnedTree,
  streamPartition,
  writeBatch,
  type Bounds,
  type WorldRow,
} from '@duskmarch/db/world';
import { PersistError } from '@duskmarch/protocol';
import type { Entity, Placement } from '../engine/partition.js';

export const MAX_CONTAINER_DEPTH = 10;
export type LoadMode = 'strict' | 'quarantine';

/** Чистая миграция компонентов вида на одну версию вперёд. */
export type ComponentMigration = (components: Record<string, unknown>) => Record<string, unknown>;

/** Реестр миграций: `steps[v - 1]` переводит версию `v` в `v + 1`. */
export class ComponentMigrations {
  constructor(private readonly steps: readonly ComponentMigration[] = []) {}

  get current(): number {
    return this.steps.length + 1;
  }

  /** Строка на текущей версии; `migrated` — была ли миграция (сущность попадёт в сохранение). */
  apply(row: WorldRow): { row: WorldRow; migrated: boolean } {
    if (row.schemaVersion > this.current) {
      throw new PersistError(
        'PERSIST_UNSUPPORTED_SCHEMA_VERSION',
        `${row.entityId}: версия схемы ${row.schemaVersion} новее поддерживаемой ${this.current}`,
        { entityId: row.entityId, schemaVersion: row.schemaVersion, current: this.current },
      );
    }
    let components = row.components as Record<string, unknown>;
    for (let v = row.schemaVersion; v < this.current; v++) {
      components = (this.steps[v - 1] as ComponentMigration)(components);
    }
    return row.schemaVersion === this.current
      ? { row, migrated: false }
      : { row: { ...row, components, schemaVersion: this.current }, migrated: true };
  }
}

function placementOf(row: WorldRow): Placement | null {
  switch (row.placement) {
    case 'world':
      return { kind: 'world', x: row.x as number, y: row.y as number, h: row.h as number };
    case 'container':
    case 'bank':
      return { kind: 'container', parent: row.parentId as EntityId };
    case 'equipped':
      return { kind: 'equipped', holder: row.parentId as EntityId, slot: row.slot as Slot };
    default:
      return null;
  }
}

/** Строка БД → сущность ядра P06. */
export function rowToEntity(row: WorldRow): Entity | null {
  const placement = placementOf(row);
  if (!placement) return null;
  return {
    id: row.entityId as EntityId,
    kind: row.kind as Entity['kind'],
    placement,
    player: false,
    ...(row.rect ? { rect: row.rect as NonNullable<Entity['rect']> } : {}),
    height: 0,
    blocksSight: false,
    behaviors: [],
    data: {
      contentKey: row.contentKey,
      amount: row.amount,
      components: row.components as Record<string, unknown>,
      schemaVersion: row.schemaVersion,
      entityVersion: row.entityVersion,
      rootOwnerId: (row.rootOwnerId ?? null) as EntityId | null,
    },
  };
}

export interface LinkResult {
  entities: Entity[];
  /** Осиротевшие строки (режим `quarantine`): не загружаются, не удаляются. */
  quarantined: { row: WorldRow; reason: string }[];
  migrated: EntityId[];
}

/**
 * Связывание в два прохода: индекс строк, затем проверка родителей, циклов и глубины.
 * Цикл и повтор идентификатора блокируют загрузку всегда; битая ссылка — только в `strict`.
 * `external` — родители вне набора (герой-держатель снаряжения).
 */
export function linkContainers(
  rows: readonly WorldRow[],
  mode: LoadMode,
  migrations = new ComponentMigrations(),
  external: ReadonlySet<number> = new Set(),
): LinkResult {
  const byId = new Map<number, WorldRow>();
  for (const row of rows) {
    if (byId.has(row.entityId)) {
      throw new PersistError('PERSIST_WORLD_LOAD_CORRUPTED', `повтор EntityId ${row.entityId}`, {
        entityIds: [row.entityId],
      });
    }
    byId.set(row.entityId, row);
  }
  const quarantined: LinkResult['quarantined'] = [];
  const bad = new Set<number>();
  for (const row of rows) {
    if (row.placement === 'world' || row.placement === 'limbo') continue;
    const seen = new Set<number>([row.entityId]);
    let depth = 0;
    let current: WorldRow | undefined = row;
    while (current && current.placement !== 'world') {
      const parentId = current.parentId as number;
      if (external.has(parentId)) break;
      if (seen.has(parentId)) {
        throw new PersistError(
          'PERSIST_CONTAINER_CYCLE_DETECTED',
          `цикл контейнеров через ${parentId}`,
          { entityIds: [...seen] },
        );
      }
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        bad.add(row.entityId);
        quarantined.push({ row, reason: `нет родителя ${parentId}` });
        break;
      }
      if (++depth > MAX_CONTAINER_DEPTH) {
        bad.add(row.entityId);
        quarantined.push({ row, reason: `глубина больше ${MAX_CONTAINER_DEPTH}` });
        break;
      }
      current = parent;
    }
  }
  if (mode === 'strict' && quarantined.length > 0) {
    throw new PersistError('PERSIST_WORLD_LOAD_CORRUPTED', 'повреждённые ссылки контейнеров', {
      entityIds: quarantined.map((q) => q.row.entityId),
      parentIds: quarantined.map((q) => q.row.parentId),
    });
  }
  const entities: Entity[] = [];
  const migrated: EntityId[] = [];
  for (const raw of rows) {
    if (bad.has(raw.entityId)) continue;
    const { row, migrated: changed } = migrations.apply(raw);
    const entity = rowToEntity(row);
    if (!entity) continue;
    if (changed) migrated.push(entity.id);
    entities.push(entity);
  }
  return { entities, quarantined, migrated };
}

export interface LoadReport extends LinkResult {
  durationMs: number;
  batches: number;
}

/** Потоковая загрузка партиции из БД с метриками. */
export async function loadPartition(
  db: Database,
  shardId: string,
  realm: string,
  bounds: Bounds,
  opts: { mode?: LoadMode; batch?: number; migrations?: ComponentMigrations } = {},
): Promise<LoadReport> {
  const started = performance.now();
  const report: LoadReport = {
    entities: [],
    quarantined: [],
    migrated: [],
    durationMs: 0,
    batches: 0,
  };
  for await (const rows of streamPartition(db, shardId, realm, bounds, opts.batch)) {
    const linked = linkContainers(rows, opts.mode ?? 'quarantine', opts.migrations);
    report.entities.push(...linked.entities);
    report.quarantined.push(...linked.quarantined);
    report.migrated.push(...linked.migrated);
    report.batches++;
  }
  report.durationMs = performance.now() - started;
  return report;
}

/** Дерево владения героя: снаряжение, мешок, банк и вложенные контейнеры. */
export async function loadHeroTree(
  db: Database,
  shardId: string,
  hero: EntityId,
  migrations?: ComponentMigrations,
): Promise<Entity[]> {
  const rows = await loadOwnedTree(db, shardId, hero);
  return linkContainers(rows, 'quarantine', migrations, new Set([hero])).entities;
}

/** Карантин: строки переводятся в `limbo` с исходным родителем в компонентах, без удаления. */
export async function quarantineRows(
  db: Database,
  quarantined: LinkResult['quarantined'],
  now = new Date(),
): Promise<number> {
  if (quarantined.length === 0) return 0;
  const result = await writeBatch(
    db,
    quarantined.map(({ row, reason }) => ({
      row: {
        ...row,
        placement: 'limbo',
        parentId: null,
        slot: null,
        realm: null,
        x: null,
        y: null,
        h: null,
        components: {
          ...(row.components as Record<string, unknown>),
          quarantine: { parentId: row.parentId, slot: row.slot, reason, at: now.toISOString() },
        },
        updatedAt: now,
      },
      expectedVersion: row.entityVersion,
    })),
  );
  return result.written.length;
}
