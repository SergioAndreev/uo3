import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError } from '../api/client.js';
import { Connectivity } from './connectivity.js';
import { SessionStore, type Channel, type Locks, type RefreshOutcome } from './store.js';

/** Общая шина «вкладок» одного origin (как `BroadcastChannel`). */
function bus() {
  const members = new Set<{ deliver: (m: unknown) => void }>();
  const channel = (): Channel => {
    const listeners: ((e: { data: unknown }) => void)[] = [];
    const me = { deliver: (m: unknown) => listeners.forEach((l) => l({ data: m })) };
    members.add(me);
    return {
      postMessage: (m) =>
        queueMicrotask(() => members.forEach((o) => o !== me && o.deliver(structuredClone(m)))),
      addEventListener: (_t, l) => void listeners.push(l),
      close: () => void members.delete(me),
    };
  };
  return { channel };
}

/** Взаимное исключение как `navigator.locks`. */
function locks(): Locks {
  let tail = Promise.resolve();
  return {
    request: <T>(_name: string, cb: () => Promise<T>) => {
      const run = tail.then(cb);
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

function clock() {
  let t = 0;
  const tasks: { at: number; cb: () => void; id: number }[] = [];
  let n = 0;
  return {
    now: () => t,
    setTimer: (cb: () => void, ms: number) => {
      const id = ++n;
      tasks.push({ at: t + ms, cb, id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = tasks.findIndex((x) => x.id === h);
      if (i >= 0) tasks.splice(i, 1);
    },
    advance: async (ms: number) => {
      t += ms;
      for (const task of [...tasks].filter((x) => x.at <= t)) {
        tasks.splice(tasks.indexOf(task), 1);
        task.cb();
      }
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function tabs(opts: { withLocks: boolean; outcome?: () => RefreshOutcome }) {
  const b = bus();
  const c = clock();
  const shared = locks();
  let refreshes = 0;
  const signedOut: string[] = [];
  const make = (seed: number) =>
    new SessionStore({
      refresh: async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
        return (
          opts.outcome?.() ?? {
            ok: true,
            token: { accessToken: `t${refreshes}`, expiresIn: 900, kind: 'full' },
          }
        );
      },
      logout: async () => undefined,
      channel: b.channel(),
      locks: opts.withLocks ? shared : null,
      now: c.now,
      setTimer: (cb, ms) => (ms <= 3_000 ? setTimeout(cb, Math.min(ms, 20)) : c.setTimer(cb, ms)),
      clearTimer: (h) =>
        typeof h === 'number' ? c.clearTimer(h) : clearTimeout(h as ReturnType<typeof setTimeout>),
      onSignedOut: (r) => signedOut.push(`${seed}:${r}`),
      random: () => seed / 10,
    });
  return { a: make(1), b: make(2), c, refreshes: () => refreshes, signedOut };
}

describe('client/app-shell: сессия между вкладками', () => {
  for (const withLocks of [true, false]) {
    it(`одновременное обновление двумя вкладками — один запрос (${withLocks ? 'Web Locks' : 'выбор лидера'})`, async () => {
      const t = tabs({ withLocks });
      const [ra, rb] = await Promise.all([t.a.refresh(), t.b.refresh()]);
      await flush();
      expect(ra && rb).toBe(true);
      expect(t.refreshes()).toBe(1);
      expect(t.a.accessToken).toBe('t1');
      expect(t.b.accessToken).toBe('t1');
      expect(t.a.kind).toBe('full');
    });
  }

  it('токен обновляется за 60 с до истечения', async () => {
    const t = tabs({ withLocks: true });
    t.a.accept({ accessToken: 'login', expiresIn: 900, kind: 'full' });
    await t.c.advance(839_000);
    expect(t.refreshes()).toBe(0);
    await t.c.advance(1_000);
    await flush();
    expect(t.refreshes()).toBe(1);
    expect(t.a.accessToken).toBe('t1');
  });

  it('выход в одной вкладке завершает все; повтор токена — выход везде', async () => {
    const t = tabs({ withLocks: true });
    t.a.accept({ accessToken: 'x', expiresIn: 900, kind: 'full' });
    await flush();
    expect(t.b.accessToken).toBe('x');
    await t.a.logout();
    await flush();
    expect(t.a.accessToken).toBeNull();
    expect(t.b.accessToken).toBeNull();
    expect(t.signedOut.sort()).toEqual(['1:logout', '2:logout']);
    const r = tabs({
      withLocks: true,
      outcome: () => ({ ok: false, code: 'AUTH_TOKEN_REUSE_DETECTED' }),
    });
    r.a.accept({ accessToken: 'y', expiresIn: 900, kind: 'full' });
    expect(await r.a.refresh()).toBe(false);
    await flush();
    expect(r.b.kind).toBe('guest');
    expect(r.signedOut).toContain('2:AUTH_TOKEN_REUSE_DETECTED');
    const n = tabs({ withLocks: true, outcome: () => ({ ok: false, code: 'NETWORK' }) });
    n.a.accept({ accessToken: 'z', expiresIn: 900, kind: 'full' });
    expect(await n.a.refresh()).toBe(false);
    expect(n.a.accessToken).toBe('z');
  });
});

describe('client/app-shell: клиент API', () => {
  const response = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  it('заголовки протокола, корреляции и токена; ошибки API с кодом и Retry-After', async () => {
    const seen: Headers[] = [];
    const api = new ApiClient({
      baseUrl: 'http://api',
      fetch: (async (_u: string, init: RequestInit) => {
        seen.push(new Headers(init.headers));
        return response(
          429,
          { error: { code: 'AUTH_RATE_LIMITED', details: { a: 1 } } },
          { 'retry-after': '900' },
        );
      }) as typeof fetch,
      token: () => 'tok',
      refresh: async () => false,
      correlationId: () => 'corr-1',
    });
    await expect(api.post('/api/v1/auth/login', { email: 'a' })).rejects.toMatchObject({
      status: 429,
      code: 'AUTH_RATE_LIMITED',
      retryAfterS: 900,
      details: { a: 1 },
    });
    expect(seen[0]?.get('x-duskmarch-protocol')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(seen[0]?.get('x-correlation-id')).toBe('corr-1');
    expect(seen[0]?.get('authorization')).toBe('Bearer tok');
    await expect(api.get('/x', { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(seen[1]?.get('authorization')).toBeNull();
  });

  it('истёкший токен — одно обновление и повтор; 426 — уведомление о новой версии', async () => {
    let token = 'old';
    let calls = 0;
    const incompatible: unknown[] = [];
    const api = new ApiClient({
      baseUrl: '',
      fetch: (async (u: string, init: RequestInit) => {
        calls++;
        if (u === '/old-client')
          return response(426, {
            error: { code: 'SHARD_PROTOCOL_INCOMPATIBLE', details: { minVersion: '1.2.0' } },
          });
        return new Headers(init.headers).get('authorization') === 'Bearer old'
          ? response(401, { error: { code: 'AUTH_TOKEN_EXPIRED' } })
          : response(200, { ok: true });
      }) as typeof fetch,
      token: () => token,
      refresh: async () => {
        token = 'new';
        return true;
      },
      onIncompatible: (d) => incompatible.push(d),
    });
    expect((await api.get<{ ok: boolean }>('/me')).data).toEqual({ ok: true });
    expect(calls).toBe(2);
    await expect(api.get('/old-client')).rejects.toMatchObject({ status: 426 });
    expect(incompatible).toEqual([{ minVersion: '1.2.0' }]);
  });

  it('связность: offline и online', () => {
    const handlers: Record<string, () => void> = {};
    const c = new Connectivity({
      addEventListener: ((t: string, h: () => void) => (handlers[t] = h)) as never,
      navigator: { onLine: true },
    });
    const seen: boolean[] = [];
    c.subscribe((v) => seen.push(v));
    handlers['offline']?.();
    handlers['online']?.();
    expect(seen).toEqual([false, true]);
    expect(c.online).toBe(true);
  });
});
