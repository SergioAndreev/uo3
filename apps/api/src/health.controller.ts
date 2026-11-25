import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { checkReadiness, type Infra } from '@duskmarch/db/infra';
import { INFRA, PROBE_TIMEOUT_MS } from './tokens.js';

@Controller()
export class HealthController {
  constructor(@Inject(INFRA) private readonly infra: Pick<Infra, 'probes'>) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz() {
    const readiness = await checkReadiness(this.infra.probes, PROBE_TIMEOUT_MS);
    if (readiness.status !== 'ok') throw new ServiceUnavailableException(readiness);
    return readiness;
  }
}
