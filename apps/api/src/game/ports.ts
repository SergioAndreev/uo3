import type { SkillPick } from '@duskmarch/rules';
import type { HubInfo, LiveSession, PartitionInfo, ShardLive } from '@duskmarch/db/live';

export type { HubInfo, LiveSession, PartitionInfo, ShardLive };

type Ms = number;

export type ShardVisibility = 'public' | 'unlisted' | 'staff';
export type ManualStatus = 'normal' | 'maintenance' | 'draining';
export type RenamePolicy = 'free' | 'cooldown' | 'disabled';

export interface ShardRecord {
  id: string;
  name: string;
  region: string;
  preset: 'standard' | 'proving';
  rulesetOverride: Record<string, unknown>;
  visibility: ShardVisibility;
  manualStatus: ManualStatus;
  maintenanceEta: Ms | null;
  maintenanceMessage: string | null;
  creationOpen: boolean;
  characterSlots: number;
  renamePolicy: RenamePolicy;
  ticketTtlS: number;
  softCapacity: number;
  hardCapacity: number;
  staffBuffer: number;
  protocolRange: string;
  startCities: string[];
  sortOrder: number;
  createdAt: Ms;
  updatedAt: Ms;
  archivedAt: Ms | null;
  /** Требование к пакету ассетов P02 (P09). */
  assetPack?: { id: string; minVersion: string } | null;
}

export type CharacterStatus =
  'active' | 'rename_required' | 'locked' | 'pending_deletion' | 'deleted';

export interface Appearance {
  build: 'lean' | 'average' | 'sturdy';
  face: number;
  hairStyle: number;
  beard: number;
  skinTint: number;
  hairTint: number;
}

export interface CharacterRecord {
  id: string;
  shardId: string;
  accountId: string;
  entityId: number;
  slot: number;
  name: string;
  nameKey: string;
  status: CharacterStatus;
  stats: { might: number; finesse: number; will: number };
  skills: SkillPick[];
  appearance: Appearance;
  background: string | null;
  startCity: string;
  realm: string;
  x: number;
  y: number;
  h: number;
  starterLoadout: { key: string; count: number }[];
  createdAt: Ms;
  lastPlayedAt: Ms | null;
  deleteAt: Ms | null;
  deletedAt: Ms | null;
  statusBeforeDeletion: CharacterStatus | null;
  renamedAt: Ms | null;
  lockReason: string | null;
}

export interface NameHistoryRecord {
  id: string;
  characterId: string;
  oldName: string;
  newName: string;
  reason: string;
  changedBy: string;
  at: Ms;
}

export interface NameHold {
  shardId: string;
  nameKey: string;
  accountId: string;
  until: Ms;
}

/** Хранилище шардов и героев. */
export interface GameStore {
  transaction<T>(body: (store: GameStore) => Promise<T>): Promise<T>;
  /** Сериализует создание героев одного аккаунта на шарде. */
  lockAccountShard(accountId: string, shardId: string): Promise<void>;

  listShards(): Promise<ShardRecord[]>;
  findShard(id: string): Promise<ShardRecord | null>;
  insertShard(record: ShardRecord): Promise<void>;
  updateShard(id: string, patch: Partial<Omit<ShardRecord, 'id'>>): Promise<void>;
  /** Следующий номер героя шарда (номера не переиспользуются). */
  nextHeroNumber(shardId: string): Promise<number>;
  countCharacters(shardId: string): Promise<number>;

  listCharacters(accountId: string, shardId: string): Promise<CharacterRecord[]>;
  findCharacter(id: string): Promise<CharacterRecord | null>;
  /** Неудалённый герой с этим скелетом имени. */
  findByNameKey(shardId: string, nameKey: string): Promise<CharacterRecord | null>;
  insertCharacter(record: CharacterRecord): Promise<void>;
  updateCharacter(
    id: string,
    patch: Partial<Omit<CharacterRecord, 'id' | 'skills'>>,
  ): Promise<void>;
  /** Герои в очереди удаления с истёкшим сроком. */
  dueDeletions(now: Ms): Promise<CharacterRecord[]>;

  insertNameHistory(record: NameHistoryRecord): Promise<void>;
  listNameHistory(characterId: string): Promise<NameHistoryRecord[]>;
  findNameHold(shardId: string, nameKey: string, now: Ms): Promise<NameHold | null>;
  putNameHold(hold: NameHold): Promise<void>;

  extraSlots(accountId: string, shardId: string): Promise<number>;
  setExtraSlots(accountId: string, shardId: string, extra: number): Promise<void>;
}

export interface BundleInput {
  shardId: string;
  accountId: string;
  bundleId: string;
  world: { roomId: string; token: string; payload: object; free: number };
  hub: { roomId: string; token: string; payload: object; free: number };
  ttlMs: number;
  now: Ms;
}

/** Живое состояние шардов и билеты в Valkey. */
export interface LivePort {
  read(shardId: string, now: Ms): Promise<ShardLive>;
  session(shardId: string, accountId: string): Promise<LiveSession | null>;
  issue(bundle: BundleInput): Promise<'OK' | 'FULL_WORLD' | 'FULL_HUB'>;
  revoke(scope: 'account' | 'char' | 'shard', id: string, now: Ms): Promise<void>;
  reserved(shardId: string, roomId: string, now: Ms): Promise<number>;
}
