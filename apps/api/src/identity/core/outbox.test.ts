import { describe, expect, it, vi } from 'vitest';
import { MemoryIdentityStore } from '../memory/store.js';
import { MemoryEvents, MemoryMailbox } from '../memory/transports.js';
import { OUTBOX_BACKOFF_MS, OutboxDispatcher } from './outbox.js';

const row = (kind: 'email' | 'event', payload: unknown) => ({
  id: `${kind}-${Math.random()}`,
  kind,
  payload,
  status: 'pending' as const,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  createdAt: 0,
});

describe('outbox', () => {
  it('доставляет письма и события, стирает текст письма', async () => {
    const store = new MemoryIdentityStore();
    const mail = new MemoryMailbox();
    const events = new MemoryEvents();
    const clock = { utc: () => 1000 };
    await store.insertOutbox(row('email', { to: 'a@b.cd', subject: 's', text: 'token=секрет' }));
    await store.insertOutbox(row('event', { subject: 'identity.account.banned', event: { x: 1 } }));
    expect(await new OutboxDispatcher(store, mail, events, clock).runOnce()).toBe(2);
    expect(mail.sent).toHaveLength(1);
    expect(events.of('identity.account.banned')).toEqual([{ x: 1 }]);
    const rows = store.outboxRows();
    expect(rows.every((r) => r.status === 'done' && r.attempts === 1)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('секрет');
  });

  it('повторы с задержками, после пятой неудачи — dead', async () => {
    const store = new MemoryIdentityStore();
    const mail = new MemoryMailbox();
    mail.failing = true;
    let now = 0;
    const onDead = vi.fn();
    const dispatcher = new OutboxDispatcher(
      store,
      mail,
      new MemoryEvents(),
      { utc: () => now },
      { onDead },
    );
    await store.insertOutbox(row('email', { to: 'a@b.cd', subject: 's', text: 't' }));
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await dispatcher.runOnce()).toBe(0);
      const [state] = store.outboxRows();
      expect(state?.attempts).toBe(attempt);
      if (attempt < 5) {
        expect(state?.nextAttemptAt).toBe(now + (OUTBOX_BACKOFF_MS[attempt - 1] ?? 0));
        expect(await dispatcher.runOnce()).toBe(0);
        expect(store.outboxRows()[0]?.attempts).toBe(attempt);
        now = state?.nextAttemptAt ?? now;
      }
    }
    expect(store.outboxRows()[0]).toMatchObject({
      status: 'dead',
      lastError: 'почтовый сервер недоступен',
    });
    expect(onDead).toHaveBeenCalledOnce();
  });

  it('периодический запуск и остановка', async () => {
    vi.useFakeTimers();
    const store = new MemoryIdentityStore();
    const mail = new MemoryMailbox();
    const dispatcher = new OutboxDispatcher(store, mail, new MemoryEvents(), { utc: () => 0 });
    await store.insertOutbox(row('email', { to: 'a@b.cd', subject: 's', text: 't' }));
    dispatcher.start(100);
    await vi.advanceTimersByTimeAsync(150);
    await dispatcher.stop();
    vi.useRealTimers();
    expect(mail.sent).toHaveLength(1);
  });
});
