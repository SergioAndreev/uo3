import { randomUUID } from 'node:crypto';
import { KIND_CODES, KIND_SHIFT } from '@duskmarch/domain';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  characterSkills,
  characters,
  criticalTransactions,
  itemLedger,
  partitionLeases,
  restoreOperations,
  shardEntitySequences,
  shards,
  worldEntities,
  worldTimers,
} from '../schema/index.js';
import { WorldStoreError, type WorldRow } from './common.js';
import { checkWorldInvariants, type InvariantReport } from './invariants.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** Состояние героя для отката: строка, навыки, дерево владения. */
export interface HeroSnapshot {
  character: {
    id: string;
    entityId: number;
    realm: string;
    x: number;
    y: number;
    h: number;
    stats: unknown;
    appearance: unknown;
    health: number | null;
    verve: number | null;
    resonance: number | null;
  };
  skills: { skill: string; tenths: number }[];
  items: WorldRow[];
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function heroSnapshot(
  db: Executor,
  shardId: string,
  characterId: string,
): Promise<HeroSnapshot | null> {
  const [c] = await db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.shardId, shardId)));
  if (!c) return null;
  const skills = await db
    .select({ skill: characterSkills.skill, tenths: characterSkills.tenths })
    .from(characterSkills)
    .where(eq(characterSkills.characterId, characterId))
    .orderBy(characterSkills.skill);
  const items = await db
    .select()
    .from(worldEntities)
    .where(
      and(
        eq(worldEntities.shardId, shardId),
        eq(worldEntities.rootOwnerId, c.entityId),
        isNull(worldEntities.deletedAt),
      ),
    )
    .orderBy(worldEntities.entityId);
  return json({
    character: {
      id: c.id,
      entityId: c.entityId,
      realm: c.realm,
      x: c.x,
      y: c.y,
      h: c.h,
      stats: c.stats,
      appearance: c.appearance,
      health: c.health,
      verve: c.verve,
      resonance: c.resonance,
    },
    skills,
    items,
  });
}

/** Разница состояний героя для предпросмотра. */
export function heroDiff(current: HeroSnapshot, target: HeroSnapshot) {
  const cur = new Map(current.items.map((i) => [i.entityId, i]));
  const tgt = new Map(target.items.map((i) => [i.entityId, i]));
  const same = (a: WorldRow, b: WorldRow) =>
    JSON.stringify([a.placement, a.parentId, a.slot, a.amount, a.contentKey, a.components]) ===
    JSON.stringify([b.placement, b.parentId, b.slot, b.amount, b.contentKey, b.components]);
  return {
    character: Object.keys(target.character).filter(
      (k) =>
        JSON.stringify(target.character[k as keyof HeroSnapshot['character']]) !==
        JSON.stringify(current.character[k as keyof HeroSnapshot['character']]),
    ),
    skills: target.skills
      .filter((s) => current.skills.find((c) => c.skill === s.skill)?.tenths !== s.tenths)
      .map((s) => s.skill),
    itemsRestored: [...tgt.keys()].filter((id) => !cur.has(id)),
    itemsRemoved: [...cur.keys()].filter((id) => !tgt.has(id)),
    itemsChanged: [...tgt.keys()].filter(
      (id) => cur.has(id) && !same(cur.get(id) as WorldRow, tgt.get(id) as WorldRow),
    ),
  };
}

export interface RestoreActor {
  accountId: string;
  accessLevel: string;
  reason: string;
}

async function ledgerRestore(
  tx: Tx,
  shardId: string,
  txId: string,
  actor: RestoreActor,
  characterId: string | null,
  events: { itemId: number; eventKind: string; toOwnerId?: number | null; amountDelta?: number }[],
) {
  if (events.length === 0) return;
  const now = new Date();
  await tx.insert(itemLedger).values(
    events.map((e) => ({
      shardId,
      txId,
      txType: 'ROLLBACK_RESTORE',
      createdAt: now,
      eventKind: e.eventKind,
      itemId: e.itemId,
      amountDelta: e.amountDelta ?? 0,
      toOwnerId: e.toOwnerId ?? null,
      actorAccountId: actor.accountId,
      actorAccessLevel: actor.accessLevel,
      characterId,
      reasonCode: 'rollback_restore',
      details: { reason: actor.reason },
    })),
  );
}

