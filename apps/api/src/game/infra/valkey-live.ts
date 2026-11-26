import {
  issueBundle,
  readSession,
  readShardLive,
  reservedSeats,
  revokeTickets,
} from '@duskmarch/db/live';
import type { Redis } from 'iovalkey';
import type { BundleInput, LivePort } from '../ports.js';

/** Живое состояние и билеты в Valkey. */
export class ValkeyLive implements LivePort {
  constructor(private readonly redis: Redis) {}

  read(shardId: string, now: number) {
    return readShardLive(this.redis, shardId, now);
  }

  session(shardId: string, accountId: string) {
    return readSession(this.redis, shardId, accountId);
  }

  issue(bundle: BundleInput) {
    return issueBundle(this.redis, bundle);
  }

  revoke(scope: 'account' | 'char' | 'shard', id: string, now: number) {
    return revokeTickets(this.redis, scope, id, now);
  }

  reserved(shardId: string, roomId: string, now: number) {
    return reservedSeats(this.redis, shardId, roomId, now);
  }
}
