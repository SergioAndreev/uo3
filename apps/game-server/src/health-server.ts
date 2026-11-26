import { createServer, type Server } from 'node:http';
import { checkReadiness, type Infra } from '@duskmarch/db/infra';
import type { ShardNode } from './host/node.js';

/** Запас до предела 500 мс на ответ. */
const PROBE_TIMEOUT_MS = 400;

/** Загруженный мир для ответа `/readyz`. */
export interface WorldInfo {
  realm: string;
  version: string;
}

/**
 * Пробы: `/healthz` и `/readyz` (P00) и `/health/live`, `/health/startup`, `/health/ready`, `/metrics` (P06).
 * Без узла (режим проб P00) готовность определяют только зависимости.
 */
export function createHealthServer(
  infra: Pick<Infra, 'probes'>,
  world?: WorldInfo,
  node?: () => ShardNode | undefined,
): Server {
  return createServer((request, response) => {
    const send = (code: number, body: unknown): void => {
      response.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    const current = node?.();
    const path = request.url?.split('?')[0];
    if (path === '/healthz' || path === '/health/live') send(200, { status: 'ok' });
    else if (path === '/health/startup') {
      const started = !node || current?.startedReady === true;
      send(started ? 200 : 503, { status: started ? 'started' : 'starting' });
    } else if (path === '/readyz' || path === '/health/ready') {
      void checkReadiness(infra.probes, PROBE_TIMEOUT_MS).then((readiness) => {
        const nodeReady = !node || current?.state === 'READY';
        const ok = readiness.status === 'ok' && nodeReady;
        const body = {
          ...readiness,
          ...(world ? { world } : {}),
          ...(node ? { node: current?.state ?? 'STARTING' } : {}),
        };
        send(ok ? 200 : 503, ok ? body : { ...body, status: 'unavailable' });
      });
    } else if (path === '/metrics') {
      const lines = [
        `duskmarch_node_ready ${current?.state === 'READY' ? 1 : 0}`,
        `duskmarch_online_players ${current?.onlineCount ?? 0}`,
        `duskmarch_tick_p99_ms ${current?.scheduler.tickP99Ms ?? 0}`,
        `duskmarch_tick_dropped_ms_total ${current?.scheduler.droppedMs ?? 0}`,
        `duskmarch_scheduler_errors_total ${current?.scheduler.errors ?? 0}`,
        `duskmarch_timers_active ${current?.scheduler.wheel.size ?? 0}`,
      ];
      response
        .writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
        .end(`${lines.join('\n')}\n`);
    } else send(404, { status: 'not_found' });
  });
}
