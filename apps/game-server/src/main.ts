import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Server as ColyseusServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  formatGameServerStartupConfigLog,
  GameInfraService,
  GameServerModule,
  loadGameServerConfig,
} from "./game-server.module.js";
import { createHealthHttpServer } from "./health-server.js";

async function bootstrap(): Promise<void> {
  const config = loadGameServerConfig();
  process.stdout.write(`${formatGameServerStartupConfigLog(config)}\n`);

  const appContext = await NestFactory.createApplicationContext(GameServerModule.forRoot(config), {
    logger: ["error", "warn", "log"],
  });
  appContext.enableShutdownHooks();

  const infra = appContext.get(GameInfraService);
  const healthServer = createHealthHttpServer(config.SHARD_ID, infra);
  await new Promise<void>((resolve) => {
    healthServer.listen(config.GAME_HEALTH_PORT, config.GAME_HOST, () => resolve());
  });

  const gameServer = new ColyseusServer({
    transport: new WebSocketTransport(),
  });
  await gameServer.listen(config.GAME_PORT, config.GAME_HOST);

  process.stdout.write(
    `[game-server] Colyseus listening on ws://${config.GAME_HOST}:${config.GAME_PORT}, health on http://${config.GAME_HOST}:${config.GAME_HEALTH_PORT} (shard=${config.SHARD_ID})\n`,
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await Promise.allSettled([
      gameServer.gracefullyShutdown(false),
      new Promise<void>((resolve) => healthServer.close(() => resolve())),
      appContext.close(),
    ]);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void bootstrap();
