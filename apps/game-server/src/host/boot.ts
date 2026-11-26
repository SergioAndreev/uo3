import { shards, type Database } from '@duskmarch/db';
import {
  DbIdLeaseProvider,
  PartitionLeaseRepo,
  ensureLedgerMonths,
  initShardState,
  saveShardState,
} from '@duskmarch/db/world';
import {
  IdAllocator,
  InMemoryIdLeaseProvider,
  SeededRng,
  type EntityId,
  type IdLeaseProvider,
} from '@duskmarch/domain';
import { buildProfile, fingerprint, type Profile } from '@duskmarch/rules';
import { eq } from 'drizzle-orm';
import type { GameServerConfig } from '../app.module.js';
import type { Landmarks } from '../world.js';
import type { RealmStore } from '@duskmarch/asset-formats';
import type { Entity } from '../engine/partition.js';
import { loadPartition, quarantineRows, type LoadMode } from '../persistence/loader.js';
import { DirtyTracker, FIELD } from '../persistence/dirty-tracker.js';
import { FlushCoordinator, type WorldRowOut } from '../persistence/flush.js';
import { CriticalTransactionCoordinator } from '../persistence/critical.js';
import { dbCriticalPorts } from '../persistence/critical-store.js';
import { dbBatchWriter, entityToRow } from '../persistence/flush-store.js';
import { PartitionLease } from '../persistence/partition-lease.js';
import { starterTx } from '../persistence/starter.js';
import { TimerStore } from '../persistence/timer-store.js';
import { WorldClock, encodeRng } from '../persistence/world-clock.js';
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
  db?: Database,
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
  let provider: IdLeaseProvider = new InMemoryIdLeaseProvider();
  if (db) {
    const ids = new DbIdLeaseProvider(db, config.SHARD_ID, (kind, percent) =>
      ports.log(percent === 95 ? 'error' : 'warn', 'диапазон EntityId заполняется', {
        kind,
        percent,
      }),
    );
    await ids.recover();
    provider = ids;
  }
  const allocator = new IdAllocator(provider);
  await allocator.ready();
  const realm = profile.realms.find((r) => r.key === world.store.realm.key);
  if (!realm) {
    throw new HostError(
      'HOST_BOOT_FAILED',
      `нет мира для планов шарда (${profile.realms.map((r) => r.key).join(', ')}); загружен ${world.store.realm.key}`,
    );
  }
  const partitionId = `${realm.key}-0`;
  let lease: PartitionLease | null = null;
  let leaseRepo: PartitionLeaseRepo | null = null;
  const bounds = { minX: 0, minY: 0, maxX: realm.width - 1, maxY: realm.height - 1 };
  if (db) {
    leaseRepo = new PartitionLeaseRepo(db, config.SHARD_ID, partitionId);
    lease = new PartitionLease({
      repo: leaseRepo,
      nodeId: config.GAME_NODE_ID,
      onLost: () => void node.fence(partitionId),
      log: ports.log,
    });
    try {
      await lease.acquire();
    } catch (error) {
      throw new HostError('HOST_BOOT_FAILED', `аренда партиции ${partitionId}: ${String(error)}`);
    }
    const state = await initShardState(db, {
      shardId: config.SHARD_ID,
      worldVersion: world.version,
      rulesetFingerprint: fingerprint(profile),
      rngState: encodeRng(new SeededRng(`${config.SHARD_ID}:root`).snapshot()),
    });
    if (state.worldVersion !== world.version) {
      ports.log('warn', 'версия мира шарда изменилась', {
        saved: state.worldVersion,
        loaded: world.version,
      });
      await saveShardState(db, config.SHARD_ID, { worldVersion: world.version });
    }
    const clock = new WorldClock(
      state,
      profile.time.tickMs,
      profile.time.gameHourMs,
      node.scheduler.tick,
    );
    const timers = new TimerStore(db, config.SHARD_ID, node.scheduler, undefined, ports.log);
    node.world = { clock, timers };
    node.stopHooks.push(async () => {
      await timers.persist();
      await saveShardState(db, config.SHARD_ID, {
        ...clock.snapshot(node.scheduler.tick),
        rulesetFingerprint: fingerprint(profile),
        stoppedAt: new Date(),
      });
    });
    const held = lease;
    node.stopHooks.push(() => held.release());
  }
  const runtime = node.addPartition({
    partitionId,
    deferHydration: true,
    realm: { key: realm.key, width: realm.width, height: realm.height },
    bounds,
    allocator,
  });
  let initial: Entity[] = [];
  const migrated = new Set<number>();
  if (db) {
    const report = await loadPartition(db, config.SHARD_ID, realm.key, bounds, {
      mode: config.PERSIST_LOAD_MODE as LoadMode,
    }).catch((error: unknown) => {
      throw new HostError('HOST_BOOT_FAILED', `загрузка партиции ${partitionId}: ${String(error)}`);
    });
    if (report.quarantined.length > 0) {
      await quarantineRows(db, report.quarantined);
      ports.log('error', 'повреждённые предметы перенесены в карантин', {
        partitionId,
        entityIds: report.quarantined.map((q) => q.row.entityId),
      });
    }
    ports.log('info', 'партиция загружена', {
      partitionId,
      entities: report.entities.length,
      batches: report.batches,
      migrated: report.migrated.length,
      durationMs: Math.round(report.durationMs),
    });
    initial = report.entities;
    for (const id of report.migrated) migrated.add(id);
  }
  runtime.core.hydrate(initial);
  if (db && lease && leaseRepo) {
    const core = runtime.core;
    const tracker = new DirtyTracker<WorldRowOut>(core, (e) =>
      entityToRow(config.SHARD_ID, realm.key, e, (id) => core.get(id)),
    );
    runtime.listeners.add({ dirty: (id, reason) => tracker.onDirty(id, reason) });
    for (const e of initial) {
      if (e.data && e.data.schemaVersion > 0 && migrated.has(e.id))
        tracker.mark(e.id, FIELD.COMPONENTS);
    }
    const held = lease;
    const flush = new FlushCoordinator(
      tracker,
      {
        writeBatch: dbBatchWriter(db, config.SHARD_ID, leaseRepo, () => held.epoch),
        writeHeroes: async (ids) => {
          for (const id of ids) await runtime.sessions.persist(id);
        },
      },
      {
        intervalMs: config.PERSIST_FLUSH_INTERVAL_MS,
        batchSize: config.PERSIST_FLUSH_BATCH,
        captureBudgetMs: config.PERSIST_CAPTURE_BUDGET_MS,
        maxUnflushedMs: config.PERSIST_MAX_UNFLUSHED_MS,
        onStale: () => void node.fence(partitionId),
        onMode: (mode) =>
          ports.publish(`persistence.${mode === 'normal' ? 'recovered' : 'degraded'}`, {
            partitionId,
          }),
        log: ports.log,
      },
    );
    await ensureLedgerMonths(db);
    const serialize = (e: Entity) =>
      entityToRow(config.SHARD_ID, realm.key, e, (id) => core.get(id));
    const critical = new CriticalTransactionCoordinator(
      core,
      tracker,
      dbCriticalPorts(
        db,
        config.SHARD_ID,
        realm.key,
        leaseRepo,
        () => held.epoch,
        serialize,
        (type, r) =>
          ports.publish(`audit.${type.toLowerCase()}`, {
            txId: r.txId,
            actorAccountId: r.actor?.accountId,
            actorAccessLevel: r.actor?.accessLevel,
            reason: r.reason,
            items: r.ledger.map((l) => l.itemId),
          }),
      ),
      (kind) => allocator.next(kind),
      {
        mode: () => flush.mode,
        onAlert: (code, data) => ports.log('error', `критическая транзакция: ${code}`, data),
      },
    );
    runtime.persistence = { tracker, flush, critical };
    runtime.sessions.useStarterGrant(async (s, loadout) => {
      const out = await critical.run(starterTx(s.entityId, s.characterId, loadout));
      return out.replayed ? [] : ((out.result['items'] as EntityId[] | undefined) ?? []);
    });
    runtime.sessions.useHeroFlush((ids) => flush.flushNow(ids));
    node.scheduler.onPostTick(() => flush.tick());
    node.scheduler.every(config.PERSIST_FLUSH_INTERVAL_MS, () => void flush.flush(), 'background');
    node.stopHooks.unshift(async () => {
      const deadline = new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('финальное сохранение не уложилось в срок')),
          config.PERSIST_SHUTDOWN_FLUSH_MS,
        ).unref(),
      );
      await Promise.race([flush.flushNow(), deadline]);
    });
  }
  if (node.world) {
    const restored = await node.world.timers.restore();
    if (restored > 0) ports.log('info', 'таймеры мира восстановлены', { count: restored });
  }
  return node;
}
