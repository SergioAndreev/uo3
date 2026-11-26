import { randomUUID } from 'node:crypto';
import { itemLedger, type Database } from '@duskmarch/db';
import {
  softDeleteBatch,
  writeBatch,
  type PartitionLeaseRepo,
  type WriteRow,
} from '@duskmarch/db/world';
import type { EntityId } from '@duskmarch/domain';
import type { Entity } from '../engine/partition.js';
import { backgroundLedger } from './ledger-policy.js';
import { rootOwner, type BatchResult, type FlushBatch, type WorldRowOut } from './flush.js';

/** Сущность ядра → строка `world_entities`. */
export function entityToRow(
  shardId: string,
  realm: string,
  entity: Entity,
  get: (id: EntityId) => Entity | undefined,
  now = new Date(),
): WorldRowOut {
  const p = entity.placement;
  const data = entity.data;
  return {
    shardId,
    entityId: entity.id,
    kind: entity.kind,
    contentKey: data?.contentKey ?? `${entity.kind}.unknown`,
    placement: p.kind,
    realm: p.kind === 'world' ? realm : null,
    x: p.kind === 'world' ? p.x : null,
    y: p.kind === 'world' ? p.y : null,
    h: p.kind === 'world' ? p.h : null,
    parentId: p.kind === 'container' ? p.parent : p.kind === 'equipped' ? p.holder : null,
    slot: p.kind === 'equipped' ? p.slot : null,
    rootOwnerId: rootOwner(get, entity),
    rect: entity.rect ?? null,
    amount: data?.amount ?? 1,
    components: data?.components ?? {},
    schemaVersion: data?.schemaVersion ?? 1,
    changeSeq: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/** Порт записи пакета: эпоха партиции, вставка и обновление по версии, мягкое удаление — одной транзакцией. */
export function dbBatchWriter(
  db: Database,
  shardId: string,
  lease: PartitionLeaseRepo,
  epoch: () => number,
) {
  return async (batch: FlushBatch): Promise<BatchResult> =>
    db.transaction(async (tx) => {
      await lease.assertEpoch(tx, epoch());
      const upserted = await writeBatch(tx, batch.upserts as unknown as WriteRow[]);
      const deleted = await softDeleteBatch(tx, shardId, batch.deletes);
      const deletedSet = new Set(deleted);
      const result: BatchResult = {
        written: upserted.written,
        deleted,
        conflicts: [
          ...upserted.conflicts,
          ...batch.deletes.map((d) => d.entityId).filter((id) => !deletedSet.has(id)),
        ],
      };
      const ledger = backgroundLedger(shardId, randomUUID(), batch, result, new Date());
      if (ledger.length > 0) await tx.insert(itemLedger).values(ledger);
      return result;
    });
}
