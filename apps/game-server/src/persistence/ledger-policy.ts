import type { LedgerInsert } from '@duskmarch/db/world';
import type { BatchResult, FlushBatch } from './flush.js';

/** Флаги компонентов, делающие предмет ценным для журнала. */
const VALUABLE_FLAGS = ['unique', 'enchanted', 'deed', 'staffGranted'] as const;

/** Ценный предмет: монеты, уникальные, зачарованные, грамоты на постройки, выданные персоналом. */
export function isValuable(
  contentKey: string | undefined,
  components: Record<string, unknown> | undefined = {},
): boolean {
  if (!contentKey) return false;
  if (/-coin$/.test(contentKey) || contentKey.startsWith('item.deed-')) return true;
  return VALUABLE_FLAGS.some((f) => Boolean(components?.[f]));
}

/** Фоновые события журнала по политике ценности для записанной части пакета. */
export function backgroundLedger(
  shardId: string,
  txId: string,
  batch: FlushBatch,
  result: BatchResult,
  now: Date,
): LedgerInsert[] {
  const written = new Set(result.written);
  const deleted = new Set(result.deleted);
  const rows: LedgerInsert[] = [];
  const base = { shardId, txId, txType: 'BACKGROUND', createdAt: now, details: {} };
  for (const { row, expectedVersion } of batch.upserts) {
    const contentKey = row['contentKey'] as string | undefined;
    if (
      !written.has(row.entityId) ||
      !isValuable(contentKey, row['components'] as Record<string, unknown>)
    )
      continue;
    rows.push({
      ...base,
      eventKind: expectedVersion === 0 ? 'CREATE' : 'MODIFY',
      itemId: row.entityId,
      amountDelta: expectedVersion === 0 ? ((row['amount'] as number | undefined) ?? 1) : 0,
      toOwnerId: (row['rootOwnerId'] as number | null | undefined) ?? null,
      toParentId: row.parentId,
      realm: (row['realm'] as string | null | undefined) ?? null,
      x: (row['x'] as number | null | undefined) ?? null,
      y: (row['y'] as number | null | undefined) ?? null,
      h: (row['h'] as number | null | undefined) ?? null,
    });
  }
  for (const d of batch.deletes) {
    if (deleted.has(d.entityId) && isValuable(d.contentKey, d.components)) {
      rows.push({ ...base, eventKind: 'DESTROY', itemId: d.entityId });
    }
  }
  return rows;
}