async function registerTx(
  tx: Tx,
  shardId: string,
  txId: string,
  actor: RestoreActor,
  payload: unknown,
) {
  const now = new Date();
  await tx.insert(criticalTransactions).values({
    txId,
    shardId,
    txType: 'ROLLBACK_RESTORE',
    payloadHash: sql`encode(sha256(${JSON.stringify(payload)}::bytea), 'hex')` as unknown as string,
    status: 'committed',
    actorAccountId: actor.accountId,
    createdAt: now,
    committedAt: now,
  });
}

/** Перенос героя в состояние `target` одной транзакцией; предмет у другого владельца — конфликт. */
async function applyHero(
  tx: Tx,
  shardId: string,
  target: HeroSnapshot,
  txId: string,
  actor: RestoreActor,
): Promise<{ before: HeroSnapshot; after: HeroSnapshot }> {
  await tx.execute(sql`SELECT 1 FROM characters WHERE id = ${target.character.id} FOR UPDATE`);
  const before = (await heroSnapshot(tx, shardId, target.character.id)) as HeroSnapshot;
  const hero = before.character.entityId;
  const ids = target.items.map((i) => i.entityId);
  const elsewhere = ids.length
    ? await tx
        .select({ id: worldEntities.entityId, owner: worldEntities.rootOwnerId })
        .from(worldEntities)
        .where(
          and(
            eq(worldEntities.shardId, shardId),
            inArray(worldEntities.entityId, ids),
            isNull(worldEntities.deletedAt),
            sql`${worldEntities.rootOwnerId} IS DISTINCT FROM ${hero}`,
          ),
        )
    : [];
  if (elsewhere.length > 0) {
    throw new WorldStoreError(
      'PERSIST_RESTORE_DUPE_CONFLICT',
      'предметы активны у другого владельца',
      { items: elsewhere },
    );
  }
  const c = target.character;
  await tx
    .update(characters)
    .set({
      realm: c.realm,
      x: c.x,
      y: c.y,
      h: c.h,
      stats: c.stats,
      appearance: c.appearance,
      health: c.health,
      verve: c.verve,
      resonance: c.resonance,
    })
    .where(eq(characters.id, c.id));
  await tx.delete(characterSkills).where(eq(characterSkills.characterId, c.id));
  if (target.skills.length > 0)
    await tx
      .insert(characterSkills)
      .values(target.skills.map((s) => ({ characterId: c.id, ...s })));
  const now = new Date();
  const keep = new Set(ids);
  const removed = before.items.filter((i) => !keep.has(i.entityId));
  if (removed.length > 0) {
    await tx
      .update(worldEntities)
      .set({
        deletedAt: now,
        updatedAt: now,
        entityVersion: sql`${worldEntities.entityVersion} + 1`,
      })
      .where(
        and(
          eq(worldEntities.shardId, shardId),
          inArray(
            worldEntities.entityId,
            removed.map((r) => r.entityId),
          ),
        ),
      );
  }
  for (const item of target.items) {
    const { createdAt, ...rest } = item;
    await tx
      .insert(worldEntities)
      .values({ ...rest, createdAt: new Date(createdAt), updatedAt: now, deletedAt: null })
      .onConflictDoUpdate({
        target: [worldEntities.shardId, worldEntities.entityId],
        set: {
          placement: rest.placement,
          parentId: rest.parentId,
          slot: rest.slot,
          rootOwnerId: rest.rootOwnerId,
          realm: rest.realm,
          x: rest.x,
          y: rest.y,
          h: rest.h,
          amount: rest.amount,
          contentKey: rest.contentKey,
          components: rest.components,
          schemaVersion: rest.schemaVersion,
          deletedAt: null,
          updatedAt: now,
          entityVersion: sql`${worldEntities.entityVersion} + 1`,
        },
      });
  }
  await ledgerRestore(tx, shardId, txId, actor, c.id, [
    ...target.items.map((i) => ({
      itemId: i.entityId,
      eventKind: 'RESTORE',
      toOwnerId: hero,
      amountDelta: i.amount,
    })),
    ...removed.map((i) => ({ itemId: i.entityId, eventKind: 'DESTROY', amountDelta: -i.amount })),
  ]);
  return { before, after: target };
}

