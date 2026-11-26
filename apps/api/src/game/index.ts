import type { IdentityServices } from '../identity/core/index.js';
import { CharacterService, type DeletionGuard } from './characters.js';
import type { GameStore, LivePort } from './ports.js';
import { ShardService } from './shards.js';
import { TicketService } from './tickets.js';

export * from './characters.js';
export * from './ports.js';
export * from './shards.js';
export * from './tickets.js';

export interface GameServices {
  shards: ShardService;
  characters: CharacterService;
  tickets: TicketService;
  store: GameStore;
  live: LivePort;
}

export function createGameServices(
  identity: IdentityServices,
  store: GameStore,
  live: LivePort,
  guards: DeletionGuard[] = [],
): GameServices {
  identity.staff.onBanned((accountId) =>
    live.revoke('account', accountId, identity.identity.now()),
  );
  const shards = new ShardService(identity.identity, store, live, identity.staff);
  const characters = new CharacterService(
    identity.identity,
    store,
    live,
    shards,
    identity.staff,
    guards,
  );
  return {
    shards,
    characters,
    tickets: new TicketService(identity.identity, store, live, shards, characters),
    store,
    live,
  };
}
