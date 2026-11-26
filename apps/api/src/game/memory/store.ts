import type {
  CharacterRecord,
  GameStore,
  NameHistoryRecord,
  NameHold,
  ShardRecord,
} from '../ports.js';

interface Tables {
  shards: Map<string, ShardRecord>;
  sequences: Map<string, number>;
  characters: Map<string, CharacterRecord>;
  history: NameHistoryRecord[];
  holds: Map<string, NameHold>;
  extra: Map<string, number>;
}

const copy = <T>(value: T): T => structuredClone(value);

/** Хранилище шардов и героев в памяти; транзакция откатывается при исключении. */
export class MemoryGameStore implements GameStore {
  private t: Tables = {
    shards: new Map(),
    sequences: new Map(),
    characters: new Map(),
    history: [],
    holds: new Map(),
    extra: new Map(),
  };
  private depth = 0;
  private locks = new Map<string, Promise<void>>();

  async transaction<T>(body: (store: GameStore) => Promise<T>): Promise<T> {
    if (this.depth > 0) return body(this);
    const snapshot = copy(this.t);
    this.depth++;
    try {
      return await body(this);
    } catch (error) {
      this.t = snapshot;
      throw error;
    } finally {
      this.depth--;
    }
  }

  async lockAccountShard(): Promise<void> {}

  async listShards(): Promise<ShardRecord[]> {
    return [...this.t.shards.values()].map(copy);
  }

  async findShard(id: string): Promise<ShardRecord | null> {
    const row = this.t.shards.get(id);
    return row ? copy(row) : null;
  }

  async insertShard(record: ShardRecord): Promise<void> {
    if (this.t.shards.has(record.id)) throw new Error('shards_pkey');
    this.t.shards.set(record.id, copy(record));
    this.t.sequences.set(record.id, 1);
  }

  async updateShard(id: string, patch: Partial<ShardRecord>): Promise<void> {
    const row = this.t.shards.get(id);
    if (row) Object.assign(row, copy(patch));
  }

  async nextHeroNumber(shardId: string): Promise<number> {
    const next = this.t.sequences.get(shardId) ?? 1;
    this.t.sequences.set(shardId, next + 1);
    return next;
  }

  async countCharacters(shardId: string): Promise<number> {
    return [...this.t.characters.values()].filter((c) => c.shardId === shardId).length;
  }

  async listCharacters(accountId: string, shardId: string): Promise<CharacterRecord[]> {
    return [...this.t.characters.values()]
      .filter((c) => c.accountId === accountId && c.shardId === shardId && c.status !== 'deleted')
      .sort((a, b) => a.slot - b.slot)
      .map(copy);
  }

  async findCharacter(id: string): Promise<CharacterRecord | null> {
    const row = this.t.characters.get(id);
    return row ? copy(row) : null;
  }

  async findByNameKey(shardId: string, nameKey: string): Promise<CharacterRecord | null> {
    for (const c of this.t.characters.values()) {
      if (c.shardId === shardId && c.nameKey === nameKey && c.status !== 'deleted') return copy(c);
    }
    return null;
  }

  async insertCharacter(record: CharacterRecord): Promise<void> {
    const live = [...this.t.characters.values()].filter((c) => c.status !== 'deleted');
    if (live.some((c) => c.shardId === record.shardId && c.nameKey === record.nameKey)) {
      throw new Error('characters_name_live_idx');
    }
    if (
      live.some(
        (c) =>
          c.accountId === record.accountId &&
          c.shardId === record.shardId &&
          c.slot === record.slot,
      )
    ) {
      throw new Error('characters_slot_live_idx');
    }
    this.t.characters.set(record.id, copy(record));
  }

  async updateCharacter(id: string, patch: Partial<CharacterRecord>): Promise<void> {
    const row = this.t.characters.get(id);
    if (!row) return;
    if (patch.nameKey !== undefined && patch.nameKey !== row.nameKey) {
      const clash = await this.findByNameKey(row.shardId, patch.nameKey);
      if (clash && clash.id !== id) throw new Error('characters_name_live_idx');
    }
    Object.assign(row, copy(patch));
  }

  async dueDeletions(now: number): Promise<CharacterRecord[]> {
    return [...this.t.characters.values()]
      .filter((c) => c.status === 'pending_deletion' && (c.deleteAt ?? Infinity) <= now)
      .map(copy);
  }

  async insertNameHistory(record: NameHistoryRecord): Promise<void> {
    this.t.history.push(copy(record));
  }

  async listNameHistory(characterId: string): Promise<NameHistoryRecord[]> {
    return this.t.history.filter((h) => h.characterId === characterId).map(copy);
  }

  async findNameHold(shardId: string, nameKey: string, now: number): Promise<NameHold | null> {
    const hold = this.t.holds.get(`${shardId}:${nameKey}`);
    return hold && hold.until > now ? copy(hold) : null;
  }

  async putNameHold(hold: NameHold): Promise<void> {
    this.t.holds.set(`${hold.shardId}:${hold.nameKey}`, copy(hold));
  }

  async extraSlots(accountId: string, shardId: string): Promise<number> {
    return this.t.extra.get(`${accountId}:${shardId}`) ?? 0;
  }

  async setExtraSlots(accountId: string, shardId: string, extra: number): Promise<void> {
    this.t.extra.set(`${accountId}:${shardId}`, extra);
  }
}
