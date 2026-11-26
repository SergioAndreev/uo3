import { createServer, type Server } from 'node:http';
import { checkReadiness, type Infra } from '@duskmarch/db/infra';

/** Запас до предела 500 мс на ответ. */
const PROBE_TIMEOUT_MS = 400;

/** Загруженный мир для ответа `/readyz`. */
export interface WorldInfo {
  realm: string;
  version: string;
}

export function createHealthServer(infra: Pick<Infra, 'probes'>, world?: WorldInfo): Server {
  return createServer((request, response) => {
    const send = (code: number, body: unknown): void => {
      response.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    const path = request.url?.split('?')[0];
    if (path === '/healthz') send(200, { status: 'ok' });
    else if (path === '/readyz') {
      void checkReadiness(infra.probes, PROBE_TIMEOUT_MS).then((readiness) =>
        send(readiness.status === 'ok' ? 200 : 503, world ? { ...readiness, world } : readiness),
      );
    } else send(404, { status: 'not_found' });
  });
}
