import type { Database } from '@duskmarch/db';
import {
  createRestorePoint,
  ledgerLineage,
  ledgerOfItem,
  ledgerQuery,
  type LedgerFilter,
  type LedgerRow,
} from '@duskmarch/db/world';
import type { FlushResult } from '@duskmarch/protocol';
import type { NatsConnection } from '@nats-io/transport-node';
import { IdentityError } from '../identity/core/errors.js';
import type { IdentityServices, Principal, RequestMeta } from '../identity/core/index.js';

/** Журнал предметов (P08). */
export interface LedgerStore {
  ofItem(shardId: string, itemId: number): Promise<LedgerRow[]>;
  lineage(shardId: string, itemId: number): Promise<{ items: number[]; events: LedgerRow[] }>;
  query(
    shardId: string,
    filter: LedgerFilter,
  ): Promise<{ events: LedgerRow[]; next: number | null }>;
}

/** Точки восстановления (P08). */
export interface RestorePointStore {
  create(row: {
    shardId: string;
    name: string;
    reason: string;
    createdBy: string;
    checkpointSeq: number;
  }): Promise<{ lsn: string }>;
}

export class DrizzleRestorePoints implements RestorePointStore {
  constructor(private readonly db: Database) {}
  async create(row: Parameters<RestorePointStore['create']>[0]) {
    try {
      return await createRestorePoint(this.db, row);
    } catch (error) {
      if ((error as { code?: string }).code === 'PERSIST_RESTORE_POINT_EXISTS') {
        throw new IdentityError('PERSIST_RESTORE_POINT_EXISTS', `точка ${row.name} уже есть`);
      }
      throw error;
    }
  }
}

export class MemoryRestorePoints implements RestorePointStore {
  readonly points = new Map<string, { lsn: string; reason: string }>();
  async create(row: Parameters<RestorePointStore['create']>[0]) {
    const key = `${row.shardId}/${row.name}`;
    if (this.points.has(key))
      throw new IdentityError('PERSIST_RESTORE_POINT_EXISTS', `точка ${row.name} уже есть`);
    const lsn = `0/${(this.points.size + 1).toString(16).toUpperCase()}000000`;
    this.points.set(key, { lsn, reason: row.reason });
    return { lsn };
  }
}

/** Запрос внеочередного сохранения узлу шарда. */
export interface FlushRequester {
  request(shardId: string): Promise<FlushResult>;
}

export class DrizzleLedgerStore implements LedgerStore {
  constructor(private readonly db: Database) {}
  ofItem = (shardId: string, itemId: number) => ledgerOfItem(this.db, shardId, itemId);
  lineage = (shardId: string, itemId: number) => ledgerLineage(this.db, shardId, itemId);
  query = (shardId: string, filter: LedgerFilter) => ledgerQuery(this.db, shardId, filter);
}

/** Журнал в памяти (тестовые сборки без PostgreSQL). */
export class MemoryLedgerStore implements LedgerStore {
  readonly rows: LedgerRow[] = [];
  ofItem = async (shardId: string, itemId: number) =>
    this.rows.filter((r) => r.shardId === shardId && r.itemId === itemId);
  lineage = async (shardId: string, itemId: number) => {
    const items = new Set([itemId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const r of this.rows) {
        if (r.shardId !== shardId || r.sourceItemId === null) continue;
        if (items.has(r.itemId) && !items.has(r.sourceItemId)) {
          items.add(r.sourceItemId);
          changed = true;
        }
        if (items.has(r.sourceItemId) && !items.has(r.itemId)) {
          items.add(r.itemId);
          changed = true;
        }
      }
    }
    return {
      items: [...items].sort((a, b) => a - b),
      events: this.rows.filter((r) => r.shardId === shardId && items.has(r.itemId)),
    };
  };
  query = async (shardId: string, f: LedgerFilter) => {
    const all = this.rows.filter(
      (r) =>
        r.shardId === shardId &&
        (!f.characterId || r.characterId === f.characterId) &&
        (!f.accountId || r.actorAccountId === f.accountId) &&
        (!f.txId || r.txId === f.txId) &&
        (!f.from || r.createdAt >= f.from) &&
        (!f.to || r.createdAt < f.to) &&
        (f.after === undefined || r.ledgerSeq > f.after),
    );
    const page = all.slice(0, f.limit);
    return { events: page, next: all.length > f.limit ? (page.at(-1)?.ledgerSeq ?? null) : null };
  };
}

