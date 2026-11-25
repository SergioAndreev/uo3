import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import type { GameServerEnvSchema } from '@duskmarch/config/env/server';
import { createInfra, type Infra } from '@duskmarch/db/infra';
import type { Static } from '@sinclair/typebox';

export type GameServerConfig = Readonly<Static<typeof GameServerEnvSchema>>;
export const INFRA = Symbol('infra');

@Module({})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(INFRA) private readonly infra: Infra) {}

  static register(config: GameServerConfig): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: INFRA, useFactory: () => createInfra(config) }],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.infra.close();
  }
}
