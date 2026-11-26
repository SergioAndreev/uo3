import { isStaff } from '@duskmarch/domain';
import { startCity } from '@duskmarch/content';
import type { TicketPayload } from '@duskmarch/protocol';
import { newToken } from '../identity/crypto/random.js';
import { IdentityError, MINUTE, type Identity, type Principal } from '../identity/core/index.js';
import { hit } from '../identity/core/rate-limit.js';
import type { CharacterService } from './characters.js';
import type { GameStore, LivePort, PartitionInfo } from './ports.js';
import { satisfies, type Version } from './semver.js';
import type { ShardService } from './shards.js';

export const TICKETS_PER_MINUTE = 10;

export interface TicketInput {
  characterId: string;
  purpose?: 'initial_login' | 'partition_handoff' | 'realm_transfer' | undefined;
  takeover?: boolean | undefined;
}

/** Выдача пары игровых билетов. */
export class TicketService {
  constructor(
    private readonly id: Identity,
    private readonly store: GameStore,
    private readonly live: LivePort,
    private readonly shards: ShardService,
    private readonly characters: CharacterService,
  ) {}

  async issue(principal: Principal, shardId: string, input: TicketInput, protocol: Version | null) {
    if (input.purpose !== undefined && input.purpose !== 'initial_login') {
      throw new IdentityError(
        'TICKET_PURPOSE_FORBIDDEN',
        'назначение зарезервировано за игровыми серверами',
      );
    }
    const shard = await this.shards.visible(shardId, principal);
    if (!protocol)
      throw new IdentityError(
        'SHARD_PROTOCOL_HEADER_INVALID',
        'нужен заголовок X-Duskmarch-Protocol',
      );
    if (!satisfies(protocol, shard.protocolRange)) {
      throw new IdentityError('SHARD_PROTOCOL_INCOMPATIBLE', 'версия клиента не подходит шарду', {
        details: { protocolRange: shard.protocolRange },
      });
    }
    const now = this.id.now();
    const rate = await hit(this.id.kv, `tickets:${principal.accountId}`, MINUTE, now);
    if (rate.count > TICKETS_PER_MINUTE) {
      throw new IdentityError('TICKET_RATE_LIMITED', 'слишком много билетов', {
        retryAfterS: rate.retryAfterS,
      });
    }
    const character = await this.characters.owned(principal, shard.id, input.characterId);
    if (character.status === 'pending_deletion')
      throw new IdentityError('CHAR_PENDING_DELETION', 'герой в очереди удаления');
    if (character.status === 'rename_required')
      throw new IdentityError('CHAR_RENAME_REQUIRED', 'герою нужно новое имя');
    if (character.status === 'locked') throw new IdentityError('CHAR_LOCKED', 'герой заблокирован');

    const view = await this.shards.view(shard);
    const blocked = this.shards.entryBlocked(view, principal.acl);
    if (blocked === 'maintenance')
      throw new IdentityError('SHARD_MAINTENANCE', 'шард на обслуживании');
    if (blocked === 'draining')
      throw new IdentityError('SHARD_DRAINING', 'шард готовится к перезапуску');
    if (blocked === 'offline' || view.live === null)
      throw new IdentityError('SHARD_OFFLINE', 'шард недоступен');
    if (blocked === 'staff_only') throw new IdentityError('SHARD_NOT_FOUND', 'шард не найден');
    if (blocked === 'full') throw new IdentityError('SHARD_FULL', 'шард заполнен');

    const session = await this.live.session(shard.id, principal.accountId);
    if (session && session.characterId !== character.id) {
      throw new IdentityError('ACCOUNT_ALREADY_IN_WORLD', 'в мире другой герой аккаунта');
    }
    const takeover = session !== null && input.takeover === true;
    if (session && !takeover)
      throw new IdentityError('ACCOUNT_ALREADY_IN_WORLD', 'герой уже в мире; повторите с takeover');

    const profile = this.shards.profile(shard);
    let { realm, x, y, h } = character;
    const realmInfo = profile.realms.find((r) => r.key === realm);
    if (!realmInfo || x < 0 || y < 0 || x >= realmInfo.width || y >= realmInfo.height) {
      const city = startCity(character.startCity);
      if (!city) throw new IdentityError('SHARD_PARTITION_UNAVAILABLE', 'нет точки появления');
      console.warn(
        JSON.stringify({
          msg: 'tickets: позиция героя вне плана, город',
          characterId: character.id,
        }),
      );
      ({ realm, x, y, h } = city);
    }
    const partition = view.live.partitions.find(
      (p: PartitionInfo) =>
        !p.draining &&
        p.realm === realm &&
        x >= p.minX &&
        x <= p.maxX &&
        y >= p.minY &&
        y <= p.maxY,
    );
    const hub = view.live.hub;
    if (!partition || !hub || hub.draining)
      throw new IdentityError('SHARD_PARTITION_UNAVAILABLE', 'партиция недоступна');

    const staff = isStaff(principal.acl);
    const free = (capacity: number, buffer: number, online: number) =>
      capacity + (staff ? buffer : 0) - online;
    const account = await this.id.store.findAccount(principal.accountId);
    const ttlMs = shard.ticketTtlS * 1000;
    const bundleId = this.id.id();
    const base = {
      bundleId,
      shardId: shard.id,
      accountId: principal.accountId,
      characterId: character.id,
      entityId: character.entityId,
      name: character.name,
      accessLevel: account?.accessLevel ?? principal.acl,
      effectiveLevel: account?.effectiveLevel ?? principal.eacl,
      realm,
      x,
      y,
      h,
      purpose: 'initial_login' as const,
      takeover,
      issuedAt: now,
      expiresAt: now + ttlMs,
    };
    const world: TicketPayload = { ...base, roomType: 'world', roomId: partition.roomId };
    const hubPayload: TicketPayload = { ...base, roomType: 'hub', roomId: hub.roomId };
    const tokens = { world: newToken(this.id.deps.entropy), hub: newToken(this.id.deps.entropy) };
    const result = await this.live.issue({
      shardId: shard.id,
      accountId: principal.accountId,
      bundleId,
      world: {
        roomId: partition.roomId,
        token: tokens.world,
        payload: world,
        free: free(partition.hardCapacity, partition.staffBuffer, partition.onlineCount),
      },
      hub: {
        roomId: hub.roomId,
        token: tokens.hub,
        payload: hubPayload,
        free: free(hub.hardCapacity, hub.staffBuffer, hub.onlineCount),
      },
      ttlMs,
      now,
    });
    if (result !== 'OK') throw new IdentityError('SHARD_FULL', 'шард заполнен');
    return {
      bundleId,
      world: { ticket: tokens.world, roomId: partition.roomId, wsUrl: partition.wsUrl },
      hub: { ticket: tokens.hub, roomId: hub.roomId, wsUrl: hub.wsUrl },
      expiresAt: this.id.iso(now + ttlMs),
    };
  }
}
