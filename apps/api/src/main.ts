import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { formatApiStartupConfigLog, loadApiConfig } from "./config.module.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  process.stdout.write(`${formatApiStartupConfigLog(config)}\n`);

  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: ["error", "warn", "log"],
  });
  app.enableShutdownHooks();

  await app.listen(config.API_PORT, config.API_HOST);
  process.stdout.write(
    `[api] listening on http://${config.API_HOST}:${config.API_PORT} (env=${config.NODE_ENV})\n`,
  );
}

void bootstrap();
