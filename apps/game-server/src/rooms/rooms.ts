import { Room, type Client } from '@colyseus/core';
import { JoinOptions, RUNTIME_OPCODES, WS_CLOSE, type RuntimeMessage } from '@duskmarch/protocol';
import { Value } from '@sinclair/typebox/value';
import { CloseError, type ClientLink } from '../engine/session.js';
import type { ShardNode } from '../host/node.js';

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

interface RoomOptions {
  node: ShardNode;
  partitionId?: string;
  roomId: string;
}

/** Комната партиции плана: тонкий адаптер к ядру узла. */
export class WorldPartitionRoom extends Room {
  private node!: ShardNode;
  private partitionId = '';
  private sequence = 0;

  override onCreate(options: RoomOptions): void {
    this.autoDispose = false;
    this.node = options.node;
    this.partitionId = options.partitionId ?? '';
    this.roomId = options.roomId;
    this.onMessage('*', (client, type) => {
      const name = typeof type === 'number' ? OPCODE_TO_NAME.get(type) : type;
      if (name === 'session:logout_request' || name === 'session:heartbeat') {
        this.node.worldMessage(this.partitionId, client.sessionId, name, ++this.sequence);
      }
    });
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    if (!Value.Check(JoinOptions, options)) {
      client.leave(WS_CLOSE.INVALID_TICKET, 'нет билета');
      return;
    }
    try {
      await this.node.joinWorld(this.partitionId, link(client), options as never);
    } catch (error) {
      reject(client, error);
    }
  }

  override onLeave(client: Client): void {
    this.node.leaveWorld(this.partitionId, client.sessionId);
  }
}

/** Комната хаба шарда. */
export class ShardHubRoom extends Room {
  private node!: ShardNode;

  override onCreate(options: RoomOptions): void {
    this.autoDispose = false;
    this.node = options.node;
    this.roomId = options.roomId;
    this.onMessage('*', (client, type, message) => {
      const name = typeof type === 'number' ? OPCODE_TO_NAME.get(type) : type;
      this.node.hubMessage(client.sessionId, String(name ?? type), message);
    });
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    const ticket = (options as { ticket?: unknown } | undefined)?.ticket;
    if (typeof ticket !== 'string') {
      client.leave(WS_CLOSE.INVALID_TICKET, 'нет билета');
      return;
    }
    try {
      await this.node.joinHub(link(client), ticket);
    } catch (error) {
      reject(client, error);
    }
  }

  override onLeave(client: Client): void {
    this.node.hub?.leave(client.sessionId);
  }
}
