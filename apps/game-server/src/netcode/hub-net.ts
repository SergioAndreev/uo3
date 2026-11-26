import { HubState } from '@duskmarch/protocol/state';
import type { Scheduler } from '../engine/scheduler.js';
import type { NetContext } from './partition-net.js';
import { IntentRouter, NetSession, type NetSessionPorts } from './router.js';

/** Сетевой слой хаба: рукопожатие, намерения категории `hub`, общешардовое состояние без сущностей мира. */
export class HubNet {
  readonly state = new HubState();
  readonly router: IntentRouter;
  private readonly sessions = new Map<string, NetSession>();
  private order = 0;

  constructor(
    scheduler: Scheduler,
    private readonly ctx: NetContext,
  ) {
    this.state.shardId = ctx.shardId;
    this.router = new IntentRouter({
      room: 'hub',
      handshake: {
        ...ctx.handshake,
        tickIntervalMs: scheduler.tickMs,
        clock: () => ({ tick: scheduler.tick, timeMs: ctx.now() }),
      },
      enqueue: (item) => scheduler.enqueue(item),
      tick: () => scheduler.tick,
      now: ctx.now,
      ...(ctx.log ? { log: ctx.log } : {}),
    });
  }

  join(clientId: string, ports: NetSessionPorts): NetSession {
    const net = new NetSession(this.order++, ports, this.ctx.now());
    this.sessions.set(clientId, net);
    return net;
  }

  leave(clientId: string): void {
    const net = this.sessions.get(clientId);
    if (net) net.state = 'closed';
    this.sessions.delete(clientId);
  }

  receive(clientId: string, opcode: number, payload: unknown, frameBytes: number): void {
    const net = this.sessions.get(clientId);
    if (net) this.router.receive(net, opcode, payload, frameBytes);
  }

  inbound(clientId: string): void {
    const net = this.sessions.get(clientId);
    if (net) net.lastInboundMs = this.ctx.now();
  }

  postTick(status: { onlineCount: number; shardStatus: string; announcement?: string }): void {
    for (const net of this.sessions.values()) this.router.checkTimeouts(net);
    if (this.state.onlineCount !== status.onlineCount) this.state.onlineCount = status.onlineCount;
    if (this.state.shardStatus !== status.shardStatus) this.state.shardStatus = status.shardStatus;
    if (status.announcement !== undefined && this.state.announcement !== status.announcement) {
      this.state.announcement = status.announcement;
    }
  }
}