/** Точечный откат героя к состоянию из клона на метку `T`. */
export async function restoreHero(
  db: Database,
  input: {
    shardId: string;
    target: HeroSnapshot;
    targetTime: Date;
    actor: RestoreActor;
    now?: Date;
  },
): Promise<{ operationId: string; txId: string }> {
  const operationId = randomUUID();
  const txId = randomUUID();
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await registerTx(tx, input.shardId, txId, input.actor, {
      kind: 'character',
      id: input.target.character.id,
      t: input.targetTime,
    });
    const { before, after } = await applyHero(tx, input.shardId, input.target, txId, input.actor);
    await tx.insert(restoreOperations).values({
      id: operationId,
      shardId: input.shardId,
      kind: 'character',
      target: input.target.character.id,
      targetTime: input.targetTime,
      mode: 'strict_no_conflict',
      txId,
      beforeSnapshot: before,
      afterSnapshot: after,
      actorAccountId: input.actor.accountId,
      reason: input.actor.reason,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    });
  });
  return { operationId, txId };
}

export type ItemRestoreMode = 'strict_no_conflict' | 'reclaim_original' | 'reissue_new_id';

/**
 * Восстановление предмета в банк героя: надгробие снимается; активный у другого владельца —
 * конфликт, изъятие или новый идентификатор. Производные активные стопки — конфликт.
 */
export async function restoreItem(
  db: Database,
  input: {
    shardId: string;
    itemId: number;
    toCharacterId: string;
    mode: ItemRestoreMode;
    actor: RestoreActor;
    now?: Date;
    newId?: () => Promise<number>;
  },
): Promise<{ operationId: string; txId: string; itemId: number; previousOwner: number | null }> {
  const operationId = randomUUID();
  const txId = randomUUID();
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [hero] = await tx
      .select()
      .from(characters)
      .where(and(eq(characters.id, input.toCharacterId), eq(characters.shardId, input.shardId)));
    if (!hero) throw new WorldStoreError('PERSIST_CHARACTER_UNAVAILABLE', 'герой не найден');
    const [item] = await tx
      .execute<{ entity_id: string }>(
        sql`SELECT entity_id FROM world_entities WHERE shard_id = ${input.shardId} AND entity_id = ${input.itemId} FOR UPDATE`,
      )
      .then((r) => r.rows);
    const [row] = item
      ? await tx
          .select()
          .from(worldEntities)
          .where(
            and(eq(worldEntities.shardId, input.shardId), eq(worldEntities.entityId, input.itemId)),
          )
      : [];
    if (!row)
      throw new WorldStoreError(
        'PERSIST_RESTORE_DUPE_CONFLICT',
        'предмета нет ни в мире, ни среди надгробий',
      );
    const derived = await tx.execute<{ item_id: string }>(sql`
      SELECT DISTINCT l.item_id FROM item_ledger l JOIN world_entities w ON w.shard_id = l.shard_id AND w.entity_id = l.item_id
      WHERE l.shard_id = ${input.shardId} AND l.source_item_id = ${input.itemId} AND w.deleted_at IS NULL`);
    const active = row.deletedAt === null;
    const owner = row.rootOwnerId ?? null;
    if (active && owner === hero.entityId)
      throw new WorldStoreError('PERSIST_RESTORE_DUPE_CONFLICT', 'предмет уже у героя', {
        currentOwner: owner,
      });
    if ((active || derived.rows.length > 0) && input.mode === 'strict_no_conflict') {
      throw new WorldStoreError(
        'PERSIST_RESTORE_DUPE_CONFLICT',
        'восстановление создало бы второй экземпляр',
        {
          currentOwner: owner,
          derived: derived.rows.map((d) => Number(d.item_id)),
        },
      );
    }
    const before = json({ item: row });
    const bank = {
      placement: 'bank',
      parentId: hero.entityId,
      rootOwnerId: hero.entityId,
      slot: null,
      realm: null,
      x: null,
      y: null,
      h: null,
      deletedAt: null,
      updatedAt: now,
    };
    let id = input.itemId;
    await registerTx(tx, input.shardId, txId, input.actor, {
      kind: 'item',
      id: input.itemId,
      mode: input.mode,
    });
    if (input.mode === 'reissue_new_id' && active) {
      if (!input.newId)
        throw new WorldStoreError('PERSIST_TX_UNAVAILABLE', 'нет аренды идентификаторов');
      id = await input.newId();
      const { entityId: _old, ...copy } = row;
      void _old;
      await tx
        .insert(worldEntities)
        .values({ ...copy, ...bank, entityId: id, entityVersion: 1, createdAt: now });
      await ledgerRestore(tx, input.shardId, txId, input.actor, hero.id, [
        { itemId: id, eventKind: 'CREATE', toOwnerId: hero.entityId, amountDelta: row.amount },
      ]);
    } else {
      await tx
        .update(worldEntities)
        .set({ ...bank, entityVersion: sql`${worldEntities.entityVersion} + 1` })
        .where(
          and(eq(worldEntities.shardId, input.shardId), eq(worldEntities.entityId, input.itemId)),
        );
      await ledgerRestore(tx, input.shardId, txId, input.actor, hero.id, [
        { itemId: id, eventKind: active ? 'TRANSFER' : 'RESTORE', toOwnerId: hero.entityId },
      ]);
    }
    const [after] = await tx
      .select()
      .from(worldEntities)
      .where(and(eq(worldEntities.shardId, input.shardId), eq(worldEntities.entityId, id)));
    await tx.insert(restoreOperations).values({
      id: operationId,
      shardId: input.shardId,
      kind: 'item',
      target: String(input.itemId),
      mode: input.mode,
      txId,
      beforeSnapshot: before,
      afterSnapshot: json({ item: after }),
      actorAccountId: input.actor.accountId,
      reason: input.actor.reason,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    });
    return { operationId, txId, itemId: id, previousOwner: active ? owner : null };
  });
}

