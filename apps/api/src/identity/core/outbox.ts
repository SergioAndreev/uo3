import type { GameClock } from '@duskmarch/domain';
import type { EventPublisher, IdentityStore, MailMessage, MailTransport } from '../ports.js';

/** Задержки после 1–4 неудачи; пятая неудача переводит запись в `dead`. */
export const OUTBOX_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000] as const;
export const OUTBOX_MAX_ATTEMPTS = 5;

export interface OutboxOptions {
  batch?: number;
  leaseMs?: number;
  onDead?: (id: string, error: string) => void;
}

/** Доставка писем и событий из outbox с повторными попытками. */
export class OutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;

  constructor(
    private readonly store: IdentityStore,
    private readonly mail: MailTransport,
    private readonly events: EventPublisher,
    private readonly clock: Pick<GameClock, 'utc'>,
    private readonly options: OutboxOptions = {},
  ) {}

  async runOnce(): Promise<number> {
    const now = this.clock.utc();
    const rows = await this.store.claimOutbox(
      now,
      this.options.batch ?? 20,
      this.options.leaseMs ?? 60_000,
    );
    let delivered = 0;
    for (const row of rows) {
      try {
        if (row.kind === 'email') await this.mail.send(row.payload as MailMessage);
        else {
          const { subject, event } = row.payload as { subject: string; event: unknown };
          await this.events.publish(subject, event);
        }
        // Текст письма содержит одноразовые ссылки: после отправки он не хранится.
        const payload =
          row.kind === 'email'
            ? { to: (row.payload as MailMessage).to, redacted: true }
            : row.payload;
        await this.store.updateOutbox(row.id, {
          status: 'done',
          attempts: row.attempts + 1,
          payload,
          lastError: null,
        });
        delivered++;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        const dead = attempts >= OUTBOX_MAX_ATTEMPTS;
        await this.store.updateOutbox(row.id, {
          attempts,
          lastError: message,
          status: dead ? 'dead' : 'pending',
          nextAttemptAt: now + (OUTBOX_BACKOFF_MS[attempts - 1] ?? 0),
        });
        if (dead) this.options.onDead?.(row.id, message);
      }
    }
    return delivered;
  }

  /** Периодический запуск; ошибки хранилища не останавливают цикл. */
  start(intervalMs = 1_000): void {
    this.timer = setInterval(() => {
      this.running ??= this.runOnce()
        .catch(() => 0)
        .finally(() => (this.running = undefined));
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
