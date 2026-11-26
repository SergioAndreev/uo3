import {
  accountShardEntitlements,
  characterNameHistory,
  characterNameHolds,
  characterSkills,
  characters,
  shardEntitySequences,
  shards,
  type Database,
} from '@duskmarch/db';
import { and, asc, count, eq, gt, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type {
  CharacterRecord,
  GameStore,
  NameHistoryRecord,
  NameHold,
  ShardRecord,
} from '../ports.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'> & {
  transaction: Database['transaction'];
};

const d = (ms: number | null | undefined): Date | null =>
  ms === null || ms === undefined ? null : new Date(ms);
const ms = (date: Date | null): number | null => (date === null ? null : date.getTime());

const SHARD_DATES = ['maintenanceEta', 'createdAt', 'updatedAt', 'archivedAt'];
const CHAR_DATES = ['createdAt', 'lastPlayedAt', 'deleteAt', 'deletedAt', 'renamedAt'];

function datePatch(patch: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
  for (const key of keys) if (key in out) out[key] = d(out[key] as number | null);
  return out;
}

const toShard = (r: typeof shards.$inferSelect): ShardRecord => ({
  ...r,
  preset: r.preset as ShardRecord['preset'],
  rulesetOverride: r.rulesetOverride as Record<string, unknown>,
  visibility: r.visibility as ShardRecord['visibility'],
  manualStatus: r.manualStatus as ShardRecord['manualStatus'],
  renamePolicy: r.renamePolicy as ShardRecord['renamePolicy'],
  maintenanceEta: ms(r.maintenanceEta),
  createdAt: r.createdAt.getTime(),
  updatedAt: r.updatedAt.getTime(),
  archivedAt: ms(r.archivedAt),
});

/** Столбцы игрового сервера (P06), которых нет в записи героя API. */
function omitRuntime(r: typeof characters.$inferSelect) {
  const row: Partial<typeof r> = { ...r };
  delete row.health;
  delete row.verve;
  delete row.resonance;
  delete row.playtimeSeconds;
  return row as Omit<typeof r, 'health' | 'verve' | 'resonance' | 'playtimeSeconds'>;
}

/** Шарды и герои в PostgreSQL. */
export class DrizzleGameStore implements GameStore {
  constructor(
    private readonly db: Executor,
    private readonly inTransaction = false,
  ) {}

  async transaction<T>(body: (store: GameStore) => Promise<T>): Promise<T> {
    if (this.inTransaction) return body(this);
    return this.db.transaction((tx) => body(new DrizzleGameStore(tx as unknown as Executor, true)));
  }

  async lockAccountShard(accountId: string, shardId: string): Promise<void> {
    await this.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${accountId}:${shardId}`}, 0))`,
    );
  }

  async listShards(): Promise<ShardRecord[]> {
    return (await this.db.select().from(shards)).map(toShard);
  }

  async findShard(id: string): Promise<ShardRecord | null> {
    const [row] = await this.db.select().from(shards).where(eq(shards.id, id));
    return row ? toShard(row) : null;
  }

  async insertShard(r: ShardRecord): Promise<void> {
    await this.db.insert(shards).values(datePatch(r, SHARD_DATES) as typeof shards.$inferInsert);
    await this.db.insert(shardEntitySequences).values({ shardId: r.id }).onConflictDoNothing();
  }

  async updateShard(id: string, patch: Partial<ShardRecord>): Promise<void> {
    await this.db.update(shards).set(datePatch(patch, SHARD_DATES)).where(eq(shards.id, id));
  }

  async nextHeroNumber(shardId: string): Promise<number> {
    await this.db.insert(shardEntitySequences).values({ shardId }).onConflictDoNothing();
    const [row] = await this.db
      .update(shardEntitySequences)
      .set({ nextHero: sql`${shardEntitySequences.nextHero} + 1` })
      .where(eq(shardEntitySequences.shardId, shardId))
      .returning({ next: shardEntitySequences.nextHero });
    return (row?.next ?? 2) - 1;
  }

  async countCharacters(shardId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(characters)
      .where(eq(characters.shardId, shardId));
    return Number(row?.n ?? 0);
  }

  private async hydrate(rows: (typeof characters.$inferSelect)[]): Promise<CharacterRecord[]> {
    const out: CharacterRecord[] = [];
    for (const r of rows) {
      const skills = await this.db
        .select({ skill: characterSkills.skill, tenths: characterSkills.tenths })
        .from(characterSkills)
        .where(eq(characterSkills.characterId, r.id))
        .orderBy(sql`${characterSkills.tenths} desc`, asc(characterSkills.skill));
      // Текущие ресурсы и время игры ведёт игровой сервер (P06); в записи API их нет.
      const row = omitRuntime(r);
      out.push({
        ...row,
        status: r.status as CharacterRecord['status'],
        stats: r.stats as CharacterRecord['stats'],
        appearance: r.appearance as CharacterRecord['appearance'],
        starterLoadout: r.starterLoadout as CharacterRecord['starterLoadout'],
        statusBeforeDeletion: r.statusBeforeDeletion as CharacterRecord['statusBeforeDeletion'],
        skills,
        createdAt: r.createdAt.getTime(),
        lastPlayedAt: ms(r.lastPlayedAt),
        deleteAt: ms(r.deleteAt),
        deletedAt: ms(r.deletedAt),
        renamedAt: ms(r.renamedAt),
      });
    }
    return out;
  }

  async listCharacters(accountId: string, shardId: string): Promise<CharacterRecord[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.accountId, accountId),
          eq(characters.shardId, shardId),
          ne(characters.status, 'deleted'),
        ),
      )
      .orderBy(asc(characters.slot));
    return this.hydrate(rows);
  }

  async findCharacter(id: string): Promise<CharacterRecord | null> {
    const rows = await this.db.select().from(characters).where(eq(characters.id, id));
    return (await this.hydrate(rows))[0] ?? null;
  }

  async findByNameKey(shardId: string, nameKey: string): Promise<CharacterRecord | null> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.shardId, shardId),
          eq(characters.nameKey, nameKey),
          ne(characters.status, 'deleted'),
        ),
      );
    return (await this.hydrate(rows))[0] ?? null;
  }

  async insertCharacter(r: CharacterRecord): Promise<void> {
    const { skills, ...row } = r;
    await this.db
      .insert(characters)
      .values(datePatch(row, CHAR_DATES) as typeof characters.$inferInsert);
    if (skills.length > 0) {
      await this.db
        .insert(characterSkills)
        .values(skills.map((s) => ({ characterId: r.id, ...s })));
    }
  }

  async updateCharacter(id: string, patch: Partial<CharacterRecord>): Promise<void> {
    await this.db.update(characters).set(datePatch(patch, CHAR_DATES)).where(eq(characters.id, id));
  }

  async dueDeletions(now: number): Promise<CharacterRecord[]> {
    const rows = await this.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.status, 'pending_deletion'),
          isNotNull(characters.deleteAt),
          lte(characters.deleteAt, new Date(now)),
        ),
      );
    return this.hydrate(rows);
  }

  async insertNameHistory(r: NameHistoryRecord): Promise<void> {
    await this.db.insert(characterNameHistory).values({ ...r, at: new Date(r.at) });
  }

  async listNameHistory(characterId: string): Promise<NameHistoryRecord[]> {
    const rows = await this.db
      .select()
      .from(characterNameHistory)
      .where(eq(characterNameHistory.characterId, characterId))
      .orderBy(asc(characterNameHistory.at));
    return rows.map((r) => ({ ...r, at: r.at.getTime() }));
  }

  async findNameHold(shardId: string, nameKey: string, now: number): Promise<NameHold | null> {
    const [row] = await this.db
      .select()
      .from(characterNameHolds)
      .where(
        and(
          eq(characterNameHolds.shardId, shardId),
          eq(characterNameHolds.nameKey, nameKey),
          gt(characterNameHolds.until, new Date(now)),
        ),
      );
    return row ? { ...row, until: row.until.getTime() } : null;
  }

  async putNameHold(hold: NameHold): Promise<void> {
    const values = { ...hold, until: new Date(hold.until) };
    await this.db
      .insert(characterNameHolds)
      .values(values)
      .onConflictDoUpdate({
        target: [characterNameHolds.shardId, characterNameHolds.nameKey],
        set: values,
      });
  }

  async extraSlots(accountId: string, shardId: string): Promise<number> {
    const [row] = await this.db
      .select({ extra: accountShardEntitlements.extraSlots })
      .from(accountShardEntitlements)
      .where(
        and(
          eq(accountShardEntitlements.accountId, accountId),
          eq(accountShardEntitlements.shardId, shardId),
        ),
      );
    return row?.extra ?? 0;
  }

  async setExtraSlots(accountId: string, shardId: string, extra: number): Promise<void> {
    await this.db
      .insert(accountShardEntitlements)
      .values({ accountId, shardId, extraSlots: extra })
      .onConflictDoUpdate({
        target: [accountShardEntitlements.accountId, accountShardEntitlements.shardId],
        set: { extraSlots: extra },
      });
  }
}
