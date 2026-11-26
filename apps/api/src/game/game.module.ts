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
      controllers: [ShardsController, AdminShardsController, StaffCharactersController],
      providers: [
        { provide: OPTIONS, useValue: options },
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
