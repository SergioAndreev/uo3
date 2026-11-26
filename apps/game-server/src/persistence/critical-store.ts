import type { Database } from '@duskmarch/db';
import {
  commitCritical,
  findCriticalTx,
  type PartitionLeaseRepo,
  type WriteRow,
} from '@duskmarch/db/world';
import type { CommitRequest, CriticalPorts } from './critical.js';

/** Порты координатора на PostgreSQL: реестр, одна транзакция с журналом предметов. */
export function dbCriticalPorts(
  db: Database,
  shardId: string,
  realm: string,
  lease: PartitionLeaseRepo,
  epoch: () => number,
  serialize: CriticalPorts['serialize'],
  audit?: CriticalPorts['audit'],
): CriticalPorts {
  return {
    find: async (key) => {
      const row = await findCriticalTx(db, shardId, key);
      return row
        ? {
            txId: row.txId,
            payloadHash: row.payloadHash,
            result: row.result as Record<string, unknown>,
          }
        : null;
    },
    commit: (r: CommitRequest) => {
      const now = new Date();
      return commitCritical(db, {
        shardId,
        txId: r.txId,
        txType: r.txType,
        idempotencyKey: r.idempotencyKey,
        payloadHash: r.payloadHash,
        actorAccountId: r.actor?.accountId ?? null,
        prior: r.prior as unknown as WriteRow[],
        upserts: r.upserts as unknown as WriteRow[],
        deletes: r.deletes,
        ledger: r.ledger.map((l) => ({
          shardId,
          createdAt: now,
          txId: r.txId,
          txType: r.txType,
          eventKind: l.eventKind,
          itemId: l.itemId,
          sourceItemId: l.sourceItemId ?? null,
          amountDelta: l.amountDelta ?? 0,
          fromOwnerId: l.fromOwnerId ?? null,
          toOwnerId: l.toOwnerId ?? null,
          fromParentId: l.fromParentId ?? null,
          toParentId: l.toParentId ?? null,
          actorAccountId: r.actor?.accountId ?? null,
          actorAccessLevel: r.actor?.accessLevel ?? null,
          characterId: l.characterId ?? r.actor?.characterId ?? null,
          realm: l.x !== undefined ? realm : null,
          x: l.x ?? null,
          y: l.y ?? null,
          h: l.h ?? null,
          reasonCode: r.reason ? r.txType.toLowerCase() : null,
          details: r.reason ? { reason: r.reason } : {},
        })),
        result: r.result,
        now,
        assertEpoch: (tx) => lease.assertEpoch(tx, epoch()),
        grantStarterFor: r.grantStarterFor ?? null,
      });
    },
    serialize,
    ...(audit ? { audit } : {}),
  };
}
