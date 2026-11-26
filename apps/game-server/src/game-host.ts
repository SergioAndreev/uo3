import 'reflect-metadata';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Infra } from '@duskmarch/db/infra';
import { NestFactory } from '@nestjs/core';
import { AppModule, INFRA, type GameServerConfig } from './app.module.js';
import { createHealthServer, type WorldInfo } from './health-server.js';
import { HostError, buildNode, loadShard, type LoadedWorld } from './host/boot.js';
import { infraPorts, subscribeEvents } from './host/infra-ports.js';
import type { ShardNode } from './host/node.js';
import { safeZones, spawnResolver } from './host/world-ports.js';
import { ShardHubRoom, WorldPartitionRoom } from './rooms/rooms.js';
import { netContext } from './netcode/context.js';

export interface GameHost {
  healthPort: number;
  gamePort: number;
  node?: ShardNode;
  stop: () => Promise<void>;
}

const portOf = (server: HttpServer): number => (server.address() as AddressInfo).port;

const log = (level: 'info' | 'warn' | 'error', msg: string, data: Record<string, unknown> = {}) => {
  const line = JSON.stringify({ level, msg: `game-server: ${msg}`, ...data });
  if (level === 'error') console.error(line);
  else console.log(line);
};

/**
 * Порядок старта: контекст и подключения → пробы → (с миром) шард из БД и профиль → узел и партиции →
 * комнаты Colyseus → подписки → приём подключений. Без `world` — только пробы зависимостей (режим P00).
 */
export async function startGameHost(
  config: GameServerConfig,
  world?: LoadedWorld,
): Promise<GameHost> {
  const context = await NestFactory.createApplicationContext(AppModule.register(config), {
    logger: ['fatal', 'error', 'warn'],
  });
  const infra = context.get<Infra>(INFRA);
  let node: ShardNode | undefined;
  const info: WorldInfo | undefined = world
    ? { realm: world.store.realm.key, version: world.version }
    : undefined;
  const health = createHealthServer(infra, info, world ? () => node : undefined);
  await new Promise<void>((resolve, reject) => {
    health.once('error', reject);
    health.listen(config.GAME_HEALTH_PORT, config.GAME_HOST, resolve);
  });
  const httpServer = createServer();
  const game = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    gracefullyShutdown: false,
    greet: false,
  });
  let unsubscribe = () => undefined as void;
  try {
    if (world) {
      const { profile } = await loadShard(infra.db, config.SHARD_ID);
      const roomIdOf = (partitionId: string) => `${config.SHARD_ID}-${partitionId}`;
      const ports = infraPorts(
        {
          shardId: config.SHARD_ID,
          db: infra.db,
          redis: infra.valkey,
          nats: infra.nats,
          profile,
          resolveSpawn: (_realm, x, y, h) =>
            spawnResolver(world.store, profile.movement.heroHeightSteps)(x, y, h),
          isSafeZone: (_realm, x, y) => safeZones(world.landmarks)(x, y),
          log,
        },
        roomIdOf,
        `${config.SHARD_ID}-hub`,
      );
      node = await buildNode(config, profile, world, ports);
      game.define('world', WorldPartitionRoom);
      game.define('hub', ShardHubRoom);
      await game.listen(config.GAME_PORT, config.GAME_HOST);
      const net = netContext(config.SHARD_ID, profile, world.version, log);
      for (const [partitionId, p] of node.partitions) {
        await matchMaker.createRoom('world', { node, partitionId, roomId: p.roomId, net });
      }
      if (node.hub) await matchMaker.createRoom('hub', { node, roomId: node.hubRoomId, net });
      const nc = infra.nats();
      if (nc)
        unsubscribe = subscribeEvents(
          nc,
          config.SHARD_ID,
          (s, e) => (node as ShardNode).handleEvent(s, e),
          log,
        );
      else
        log('warn', 'NATS недоступен при старте: события P04/P05 не будут получены до перезапуска');
      node.scheduler.start();
      node.ready();
    } else {
      await game.listen(config.GAME_PORT, config.GAME_HOST);
    }
  } catch (error) {
    await game.gracefullyShutdown(false).catch(() => undefined);
    await new Promise((resolve) => health.close(resolve));
    await context.close();
    throw error instanceof HostError ? error : new HostError('HOST_BOOT_FAILED', String(error));
  }
  return {
    healthPort: portOf(health),
    gamePort: portOf(httpServer),
    ...(node ? { node } : {}),
    stop: async () => {
      unsubscribe();
      await node?.shutdown(() => process.exit(1));
      await game.gracefullyShutdown(false);
      await new Promise((resolve) => {
        health.close(resolve);
        health.closeAllConnections();
      });
      await context.close();
    },
  };
}
