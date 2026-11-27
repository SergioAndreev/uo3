import { sql } from 'drizzle-orm';
import type { Executor } from './common.js';

export interface InvariantReport {
  ok: boolean;
  /** Повтор активного предмета в слоте держателя. */
  slotDuplicates: number;
  /** Сущности в цикле контейнеров. */
  cycles: number[];
  /** Вложенные предметы без активного родителя (и не у героя). */
  orphans: number[];
  /** Виды, у которых граница аренды не выше существующих номеров. */
  leaseBehind: string[];
}

/** Инварианты мира: единственный владелец, ацикличность, родители, границы аренды. */
export async function checkWorldInvariants(
  db: Executor,
  shardId?: string,
): Promise<InvariantReport> {
  const shard = shardId ? sql`AND w.shard_id = ${shardId}` : sql``;
  const dup = await db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM (
      SELECT shard_id, parent_id, slot FROM world_entities w
      WHERE placement = 'equipped' AND deleted_at IS NULL ${shard}
      GROUP BY shard_id, parent_id, slot HAVING count(*) > 1) d`);
  const cycles = await db.execute<{ entity_id: string }>(sql`
    WITH RECURSIVE chain(shard_id, start, current, depth, path) AS (
      SELECT w.shard_id, w.entity_id, w.parent_id, 1, ARRAY[w.entity_id]
      FROM world_entities w WHERE w.parent_id IS NOT NULL AND w.deleted_at IS NULL ${shard}
      UNION ALL
      SELECT c.shard_id, c.start, p.parent_id, c.depth + 1, c.path || p.entity_id
      FROM chain c JOIN world_entities p ON p.shard_id = c.shard_id AND p.entity_id = c.current
      WHERE p.parent_id IS NOT NULL AND p.deleted_at IS NULL AND NOT p.entity_id = ANY(c.path) AND c.depth < 64
    )
    SELECT DISTINCT start AS entity_id FROM chain WHERE current = start`);
  const orphans = await db.execute<{ entity_id: string }>(sql`
    SELECT w.entity_id FROM world_entities w
    WHERE w.placement IN ('container', 'equipped', 'bank') AND w.deleted_at IS NULL ${shard}
      AND NOT EXISTS (SELECT 1 FROM world_entities p WHERE p.shard_id = w.shard_id AND p.entity_id = w.parent_id AND p.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.shard_id = w.shard_id AND c.entity_id = w.parent_id AND c.status <> 'deleted')
    ORDER BY w.entity_id LIMIT 1000`);
  const behind = await db.execute<{ shard_id: string; kind: string }>(sql`
    SELECT s.shard_id, k.kind FROM shard_entity_sequences s
    CROSS JOIN LATERAL (VALUES ('creature', 2, s.next_creature), ('item', 3, s.next_item), ('structure', 4, s.next_structure)) AS k(kind, code, next)
    WHERE ${shardId ? sql`s.shard_id = ${shardId}` : sql`true`}
      AND EXISTS (SELECT 1 FROM world_entities w WHERE w.shard_id = s.shard_id
        AND w.entity_id >= (k.code::bigint << 29) + k.next AND w.entity_id < ((k.code::bigint + 1) << 29))`);
  const report: InvariantReport = {
    ok: false,
    slotDuplicates: Number(dup.rows[0]?.n ?? 0),
    cycles: cycles.rows.map((r) => Number(r.entity_id)),
    orphans: orphans.rows.map((r) => Number(r.entity_id)),
    leaseBehind: behind.rows.map((r) => `${r.shard_id}:${r.kind}`),
  };
  report.ok =
    report.slotDuplicates === 0 &&
    report.cycles.length === 0 &&
    report.orphans.length === 0 &&
    report.leaseBehind.length === 0;
  return report;
}
