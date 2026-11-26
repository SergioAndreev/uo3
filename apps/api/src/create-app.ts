import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { IdentityRuntimeOptions } from './identity/identity.module.js';
import type { ApiConfig } from './platform-config.module.js';

export async function createApp(
  config: ApiConfig,
  identity?: IdentityRuntimeOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.register(config, identity), new ExpressAdapter(), {
    logger: ['fatal', 'error', 'warn'],
  });
  app.enableCors({
    origin: [...config.CORS_ALLOWED_ORIGINS],
    credentials: config.CORS_ALLOW_CREDENTIALS,
  });
  app.enableShutdownHooks();
  return app;
}
