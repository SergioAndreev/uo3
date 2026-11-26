import { Module, type DynamicModule } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { IdentityModule, type IdentityRuntimeOptions } from './identity/identity.module.js';
import { InfraConnectionsModule } from './infra-connections.module.js';
import { PlatformConfigModule, type ApiConfig } from './platform-config.module.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig, identity?: IdentityRuntimeOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformConfigModule.register(config),
        InfraConnectionsModule,
        IdentityModule.register(identity),
      ],
      controllers: [HealthController],
    };
  }
}
