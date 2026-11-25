import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { ApiEnvSchema } from '@duskmarch/config/env/server';
import type { Static } from '@sinclair/typebox';
import { CONFIG } from './tokens.js';

export type ApiConfig = Readonly<Static<typeof ApiEnvSchema>>;

@Global()
@Module({})
export class PlatformConfigModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: PlatformConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
