import {
  Inject,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Infra } from '@duskmarch/db/infra';
import type { IdentityServices } from '../identity/core/index.js';
import { IDENTITY } from '../identity/http/tokens.js';
import { InfraConnectionsModule } from '../infra-connections.module.js';
import { INFRA } from '../tokens.js';
import {
  AdminShardsController,
  ShardsController,
  StaffCharactersController,
} from './http/shards.controller.js';
import { GAME } from './http/tokens.js';
import { IdentityError } from '../identity/core/errors.js';
import { AdminPersistenceController, PERSISTENCE } from '../persistence/controller.js';
import {
  DrizzleLedgerStore,
  DrizzleRestorePoints,
  MemoryLedgerStore,
  NatsFlushRequester,
  PersistenceAdmin,
} from '../persistence/index.js';
import { createGameServices, type GameServices } from './index.js';
import { DrizzleGameStore } from './infra/drizzle-store.js';
import { ValkeyLive } from './infra/valkey-live.js';
import { MemoryLive } from './memory/live.js';
import { MemoryGameStore } from './memory/store.js';

const OPTIONS = Symbol('game-options');
const FINALIZE_INTERVAL_MS = 60_000;

export interface GameModuleOptions {
  services?: GameServices;
  /** Хранилища в памяти (тестовые сборки identity без PostgreSQL и Valkey). */
  memory?: boolean;
  /** Фоновая финализация удалений (в тестах выключена). */
  jobs: boolean;
  /** Администрирование персистентности (P08); в тестах — свои порты. */
  persistence?: PersistenceAdmin;
}

/** Шарды, герои и билеты (P05). */
@Module({})
export class GameModule implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(GAME) private readonly game: GameServices,
    @Inject(OPTIONS) private readonly options: GameModuleOptions,
  ) {}

  static register(options: GameModuleOptions): DynamicModule {
    return {
      module: GameModule,
      imports: options.services || options.memory ? [] : [InfraConnectionsModule],
      controllers: [
        ShardsController,
        AdminShardsController,
        StaffCharactersController,
        AdminPersistenceController,
      ],
      providers: [
        { provide: OPTIONS, useValue: options },
        options.persistence
          ? { provide: PERSISTENCE, useValue: options.persistence }
          : options.services || options.memory
            ? {
                provide: PERSISTENCE,
                useFactory: (identity: IdentityServices) =>
                  new PersistenceAdmin(identity, new MemoryLedgerStore(), {
                    request: async () => {
                      throw new IdentityError('PERSIST_TX_UNAVAILABLE', 'узел шарда недоступен');
                    },
                  }),
                inject: [IDENTITY],
              }
            : {
                provide: PERSISTENCE,
                useFactory: (identity: IdentityServices, infra: Infra) =>
                  new PersistenceAdmin(
                    identity,
                    new DrizzleLedgerStore(infra.db),
                    new NatsFlushRequester(infra.nats),
                    undefined,
                    new DrizzleRestorePoints(infra.db),
                  ),
                inject: [IDENTITY, INFRA],
              },
        options.services
          ? { provide: GAME, useValue: options.services }
          : options.memory
            ? {
                provide: GAME,
                useFactory: (identity: IdentityServices) =>
                  createGameServices(identity, new MemoryGameStore(), new MemoryLive()),
                inject: [IDENTITY],
              }
            : {
                provide: GAME,
                useFactory: (identity: IdentityServices, infra: Infra) =>
                  createGameServices(
                    identity,
                    new DrizzleGameStore(infra.db),
                    new ValkeyLive(infra.valkey),
                  ),
                inject: [IDENTITY, INFRA],
              },
      ],
    };
  }

  onModuleInit(): void {
    if (!this.options.jobs) return;
    this.timer = setInterval(() => {
      void this.game.characters.finalizeDue().catch((error: unknown) => {
        console.error(
          JSON.stringify({ msg: 'game: финализация удалений не удалась', error: String(error) }),
        );
      });
    }, FINALIZE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
