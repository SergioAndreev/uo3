import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { createInfra, type Infra } from '@duskmarch/db/infra';
import { CONFIG, INFRA } from './tokens.js';

@Module({
  providers: [{ provide: INFRA, useFactory: createInfra, inject: [CONFIG] }],
  exports: [INFRA],
})
export class InfraConnectionsModule implements OnModuleDestroy {
  constructor(@Inject(INFRA) private readonly infra: Infra) {}

  async onModuleDestroy(): Promise<void> {
    await this.infra.close();
  }
}
