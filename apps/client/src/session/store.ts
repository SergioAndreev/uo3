import type { SessionKind } from '../app/routes.js';

/** Минимальный канал между вкладками (`BroadcastChannel`). */
export interface Channel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  close(): void;
}

/** `navigator.locks` или его отсутствие. */
export interface Locks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface IssuedToken {
  accessToken: string;
  expiresIn: number;
  kind: SessionKind;
}

export type RefreshOutcome = { ok: true; token: IssuedToken } | { ok: false; code: string };

export interface SessionDeps {
  /** `POST /api/v1/auth/refresh` с cookie `httpOnly`. */
  refresh(): Promise<RefreshOutcome>;
  /** `POST /api/v1/auth/logout`. */
  logout(token: string | null): Promise<void>;
  channel: Channel;
  locks: Locks | null;
  now(): number;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Выход по сигналу (своей или другой вкладки): переход на `/login`. */
  onSignedOut?(reason: string): void;
  random?(): number;
}

type Message =
  | { type: 'token'; token: IssuedToken; issuedAt: number; seq: number }
  | { type: 'logout'; reason: string }
  | { type: 'claim'; id: number; seq: number };

const END_CODES = new Set([
  'AUTH_TOKEN_REUSE_DETECTED',
  'AUTH_SESSION_REVOKED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_REFRESH_TOKEN_MISSING',
  'AUTH_UNAUTHENTICATED',
]);

/**
 * Access JWT только в памяти вкладки. Обновление за 60 с до истечения — одно на все вкладки
 * (`navigator.locks`, без них — выбор лидера через канал); выход расходится по вкладкам.
 */
export class SessionStore {
  private token: IssuedToken | null = null;
  private issuedAt = 0;
  private seq = 0;
  private timer: unknown = null;
  private inflight: Promise<boolean> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly id: number;
  private waiting: ((ok: boolean) => void) | null = null;
  private claims = new Map<number, number>();

  constructor(private readonly d: SessionDeps) {
    this.id = Math.floor((d.random ?? Math.random)() * 1e9);
    d.channel.addEventListener('message', (e) => this.onMessage(e.data as Message));
  }

  get kind(): SessionKind {
    return this.token?.kind ?? 'guest';
  }

  get accessToken(): string | null {
    return this.token?.accessToken ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Новый токен (вход, обновление, второй фактор): рассылается другим вкладкам. */
  accept(token: IssuedToken, broadcast = true): void {
    this.set(token, this.d.now());
    this.seq++;
    if (broadcast)
      this.d.channel.postMessage({
        type: 'token',
        token,
        issuedAt: this.issuedAt,
        seq: this.seq,
      } satisfies Message);
  }

  /** Число принятых токенов (своих и из других вкладок). */
  private version = 0;

  private set(token: IssuedToken, issuedAt: number): void {
    this.version++;
    this.token = token;
    this.issuedAt = issuedAt;
    if (this.timer) this.d.clearTimer(this.timer);
    const delay = Math.max(0, token.expiresIn * 1000 - 60_000);
    this.timer = this.d.setTimer(() => void this.refresh(), delay);
    this.notify();
  }

  private clear(): void {
    this.token = null;
    if (this.timer) this.d.clearTimer(this.timer);
    this.timer = null;
    this.notify();
  }

  private onMessage(m: Message): void {
    if (m.type === 'token') {
      if (m.issuedAt >= this.issuedAt) this.set(m.token, m.issuedAt);
      this.waiting?.(true);
    } else if (m.type === 'logout') {
      this.clear();
      this.waiting?.(false);
      this.d.onSignedOut?.(m.reason);
    } else if (m.type === 'claim') {
      this.claims.set(m.id, m.seq);
    }
  }

  /** Тихое обновление; параллельные вызовы в одной вкладке — одно обещание. */
  refresh(): Promise<boolean> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<boolean> {
    const before = this.version;
    if (this.d.locks) {
      return this.d.locks.request('dm-refresh', async () => {
        // Пока ждали блокировку, другая вкладка могла уже обновить токен.
        if (this.version > before && this.token) return true;
        return this.callRefresh();
      });
    }
    return this.electAndRefresh(before);
  }

  /** Без Web Locks: заявка в канал, у кого меньший идентификатор — тот обновляет. */
  private async electAndRefresh(before: number): Promise<boolean> {
    this.claims = new Map([[this.id, this.seq]]);
    this.d.channel.postMessage({ type: 'claim', id: this.id, seq: this.seq } satisfies Message);
    await new Promise<void>((r) => this.d.setTimer(r, 50));
    if (this.version > before && this.token) return true;
    const leader = Math.min(...this.claims.keys());
    if (leader === this.id) return this.callRefresh();
    const ok = await new Promise<boolean>((resolve) => {
      this.waiting = resolve;
      this.d.setTimer(() => resolve(false), 3_000);
    });
    this.waiting = null;
    return ok || this.callRefresh();
  }

  private async callRefresh(): Promise<boolean> {
    const outcome = await this.d.refresh();
    if (outcome.ok) {
      this.accept(outcome.token);
      return true;
    }
    if (END_CODES.has(outcome.code)) this.end(outcome.code);
    return false;
  }

  /** Завершение сессии во всех вкладках. */
  end(reason: string): void {
    this.clear();
    this.d.channel.postMessage({ type: 'logout', reason } satisfies Message);
    this.d.onSignedOut?.(reason);
  }

  async logout(): Promise<void> {
    const token = this.accessToken;
    await this.d.logout(token).catch(() => undefined);
    this.end('logout');
  }
}