/** Отмена операции восстановления: возврат `beforeSnapshot`, если срок не истёк и нет конфликтов. */
export async function undoRestore(
  db: Database,
  input: { shardId: string; operationId: string; actor: RestoreActor; now?: Date },
): Promise<{ operationId: string }> {
  const now = input.now ?? new Date();
  const [op] = await db
    .select()
    .from(restoreOperations)
    .where(
      and(
        eq(restoreOperations.id, input.operationId),
        eq(restoreOperations.shardId, input.shardId),
      ),
    );
  if (!op) throw new WorldStoreError('PERSIST_ROLLBACK_PREVIEW_REQUIRED', 'операция не найдена');
  if (op.expiresAt.getTime() < now.getTime())
    throw new WorldStoreError('PERSIST_ROLLBACK_UNDO_EXPIRED', 'снимок операции очищен');
  if (op.undoneAt) throw new WorldStoreError('PERSIST_TX_CONFLICT', 'операция уже отменена');
  const operationId = randomUUID();
  const txId = randomUUID();
  await db.transaction(async (tx) => {
    await registerTx(tx, input.shardId, txId, input.actor, { undo: op.id });
    if (op.kind === 'character') {
      await applyHero(tx, input.shardId, op.beforeSnapshot as HeroSnapshot, txId, input.actor);
    } else {
      const { item } = op.beforeSnapshot as { item: WorldRow };
      const { item: after } = op.afterSnapshot as { item: WorldRow };
      if (after.entityId !== item.entityId) {
        await tx
          .update(worldEntities)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(worldEntities.shardId, input.shardId),
              eq(worldEntities.entityId, after.entityId),
            ),
          );
      }
      const { createdAt: _c, ...rest } = item;
      void _c;
      await tx
        .update(worldEntities)
        .set({
          ...rest,
          deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
          updatedAt: now,
          entityVersion: sql`${worldEntities.entityVersion} + 1`,
        })
        .where(
          and(eq(worldEntities.shardId, input.shardId), eq(worldEntities.entityId, item.entityId)),
        );
      await ledgerRestore(tx, input.shardId, txId, input.actor, null, [
        { itemId: item.entityId, eventKind: 'RESTORE', toOwnerId: item.rootOwnerId },
      ]);
    }
    await tx
      .update(restoreOperations)
      .set({ undoneAt: now })
      .where(eq(restoreOperations.id, op.id));
    await tx.insert(restoreOperations).values({
      id: operationId,
      shardId: input.shardId,
      kind: op.kind,
      target: op.target,
      mode: 'undo',
      txId,
      beforeSnapshot: op.afterSnapshot,
      afterSnapshot: op.beforeSnapshot,
      actorAccountId: input.actor.accountId,
      reason: input.actor.reason,
      undoOf: op.id,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    });
  });
  return { operationId };
}

