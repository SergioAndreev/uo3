import { shards, type Database } from '@duskmarch/db';
import { IdAllocator, InMemoryIdLeaseProvider } from '@duskmarch/domain';
import { buildProfile, type Profile } from '@duskmarch/rules';
import { eq } from 'drizzle-orm';
import type { GameServerConfig } from '../app.module.js';
import type { Landmarks } from '../world.js';
import type { RealmStore } from '@duskmarch/asset-formats';
import { ShardNode, type NodePorts } from './node.js';

export type HostErrorCode = 'HOST_CONFIG_INVALID' | 'HOST_BOOT_FAILED' | 'HOST_SHARD_MISMATCH';

export class HostError extends Error {
  override readonly name = 'HostError';
  constructor(
    readonly code: HostErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export interface LoadedWorld {
  store: RealmStore;
  version: string;
  landmarks: Landmarks;
}

/** Строка шарда из PostgreSQL — источник профиля правил (как у API P05). */
export async function loadShard(
  db: Database,
  shardId: string,
): Promise<{ preset: 'standard' | 'proving'; profile: Profile }> {
  let row: typeof shards.$inferSelect | undefined;
  try {
    [row] = await db.select().from(shards).where(eq(shards.id, shardId));
  } catch (error) {
    throw new HostError('HOST_BOOT_FAILED', `шард не прочитан: ${String(error)}`);
  }
  if (!row || row.archivedAt !== null)
    throw new HostError('HOST_SHARD_MISMATCH', `шард ${shardId} не найден или в архиве`);
  try {
    const preset = row.preset as 'standard' | 'proving';
    return { preset, profile: buildProfile(preset, row.rulesetOverride) };
  } catch (error) {
    throw new HostError('HOST_CONFIG_INVALID', `профиль шарда: ${String(error)}`);
  }
}

/** Узел с партициями для планов профиля, мир которых загружен. */
export async function buildNode(
  config: GameServerConfig,
  profile: Profile,
  world: LoadedWorld,
  ports: NodePorts,
): Promise<ShardNode> {
  const node = new ShardNode(
    {
      shardId: config.SHARD_ID,
      nodeId: config.GAME_NODE_ID,
      role: config.GAME_NODE_ROLE as 'all' | 'partition' | 'hub',
      wsUrl: config.GAME_PUBLIC_WS_URL,
      heartbeatMs: config.GAME_HEARTBEAT_MS,
      logoutDelayMs: profile.limits.logoutDelayMs,
      reconnectWindowMs: config.GAME_RECONNECT_WINDOW_MS,
      idleTimeoutMs: config.GAME_IDLE_TIMEOUT_MS,
      capacity: config.GAME_PARTITION_CAPACITY,
      staffBuffer: config.GAME_STAFF_BUFFER,
      motd: config.GAME_MOTD,
      hardTimeoutMs: config.GAME_SHUTDOWN_HARD_TIMEOUT_MS,
    },
    ports,
  );
  if (config.GAME_NODE_ROLE === 'hub') return node;
  // Аренда идентификаторов в PostgreSQL — P08; до неё существа и предметы не сохраняются.
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider());
  await allocator.ready();
  const realm = profile.realms.find((r) => r.key === world.store.realm.key);
  if (!realm) {
    throw new HostError(
      'HOST_BOOT_FAILED',
      `нет мира для планов шарда (${profile.realms.map((r) => r.key).join(', ')}); загружен ${world.store.realm.key}`,
    );
  }
  node.addPartition({
    partitionId: `${realm.key}-0`,
    realm: { key: realm.key, width: realm.width, height: realm.height },
    bounds: { minX: 0, minY: 0, maxX: realm.width - 1, maxY: realm.height - 1 },
    allocator,
  });
  return node;
}
