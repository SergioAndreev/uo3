import type { NatsConnection } from '@nats-io/transport-node';
import type { EventPublisher } from '../ports.js';

/** Публикация событий в NATS; без подключения — ошибка, outbox повторит попытку. */
export class NatsEventPublisher implements EventPublisher {
  constructor(private readonly connection: () => NatsConnection | undefined) {}

  async publish(subject: string, payload: unknown): Promise<void> {
    const nc = this.connection();
    if (!nc) throw new Error('NATS недоступен');
    nc.publish(subject, JSON.stringify(payload));
    await nc.flush();
  }
}