/**
 * Сверка шарда после полного PITR до открытия входа: аренды партиций сбрасываются, границы
 * аренды `EntityId` поднимаются на `+4096` выше максимума, таймеры распада продлеваются на простой,
 * инварианты проверяются; при дефекте шард остаётся в обслуживании.
 */
export async function reconcileShard(
  db: Database,
  shardId: string,
  downtimeMs: number,
): Promise<InvariantReport> {
  await db.transaction(async (tx) => {
    await tx.delete(partitionLeases).where(eq(partitionLeases.shardId, shardId));
    await tx.insert(shardEntitySequences).values({ shardId }).onConflictDoNothing();
    for (const [kind, column] of [
      ['creature', 'next_creature'],
      ['item', 'next_item'],
      ['structure', 'next_structure'],
    ] as const) {
      const base = (KIND_CODES[kind] << KIND_SHIFT) >>> 0;
      await tx.execute(sql`
        UPDATE shard_entity_sequences SET ${sql.raw(column)} = GREATEST(${sql.raw(column)},
          COALESCE((SELECT max(entity_id) - ${base} FROM world_entities WHERE shard_id = ${shardId} AND entity_id BETWEEN ${base} AND ${base + 0x1fffffff}), 0) + 1) + 4096
        WHERE shard_id = ${shardId}`);
    }
    await tx
      .update(worldTimers)
      .set({ dueAt: sql`${worldTimers.dueAt} + make_interval(secs => ${downtimeMs / 1000})` })
      .where(and(eq(worldTimers.shardId, shardId), sql`${worldTimers.kind} LIKE 'decay%'`));
  });
  const report = await checkWorldInvariants(db, shardId);
  if (!report.ok) {
    await db
      .update(shards)
      .set({ manualStatus: 'maintenance', updatedAt: new Date() })
      .where(eq(shards.id, shardId));
    throw new WorldStoreError(
      'PERSIST_RECONCILIATION_FAILED',
      'инварианты мира нарушены',
      report as unknown as Record<string, unknown>,
    );
  }
  return report;
}

/** Аккаунт и статус героя шарда. */
export async function characterBrief(
  db: Executor,
  shardId: string,
  characterId: string,
): Promise<{ accountId: string; status: string } | null> {
  const [c] = await db
    .select({ accountId: characters.accountId, status: characters.status })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.shardId, shardId)));
  return c ?? null;
}

/** Герой — владелец активного предмета. */
export async function itemOwner(
  db: Executor,
  shardId: string,
  itemId: number,
): Promise<{ characterId: string; accountId: string } | null> {
  const [row] = await db
    .select({ characterId: characters.id, accountId: characters.accountId })
    .from(worldEntities)
    .innerJoin(
      characters,
      and(
        eq(characters.shardId, worldEntities.shardId),
        eq(characters.entityId, worldEntities.rootOwnerId),
      ),
    )
    .where(
      and(
        eq(worldEntities.shardId, shardId),
        eq(worldEntities.entityId, itemId),
        isNull(worldEntities.deletedAt),
      ),
    );
  return row ?? null;
}
