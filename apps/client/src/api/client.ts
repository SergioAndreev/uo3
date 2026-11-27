import { PROTOCOL_VERSION } from '@duskmarch/protocol';

/** Ошибка API: HTTP-статус, код, детали и `Retry-After`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
    readonly retryAfterS: number | null = null,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface ApiClientDeps {
  baseUrl: string;
  fetch: typeof fetch;
  token(): string | null;
  /** Попытка обновить токен при `401 AUTH_TOKEN_EXPIRED`. */
  refresh(): Promise<boolean>;
  /** `426`: требуется новая версия клиента. */
  onIncompatible?(details: Record<string, unknown>): void;
  correlationId?(): string;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

/** HTTP-клиент: токен, версия протокола, идентификатор корреляции, разбор ошибок API. */
export class ApiClient {
  constructor(private readonly d: ApiClientDeps) {}

  async request<T>(
    method: string,
    path: string,
    o: RequestOptions = {},
    retried = false,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'x-duskmarch-protocol': PROTOCOL_VERSION,
      'x-correlation-id': this.d.correlationId?.() ?? crypto.randomUUID(),
      ...o.headers,
    };
    const token = o.auth === false ? null : this.d.token();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.d.fetch(`${this.d.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    });
    const text = response.status === 204 || response.status === 304 ? '' : await response.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (response.ok || response.status === 304)
      return { status: response.status, data: data as T, headers: response.headers };
    const error = (
      data as { error?: { code?: string; details?: Record<string, unknown> } } | undefined
    )?.error;
    const code = error?.code ?? `HTTP_${response.status}`;
    const retryAfter = response.headers.get('retry-after');
    if (
      response.status === 401 &&
      code === 'AUTH_TOKEN_EXPIRED' &&
      !retried &&
      o.auth !== false &&
      (await this.d.refresh())
    ) {
      return this.request<T>(method, path, o, true);
    }
    if (response.status === 426) this.d.onIncompatible?.(error?.details ?? {});
    throw new ApiError(
      response.status,
      code,
      error?.details ?? {},
      retryAfter ? Number(retryAfter) : null,
    );
  }

  get = <T>(path: string, o?: RequestOptions) => this.request<T>('GET', path, o);
  post = <T>(path: string, body?: unknown, o?: RequestOptions) =>
    this.request<T>('POST', path, { ...o, body });
  patch = <T>(path: string, body?: unknown, o?: RequestOptions) =>
    this.request<T>('PATCH', path, { ...o, body });
  put = <T>(path: string, body?: unknown, o?: RequestOptions) =>
    this.request<T>('PUT', path, { ...o, body });
  delete = <T>(path: string, body?: unknown, o?: RequestOptions) =>
    this.request<T>('DELETE', path, { ...o, body });
}
