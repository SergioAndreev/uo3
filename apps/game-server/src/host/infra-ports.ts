import { loadHeroTree } from '../persistence/loader.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { characters, type Database } from '@duskmarch/db';
import {
  KEYS,
  claimSession,
  publishHeartbeat,
  publishHub,
  publishPartition,
  redeemTicket,
  releaseSession,
} from '@duskmarch/db/live';
import type { AccessLevel } from '@duskmarch/domain';
import type { NatsConnection } from '@nats-io/transport-node';
import { TicketPayload } from '@duskmarch/protocol';
import { vitals, type Profile } from '@duskmarch/rules';
import { Value } from '@sinclair/typebox/value';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'iovalkey';
import type { HubPorts } from '../engine/hub.js';
import type { HeroRecord, SessionPorts, TicketClaims } from '../engine/session.js';
import type { LiveRegistry, NodePorts } from './node.js';

/** Запись живой сессии живёт дольше трёх heartbeat; у упавшего узла истекает. */
export const SESSION_TTL_MS = 60_000;

export interface InfraContext {
  shardId: string;
  db: Database;
  redis: Redis;
  nats: () => NatsConnection | undefined;
  profile: Profile;
  resolveSpawn: SessionPorts['resolveSpawn'];
  isSafeZone: SessionPorts['isSafeZone'];
  log: NodePorts['log'];
}

const toClaims = (payload: unknown): TicketClaims | null => {
  if (!Value.Check(TicketPayload, payload)) return null;
  return {
    accountId: payload.accountId,
    characterId: payload.characterId,
    entityId: payload.entityId,
    name: payload.name,
    accessLevel: payload.accessLevel as AccessLevel,
    effectiveLevel: payload.effectiveLevel as AccessLevel,
    realm: payload.realm,
    x: payload.x,
    y: payload.y,
    h: payload.h,
    takeover: payload.takeover,
  };
};

export function liveRegistry(redis: Redis, shardId: string): LiveRegistry {
  return {
    heartbeat: (hb) => publishHeartbeat(redis, shardId, hb),
    partition: (p) => publishPartition(redis, shardId, p),
    hub: (h) => publishHub(redis, shardId, h),
    clear: async (partitionIds) => {
      if (partitionIds.length > 0) await redis.hdel(KEYS.partitions(shardId), ...partitionIds);
    },
  };
}

/** Порты узла на Valkey, NATS и PostgreSQL. */
export function infraPorts(
  ctx: InfraContext,
  roomIdOf: (partitionId: string) => string,
  hubRoomId: string,
): NodePorts {
  const { redis, db, shardId } = ctx;
  return {
    registry: liveRegistry(redis, shardId),
    sessionPorts: (partitionId) => ({
      redeem: async (token) => {
        const result = await redeemTicket(
          redis,
          token,
          { shardId, roomType: 'world', roomId: roomIdOf(partitionId) },
          Date.now(),
        );
        const claims = result.ok ? toClaims(result.payload) : null;
        return claims ? { ok: true, claims } : { ok: false };
      },
      loadHeroTree: (entityId) => loadHeroTree(db, shardId, entityId),
      loadHero: async (characterId) => {
        const [row] = await db.select().from(characters).where(eq(characters.id, characterId));
        if (!row || row.shardId !== shardId) return null;
        const stats = row.stats as { might: number; finesse: number; will: number };
        const full = vitals(stats);
        const record: HeroRecord = {
          status: row.status as HeroRecord['status'],
          realm: row.realm,
          x: row.x,
          y: row.y,
          h: row.h,
          starter: {
            granted: row.starterLoadoutGranted,
            loadout: row.starterLoadout as NonNullable<HeroRecord['starter']>['loadout'],
          },
          vitals: {
            health: row.health ?? full.health,
            verve: row.verve ?? full.verve,
            resonance: row.resonance ?? full.resonance,
          },
        };
        return record;
      },
      saveHero: async (characterId, save) => {
        await db
          .update(characters)
          .set({
            realm: save.realm,
            x: save.x,
            y: save.y,
            h: save.h,
            health: save.vitals.health,
            verve: save.vitals.verve,
            resonance: save.vitals.resonance,
            playtimeSeconds: sql`${characters.playtimeSeconds} + ${save.playtimeDeltaS}`,
            lastPlayedAt: new Date(),
          })
          .where(eq(characters.id, characterId));
      },
      claim: (accountId, record) =>
        claimSession(redis, shardId, accountId, record, SESSION_TTL_MS) as never,
      updateSession: async (accountId, record) => {
        await redis.set(
          KEYS.session(shardId, accountId),
          JSON.stringify(record),
          'PX',
          SESSION_TTL_MS,
        );
      },
      release: async (accountId, sessionId) =>
        void (await releaseSession(redis, shardId, accountId, sessionId)),
      resolveSpawn: ctx.resolveSpawn,
      isSafeZone: ctx.isSafeZone,
      newToken: () => randomBytes(24).toString('base64url'),
      warn: (msg, data) => ctx.log('warn', msg, data),
    }),
    hubPorts: hubPorts(ctx, hubRoomId),
    publish: (subject, payload) => {
      const nc = ctx.nats();
      if (!nc) {
        ctx.log('warn', 'NATS недоступен: событие не отправлено', { subject });
        return;
      }
      nc.publish(
        subject,
        JSON.stringify({ eventId: randomUUID(), occurredAt: new Date().toISOString(), ...payload }),
      );
    },
    wallNow: () => Date.now(),
    log: ctx.log,
  };
}

function hubPorts(ctx: InfraContext, hubRoomId: string): HubPorts {
  return {
    redeem: async (token) => {
      const result = await redeemTicket(
        ctx.redis,
        token,
        { shardId: ctx.shardId, roomType: 'hub', roomId: hubRoomId },
        Date.now(),
      );
      const claims = result.ok ? toClaims(result.payload) : null;
      return claims
        ? {
            ok: true,
            claims: {
              accountId: claims.accountId,
              characterId: claims.characterId,
              entityId: claims.entityId,
              accessLevel: claims.accessLevel,
              effectiveLevel: claims.effectiveLevel,
            },
          }
        : { ok: false };
    },
    audit: (action, data) => {
      ctx.log('info', `audit: ${action}`, data);
      ctx
        .nats()
        ?.publish(
          `shard.${ctx.shardId}.audit`,
          JSON.stringify({ eventId: randomUUID(), action, ...data }),
        );
    },
    newId: () => randomUUID(),
  };
}

/** Подписка на события P04, P05 и других узлов шарда. */
export function subscribeEvents(
  nc: NatsConnection,
  shardId: string,
  handle: (subject: string, event: Record<string, unknown>) => Promise<unknown>,
  log: NodePorts['log'],
) {
  const subs = ['identity.account.>', 'character.>', `shard.${shardId}.>`].map((subject) =>
    nc.subscribe(subject),
  );
  for (const sub of subs) {
    void (async () => {
      for await (const message of sub) {
        try {
          await handle(message.subject, message.json<Record<string, unknown>>());
        } catch (error) {
          log('error', 'событие не обработано', { subject: message.subject, error: String(error) });
        }
      }
    })();
  }
  return () => {
    for (const sub of subs) sub.unsubscribe();
  };
}
