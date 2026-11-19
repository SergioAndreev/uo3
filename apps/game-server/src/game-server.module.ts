import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  GameServerEnvSchema,
  loadServerConfigOrExit,
  type GameServerEnv,
  type LoadServerConfigOptions,
} from "@uo3/config/env/server";
import { redactConfig, type DeepReadonly } from "@uo3/config/env/shared";
import { checkDbHealth, createDbClient, type DbClientHandle } from "@uo3/db";
import { Redis } from "ioredis";
import { connect as connectNats, type NatsConnection } from "nats";

export const GAME_SERVER_CONFIG_TOKEN = Symbol("GAME_SERVER_CONFIG_TOKEN");
export type GameServerConfig = DeepReadonly<GameServerEnv>;

export type DependencyStatus = "up" | "down";

export interface GameReadinessReport {
  readonly ok: boolean;
  readonly status: "ok" | "degraded";
  readonly shardId: string;
  readonly dependencies: {
    readonly postgres: DependencyStatus;
    readonly valkey: DependencyStatus;
    readonly nats: DependencyStatus;
  };
  readonly latencyMs: number;
}

export interface GameReadinessProber {
  checkReadiness(timeoutMs?: number): Promise<GameReadinessReport>;
}

export function loadGameServerConfig(options: LoadServerConfigOptions = {}): GameServerConfig {
  return loadServerConfigOrExit(GameServerEnvSchema, {
    appName: "game-server",
    ...options,
  });
}

export function formatGameServerStartupConfigLog(config: GameServerConfig): string {
  const sanitized = redactConfig(GameServerEnvSchema, config as Record<string, unknown>);
  return JSON.stringify({ event: "game-server.config.loaded", config: sanitized });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

@Injectable()
export class GameInfraService implements GameReadinessProber, OnModuleDestroy {
  private readonly dbHandle: DbClientHandle;
  private readonly valkey: Redis;
  private natsConn: NatsConnection | undefined;

  public constructor(@Inject(GAME_SERVER_CONFIG_TOKEN) private readonly config: GameServerConfig) {
    this.dbHandle = createDbClient(this.config.DATABASE_URL, { max: 5 });
    this.valkey = new Redis(this.config.VALKEY_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 400,
    });
    this.valkey.on("error", () => undefined);
  }

  private async probeValkey(timeoutMs: number): Promise<boolean> {
    try {
      if (this.valkey.status === "wait") {
        await withTimeout(this.valkey.connect(), timeoutMs);
      }
      const pong = await withTimeout(this.valkey.ping(), timeoutMs);
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  private async probeNats(timeoutMs: number): Promise<boolean> {
    try {
      if (!this.natsConn || this.natsConn.isClosed()) {
        this.natsConn = await withTimeout(
          connectNats({
            servers: this.config.NATS_URL,
            timeout: timeoutMs,
            reconnect: false,
          }),
          timeoutMs,
        );
      }
      await withTimeout(this.natsConn.flush(), timeoutMs);
      return !this.natsConn.isClosed();
    } catch {
      this.natsConn = undefined;
      return false;
    }
  }

  public async checkReadiness(timeoutMs = 450): Promise<GameReadinessReport> {
    const startedAt = Date.now();
    const [pgRes, valkeyOk, natsOk] = await Promise.all([
      checkDbHealth(this.dbHandle.db, timeoutMs),
      this.probeValkey(timeoutMs),
      this.probeNats(timeoutMs),
    ]);

    const ok = pgRes.ok && valkeyOk && natsOk;
    return {
      ok,
      status: ok ? "ok" : "degraded",
      shardId: this.config.SHARD_ID,
      dependencies: {
        postgres: pgRes.ok ? "up" : "down",
        valkey: valkeyOk ? "up" : "down",
        nats: natsOk ? "up" : "down",
      },
      latencyMs: Date.now() - startedAt,
    };
  }

  public async onModuleDestroy(): Promise<void> {
    const tasks: Promise<unknown>[] = [this.dbHandle.close()];
    tasks.push(
      this.valkey.quit().catch(() => {
        this.valkey.disconnect();
      }),
    );
    if (this.natsConn && !this.natsConn.isClosed()) {
      tasks.push(this.natsConn.drain().catch(() => this.natsConn?.close()));
    }
    await Promise.allSettled(tasks);
  }
}

@Module({})
export class GameServerModule {
  public static forRoot(config: GameServerConfig): DynamicModule {
    return {
      module: GameServerModule,
      providers: [{ provide: GAME_SERVER_CONFIG_TOKEN, useValue: config }, GameInfraService],
      exports: [GAME_SERVER_CONFIG_TOKEN, GameInfraService],
    };
  }
}
