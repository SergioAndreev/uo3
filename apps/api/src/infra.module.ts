import { Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { checkDbHealth, createDbClient, type DbClientHandle } from "@uo3/db";
import { Redis } from "ioredis";
import { connect as connectNats, type NatsConnection } from "nats";
import { API_CONFIG_TOKEN, type ApiConfig } from "./config.module.js";

export type DependencyStatus = "up" | "down";

export interface ReadinessDependencies {
  readonly postgres: DependencyStatus;
  readonly valkey: DependencyStatus;
  readonly nats: DependencyStatus;
}

export interface ReadinessProbeResult {
  readonly ok: boolean;
  readonly status: "ok" | "degraded";
  readonly dependencies: ReadinessDependencies;
  readonly latencyMs: number;
}

export interface ReadinessProber {
  checkReadiness(timeoutMs?: number): Promise<ReadinessProbeResult>;
}

export const READINESS_PROBER_TOKEN = Symbol("READINESS_PROBER_TOKEN");

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

export function buildReadinessReport(
  pgOk: boolean,
  valkeyOk: boolean,
  natsOk: boolean,
  latencyMs: number,
): ReadinessProbeResult {
  const ok = pgOk && valkeyOk && natsOk;
  return {
    ok,
    status: ok ? "ok" : "degraded",
    dependencies: {
      postgres: pgOk ? "up" : "down",
      valkey: valkeyOk ? "up" : "down",
      nats: natsOk ? "up" : "down",
    },
    latencyMs,
  };
}

@Injectable()
export class InfraConnectionsService implements ReadinessProber, OnModuleDestroy {
  private readonly dbHandle: DbClientHandle;
  private readonly valkey: Redis;
  private natsConn: NatsConnection | undefined;

  public constructor(@Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig) {
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

  public async checkReadiness(timeoutMs = 450): Promise<ReadinessProbeResult> {
    const startedAt = Date.now();
    const [pgRes, valkeyOk, natsOk] = await Promise.all([
      checkDbHealth(this.dbHandle.db, timeoutMs),
      this.probeValkey(timeoutMs),
      this.probeNats(timeoutMs),
    ]);

    return buildReadinessReport(pgRes.ok, valkeyOk, natsOk, Date.now() - startedAt);
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

@Module({
  providers: [
    InfraConnectionsService,
    {
      provide: READINESS_PROBER_TOKEN,
      useExisting: InfraConnectionsService,
    },
  ],
  exports: [InfraConnectionsService, READINESS_PROBER_TOKEN],
})
export class InfraConnectionsModule {}
