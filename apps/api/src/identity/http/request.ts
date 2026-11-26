import type { TSchema, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { ApiErrorCode } from '@duskmarch/protocol';
import { IdentityError, type Principal, type RequestMeta } from '../core/index.js';

/** Нужная часть запроса Express. */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string | undefined;
  body?: unknown;
  query?: Record<string, unknown>;
  principal?: Principal;
}

/** Нужная часть ответа Express. */
export interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string | string[]): unknown;
  getHeader(name: string): unknown;
  json(body: unknown): unknown;
  redirect(status: number, url: string): unknown;
  end(): unknown;
}

const header = (req: HttpRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

function originOf(req: HttpRequest): string | undefined {
  const origin = header(req, 'origin');
  if (origin) return origin;
  const referer = header(req, 'referer');
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export const metaOf = (req: HttpRequest): RequestMeta => ({
  ip: req.ip ?? 'unknown',
  userAgent: (header(req, 'user-agent') ?? '').slice(0, 512),
  origin: originOf(req),
});

export function cookiesOf(req: HttpRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header(req, 'cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      const name = part.slice(0, index).trim();
      try {
        out[name] = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        // Битое значение cookie игнорируется.
      }
    }
  }
  return out;
}

export function bearerOf(req: HttpRequest): string | undefined {
  const value = header(req, 'authorization');
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : undefined;
}

/** Проверка тела по TypeBox; ошибка — код валидации с путями полей. */
export function parse<T extends TSchema>(
  schema: T,
  value: unknown,
  code: ApiErrorCode = 'SEC_VALIDATION_FAILED',
): Static<T> {
  if (Value.Check(schema, value)) return value;
  const fields = [...Value.Errors(schema, value)].slice(0, 10).map((e) => e.path || '/');
  throw new IdentityError(code, 'запрос не соответствует схеме', { details: { fields } });
}

export const REFRESH_COOKIE = 'dm_refresh';
export const OAUTH_COOKIE = 'dm_oauth';

function cookie(
  name: string,
  value: string,
  path: string,
  maxAgeS: number,
  secure: boolean,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=${path}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeS))}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function append(res: HttpResponse, value: string): void {
  const current = res.getHeader('set-cookie');
  const list = Array.isArray(current) ? current.map(String) : current ? [String(current)] : [];
  res.setHeader('set-cookie', [...list, value]);
}

export const setRefreshCookie = (
  res: HttpResponse,
  token: string,
  maxAgeS: number,
  secure: boolean,
) => append(res, cookie(REFRESH_COOKIE, token, '/api/v1/auth', maxAgeS, secure));

export const clearRefreshCookie = (res: HttpResponse, secure: boolean) =>
  append(res, cookie(REFRESH_COOKIE, '', '/api/v1/auth', 0, secure));

export const setOAuthCookie = (res: HttpResponse, txId: string, secure: boolean) =>
  append(res, cookie(OAUTH_COOKIE, txId, '/api/v1/auth/oauth', 600, secure));
