import 'reflect-metadata';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Infra } from '@duskmarch/db/infra';
import { NestFactory } from '@nestjs/core';
import { AppModule, INFRA, type GameServerConfig } from './app.module.js';
import { createHealthServer, type WorldInfo } from './health-server.js';

export interface GameHost {
  healthPort: number;
  gamePort: number;
  stop: () => Promise<void>;
}

const portOf = (server: HttpServer): number => (server.address() as AddressInfo).port;

export async function startGameHost(
  config: GameServerConfig,
  world?: WorldInfo,
): Promise<GameHost> {
  const context = await NestFactory.createApplicationContext(AppModule.register(config), {
    logger: ['fatal', 'error', 'warn'],
  });
  const httpServer = createServer();
  const game = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    gracefullyShutdown: false,
    greet: false,
  });
  const health = createHealthServer(context.get<Infra>(INFRA), world);
  await game.listen(config.GAME_PORT, config.GAME_HOST);
  await new Promise<void>((resolve, reject) => {
    health.once('error', reject);
    health.listen(config.GAME_HEALTH_PORT, config.GAME_HOST, resolve);
  });
  return {
    healthPort: portOf(health),
    gamePort: portOf(httpServer),
    stop: async () => {
      await game.gracefullyShutdown(false);
      await new Promise((resolve) => {
        health.close(resolve);
        health.closeAllConnections();
      });
      await context.close();
    },
  };
}
