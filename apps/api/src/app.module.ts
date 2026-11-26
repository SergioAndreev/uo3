import { Module, type DynamicModule } from '@nestjs/common';
import { GameModule } from './game/game.module.js';
import type { GameServices } from './game/index.js';
import type { PersistenceAdmin } from './persistence/index.js';
import { HealthController } from './health.controller.js';
import { IdentityModule, type IdentityRuntimeOptions } from './identity/identity.module.js';
import { InfraConnectionsModule } from './infra-connections.module.js';
import { PlatformConfigModule, type ApiConfig } from './platform-config.module.js';

@Module({})
export class AppModule {
  static register(
    config: ApiConfig,
    identity?: IdentityRuntimeOptions,
    game?: GameServices,
    persistence?: PersistenceAdmin,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformConfigModule.register(config),
        InfraConnectionsModule,
        IdentityModule.register(identity),
        GameModule.register({
          ...(game
            ? { services: game, jobs: false }
            : identity
              ? { memory: true, jobs: false }
              : { jobs: true }),
          ...(persistence ? { persistence } : {}),
        }),
      ],
      controllers: [HealthController],
    };
  }
}
