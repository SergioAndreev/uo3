import { connect, type NatsConnection } from '@nats-io/transport-node';
import { sql } from 'drizzle-orm';
import { Redis } from 'iovalkey';
import { createDbClient, type Database } from './client.js';
import type { Probe } from './readiness.js';

export { checkReadiness, type Probe, type Readiness } from './readiness.js';

export interface InfraConfig {
  DATABASE_URL: string;
  VALKEY_URL: string;
  VALKEY_PASSWORD?: string | undefined;
  NATS_URL: string;
  NATS_PASSWORD?: string | undefined;
}

export interface Infra {
  db: Database;
  valkey: Redis;
  nats: () => NatsConnection | undefined;
  probes: Record<'postgres' | 'valkey' | 'nats', Probe>;
  close: () => Promise<void>;
}

const NATS_RETRY_MS = 1_000;

function keepNatsConnected(config: InfraConfig) {
  let current: NatsConnection | undefined;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  const url = new URL(config.NATS_URL);
  const password = config.NATS_PASSWORD ?? decodeURIComponent(url.password);
  const attempt = async (): Promise<void> => {
    try {
      const connection = await connect({
        servers: `${url.protocol}//${url.host}`,
        maxReconnectAttempts: -1,
        timeout: 2_000,
        ...(url.username ? { user: decodeURIComponent(url.username) } : {}),
        ...(password ? { pass: password } : {}),
      });
      if (closed) await connection.close();
      else current = connection;
    } catch {
      if (!closed) timer = setTimeout(() => void attempt(), NATS_RETRY_MS);
    }
  };
  const first = attempt();
  return {
    get: () => current,
    close: async () => {
      closed = true;
      clearTimeout(timer);
      await first;
      await current?.close();
    },
  };
}

/** Открывает подключения в фоне: недоступная зависимость не мешает старту. */
export function createInfra(config: InfraConfig): Infra {
  const client = createDbClient(config.DATABASE_URL);
  const valkey = new Redis(config.VALKEY_URL, {
    ...(config.VALKEY_PASSWORD ? { password: config.VALKEY_PASSWORD } : {}),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // Состояние видно через пробу; без обработчика ошибка завершит процесс.
  valkey.on('error', () => undefined);
  const nats = keepNatsConnected(config);
  return {
    db: client.db,
    valkey,
    nats: nats.get,
    probes: {
      postgres: () => client.db.execute(sql`select 1`),
      valkey: () => valkey.ping(),
      nats: async () => {
        const connection = nats.get();
        if (!connection) throw new Error('NATS не подключён');
        await connection.flush();
      },
    },
    close: async () => {
      valkey.disconnect();
      await Promise.allSettled([nats.close(), client.close()]);
    },
  };
}
