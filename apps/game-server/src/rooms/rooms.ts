import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { JoinOptions, RUNTIME_OPCODES, WS_CLOSE, type RuntimeMessage } from '@duskmarch/protocol';
import { Value } from '@sinclair/typebox/value';
import { CloseError, type ClientLink } from '../engine/session.js';
import type { ShardNode } from '../host/node.js';
import { HubNet } from '../netcode/hub-net.js';
import { PartitionNet, type NetContext, type NetPort } from '../netcode/partition-net.js';

const OPCODE_TO_NAME = new Map<number, RuntimeMessage>(
  Object.entries(RUNTIME_OPCODES).map(([name, code]) => [code, name as RuntimeMessage]),
);

/** Соединение Colyseus для ядра: имена сообщений → опкоды реестра. */
export function link(client: Client): ClientLink {
  return {
    id: client.sessionId,
    send: (type, payload) => client.send(RUNTIME_OPCODES[type as RuntimeMessage] ?? type, payload),
    close: (code, reason) => client.leave(code, reason),
  };
}

const reject = (client: Client, error: unknown): void => {
  const code = error instanceof CloseError ? error.code : WS_CLOSE.UNAUTHORIZED;
  client.leave(code, error instanceof Error ? error.message : 'отказ');
};

/** Оценка размера кадра: декодированное тело снова в байтах. */
export const frameBytes = (message: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(message ?? null));
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

interface Socket {
  bufferedAmount?: number;
  ping?: () => void;
  on?: (event: 'pong', listener: () => void) => void;
}

/** Порт клиента для сетевого слоя; исходящие байты патчей учитываются в бюджете. */
function port(client: Client, onBytes: (bytes: number) => void): NetPort {
  const view = new StateView();
  client.view = view;
  const raw = client.raw.bind(client);
  client.raw = ((data: Uint8Array, ...rest: unknown[]) => {
    onBytes(data.byteLength);
    return (raw as (...a: unknown[]) => void)(data, ...rest);
  }) as Client['raw'];
  return {
    id: client.sessionId,
    view,
    send: (opcode, payload) => client.send(opcode, payload),
    close: (code) => client.leave(code),
    buffered: () => (client.ref as Socket | undefined)?.bufferedAmount ?? 0,
  };
}

interface RoomOptions {
  node: ShardNode;
  partitionId?: string;
  roomId: string;
  net: NetContext;
}

/** Каждые 40 тиков (2 с) — протокольный ping WebSocket для серверной оценки RTT. */
const PROBE_TICKS = 40;

/** Комната партиции плана: ядро узла и сетевой слой P07. */
export class WorldPartitionRoom extends Room<PartitionNet['state']> {
  private node!: ShardNode;
  private partitionId = '';
  private sequence = 0;
  net!: PartitionNet;

  override onCreate(options: RoomOptions): void {
    this.autoDispose = false;
    this.node = options.node;
    this.partitionId = options.partitionId ?? '';
    this.roomId = options.roomId;
    const runtime = this.node.partitions.get(this.partitionId);
    if (!runtime) throw new Error(`нет партиции ${this.partitionId}`);
    this.net = new PartitionNet(runtime, this.node.scheduler, options.net);
    this.setState(this.net.state);
    this.setPatchRate(null);
    this.node.scheduler.onPostTick((ctx) => {
      this.net.postTick(ctx.tick);
      this.broadcastPatch();
      if (ctx.tick % PROBE_TICKS === 0) this.probe(options.net.now);
    });
    this.onMessage('*', (client, type, message) => {
      const name = typeof type === 'number' ? OPCODE_TO_NAME.get(type) : undefined;
      if (name === 'session:logout_request' || name === 'session:heartbeat') {
        this.net.inbound(client.sessionId);
        this.node.worldMessage(this.partitionId, client.sessionId, name, ++this.sequence);
        return;
      }
      this.net.receive(
        client.sessionId,
        typeof type === 'number' ? type : -1,
        message,
        frameBytes(message),
      );
    });
  }

  private probe(now: () => number): void {
    for (const client of this.clients) {
      const socket = client.ref as Socket | undefined;
      const net = this.net.sessionOf(client.sessionId);
      if (!socket?.ping || !net) continue;
      net.rtt.probeSent(now());
      socket.ping();
    }
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    if (!Value.Check(JoinOptions, options)) {
      client.leave(WS_CLOSE.INVALID_TICKET, 'нет билета');
      return;
    }
    try {
      const session = await this.node.joinWorld(this.partitionId, link(client), options as never);
      const net = this.net.join(
        port(client, (bytes) => this.net.recordBytes(client.sessionId, bytes)),
        session,
      );
      (client.ref as Socket | undefined)?.on?.('pong', () =>
        net.rtt.probeReplied(performance.now()),
      );
    } catch (error) {
      reject(client, error);
    }
  }

  override onLeave(client: Client): void {
    this.net.leave(client.sessionId);
    this.node.leaveWorld(this.partitionId, client.sessionId);
  }
}

/** Комната хаба шарда. */
export class ShardHubRoom extends Room<HubNet['state']> {
  private node!: ShardNode;
  net!: HubNet;

  override onCreate(options: RoomOptions): void {
    this.autoDispose = false;
    this.node = options.node;
    this.roomId = options.roomId;
    this.net = new HubNet(this.node.scheduler, options.net);
    this.setState(this.net.state);
    this.setPatchRate(null);
    this.node.scheduler.onPostTick(() => {
      this.net.postTick({
        onlineCount: this.node.onlineCount,
        shardStatus: this.node.maintenance ? 'maintenance' : this.node.state.toLowerCase(),
      });
      this.broadcastPatch();
    });
    this.onMessage('*', (client, type, message) => {
      const name = typeof type === 'number' ? OPCODE_TO_NAME.get(type) : undefined;
      if (name) {
        this.net.inbound(client.sessionId);
        this.node.hubMessage(client.sessionId, name, message);
        return;
      }
      this.net.receive(
        client.sessionId,
        typeof type === 'number' ? type : -1,
        message,
        frameBytes(message),
      );
    });
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    const ticket = (options as { ticket?: unknown } | undefined)?.ticket;
    if (typeof ticket !== 'string') {
      client.leave(WS_CLOSE.INVALID_TICKET, 'нет билета');
      return;
    }
    try {
      const claims = await this.node.joinHub(link(client), ticket);
      this.net.join(client.sessionId, {
        send: (opcode, payload) => client.send(opcode, payload),
        close: (code) => client.leave(code),
        accessLevel: () => claims.effectiveLevel,
        heroState: () => 'alive',
      });
    } catch (error) {
      reject(client, error);
    }
  }

  override onLeave(client: Client): void {
    this.net.leave(client.sessionId);
    this.node.hub?.leave(client.sessionId);
  }
}