/** Запрос узлу через NATS (request/reply `shard.{id}.persistence.flush_request`). */
export class NatsFlushRequester implements FlushRequester {
  constructor(
    private readonly connection: () => NatsConnection | undefined,
    private readonly timeoutMs = 30_000,
  ) {}

  async request(shardId: string): Promise<FlushResult> {
    const nc = this.connection();
    if (!nc) throw new IdentityError('PERSIST_TX_UNAVAILABLE', 'NATS недоступен');
    try {
      const reply = await nc.request(`shard.${shardId}.persistence.flush_request`, '{}', {
        timeout: this.timeoutMs,
      });
      const body = JSON.parse(reply.string()) as FlushResult | { error: string };
      if ('error' in body) throw new IdentityError('PERSIST_TX_UNAVAILABLE', body.error);
      return body;
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError('PERSIST_TX_UNAVAILABLE', `узел шарда не ответил: ${String(error)}`);
    }
  }
}

export const FLUSH_COOLDOWN_MS = 5_000;

/** Администрирование персистентности: журнал предметов и ручное сохранение. */
export class PersistenceAdmin {
  private readonly lastFlush = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<FlushResult>>();

  constructor(
    private readonly identity: IdentityServices,
    private readonly ledger: LedgerStore,
    private readonly flusher: FlushRequester,
    private readonly now: () => number = () => Date.now(),
    private readonly points: RestorePointStore = new MemoryRestorePoints(),
  ) {}

  /** Точка восстановления: внеочередное сохранение мира, затем точка в WAL. */
  async restorePoint(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    name: string,
    reason: string,
  ) {
    const actor = await this.identity.staff.authorize(
      principal,
      'backup.manage',
      'backup.restore_point',
      meta,
    );
    const flushed = await this.flusher.request(shardId);
    const { lsn } = await this.points.create({
      shardId,
      name,
      reason,
      createdBy: actor.id,
      checkpointSeq: flushed.checkpointSeq,
    });
    return { name, lsn, checkpointSeq: flushed.checkpointSeq };
  }

  private authorize(
    principal: Principal,
    permission: 'items.ledger.read' | 'shard.manage',
    meta: RequestMeta,
  ) {
    return this.identity.staff.authorize(principal, permission, permission, meta);
  }

  async itemHistory(principal: Principal, meta: RequestMeta, shardId: string, itemId: number) {
    await this.authorize(principal, 'items.ledger.read', meta);
    return { itemId, events: await this.ledger.ofItem(shardId, itemId) };
  }

  async lineage(principal: Principal, meta: RequestMeta, shardId: string, itemId: number) {
    await this.authorize(principal, 'items.ledger.read', meta);
    return { itemId, ...(await this.ledger.lineage(shardId, itemId)) };
  }

  async query(principal: Principal, meta: RequestMeta, shardId: string, filter: LedgerFilter) {
    await this.authorize(principal, 'items.ledger.read', meta);
    const { events, next } = await this.ledger.query(shardId, filter);
    return { events, cursor: next === null ? null : String(next) };
  }

  /** Одновременные вызовы объединяются; чаще раза в 5 с без `force` — 429. */
  async flush(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    force: boolean,
  ): Promise<FlushResult> {
    await this.authorize(principal, 'shard.manage', meta);
    const running = this.inflight.get(shardId);
    if (running) return running;
    const last = this.lastFlush.get(shardId);
    const left = last === undefined ? 0 : last + FLUSH_COOLDOWN_MS - this.now();
    if (left > 0 && !force) {
      throw new IdentityError(
        'PERSIST_FLUSH_COOLDOWN_ACTIVE',
        'ручное сохранение недавно выполнялось',
        {
          details: { retryAfterMs: left },
          retryAfterS: Math.ceil(left / 1000),
        },
      );
    }
    this.lastFlush.set(shardId, this.now());
    const p = this.flusher.request(shardId).finally(() => this.inflight.delete(shardId));
    this.inflight.set(shardId, p);
    return p;
  }
}
