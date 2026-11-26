import type { EntityId } from '@duskmarch/domain';
import { NETCODE_CLOSE, NETCODE_ERRORS, NETCODE_OPCODES } from '@duskmarch/protocol';
import type { InterestManager } from './interest.js';

/** Разовое событие: тип и данные; критичные идут сразу, косметические — пакетом в конце тика. */
export interface TransientEvent {
  type: string;
  [key: string]: unknown;
}

export const SOFT_BUFFER_BYTES = 65_536;
export const HARD_BUFFER_BYTES = 262_144;
export const BURST_BUFFER_BYTES = 524_288;
export const HARD_BUFFER_MS = 5_000;

export interface EventPorts {
  send: (client: EntityId, opcode: number, payload: unknown) => void;
  /** Байты в исходящем буфере сокета клиента. */
  buffered: (client: EntityId) => number;
  close: (client: EntityId, code: number) => void;
}

/** Канал немедленных событий с фильтром области интереса и обратным давлением. */
export class EventChannel {
  private readonly batches = new Map<EntityId, TransientEvent[]>();
  private readonly overSince = new Map<EntityId, number>();
  dropped = 0;

  constructor(
    private readonly aoi: InterestManager,
    private readonly ports: EventPorts,
  ) {}

  /** Событие одному клиенту (подтверждение шага, системное сообщение). */
  to(client: EntityId, event: TransientEvent, critical = true): void {
    if (critical) {
      this.ports.send(client, NETCODE_OPCODES['event.batch'], { events: [event] });
      return;
    }
    if (this.ports.buffered(client) > SOFT_BUFFER_BYTES) {
      this.dropped++;
      return;
    }
    let batch = this.batches.get(client);
    if (!batch) this.batches.set(client, (batch = []));
    batch.push(event);
  }

  /** Пространственное событие: только видящим источник в пределах дальности события. */
  near(source: EntityId, range: number, event: TransientEvent, critical = false): EntityId[] {
    const recipients = this.aoi
      .watchersOf(source)
      .filter((o) => (this.aoi.distanceTo(o, source) ?? Infinity) <= range)
      .sort((a, b) => a - b);
    for (const client of recipients) this.to(client, event, critical);
    return recipients;
  }

  /** Конец тика: пакеты косметических событий и проверка медленных потребителей. */
  endTick(clients: Iterable<EntityId>, nowMs: number): EntityId[] {
    for (const [client, events] of this.batches) {
      if (events.length) this.ports.send(client, NETCODE_OPCODES['event.batch'], { events });
    }
    this.batches.clear();
    const closed: EntityId[] = [];
    for (const client of clients) {
      const bytes = this.ports.buffered(client);
      if (bytes <= HARD_BUFFER_BYTES) {
        this.overSince.delete(client);
        continue;
      }
      const since = this.overSince.get(client) ?? nowMs;
      this.overSince.set(client, since);
      if (bytes > BURST_BUFFER_BYTES || nowMs - since >= HARD_BUFFER_MS) {
        const { code, retryable } = NETCODE_ERRORS.NET_SLOW_CONSUMER;
        this.ports.send(client, NETCODE_OPCODES['cmd.error'], {
          requestId: null,
          opcode: null,
          error: 'NET_SLOW_CONSUMER',
          code,
          retryable,
        });
        this.ports.close(client, NETCODE_CLOSE.SLOW_CONSUMER);
        this.overSince.delete(client);
        this.batches.delete(client);
        closed.push(client);
      }
    }
    return closed;
  }
}
