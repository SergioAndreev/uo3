import {
  Inject,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { Infra } from '@duskmarch/db/infra';
import { InfraConnectionsModule } from '../infra-connections.module.js';
import type { ApiConfig } from '../platform-config.module.js';
import { CONFIG, INFRA } from '../tokens.js';
import type { IdentityServices, OutboxDispatcher } from './core/index.js';
import { AccountController } from './http/account.controller.js';
import { AuthController, JwksController } from './http/auth.controller.js';
import { IdentityErrorFilter } from './http/filter.js';
import { IdentityGuard } from './http/guard.js';
import { StaffController } from './http/staff.controller.js';
import { IDENTITY, IDENTITY_HTTP } from './http/tokens.js';
import { buildIdentityRuntime } from './runtime.js';

const RUNTIME = Symbol('identity-runtime');
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface IdentityRuntimeOptions {
  services: IdentityServices;
  secureCookies: boolean;
  /** Без диспетчера outbox не запускается (тесты доставляют вручную). */
  outbox?: OutboxDispatcher;
  warnings?: string[];
}

/** Подсистема identity: контроллеры, охранник, фильтр ошибок, outbox. */
@Module({})
export class IdentityModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(RUNTIME) private readonly runtime: IdentityRuntimeOptions) {}

  /** `runtime` — готовые сервисы (тесты); без него — PostgreSQL, Valkey, NATS из конфигурации. */
  static register(runtime?: IdentityRuntimeOptions): DynamicModule {
    return {
      module: IdentityModule,
      imports: runtime ? [] : [InfraConnectionsModule],
      controllers: [AuthController, JwksController, AccountController, StaffController],
      providers: [
        runtime
          ? { provide: RUNTIME, useValue: runtime }
          : {
              provide: RUNTIME,
              useFactory: (config: ApiConfig, infra: Infra) => buildIdentityRuntime(config, infra),
              inject: [CONFIG, INFRA],
            },
        {
          provide: IDENTITY,
          useFactory: (r: IdentityRuntimeOptions) => r.services,
          inject: [RUNTIME],
        },
        {
          provide: IDENTITY_HTTP,
          useFactory: (r: IdentityRuntimeOptions) => ({ secureCookies: r.secureCookies }),
          inject: [RUNTIME],
        },
        { provide: APP_FILTER, useClass: IdentityErrorFilter },
        IdentityGuard,
      ],
      exports: [IDENTITY],
    };
  }

  private cleanup: NodeJS.Timeout | undefined;

  onModuleInit(): void {
    for (const warning of this.runtime.warnings ?? []) {
      console.warn(JSON.stringify({ msg: 'identity: предупреждение', warning }));
    }
    if (!this.runtime.outbox) return;
    this.runtime.outbox.start(1_000);
    // Неподтверждённые аккаунты старше 7 суток освобождают адрес.
    const expire = () =>
      void this.runtime.services.registration.cleanup().catch((error: unknown) => {
        console.error(
          JSON.stringify({ msg: 'identity: очистка не удалась', error: String(error) }),
        );
      });
    this.cleanup = setInterval(expire, CLEANUP_INTERVAL_MS);
    this.cleanup.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.cleanup);
    await this.runtime.outbox?.stop();
  }
}
