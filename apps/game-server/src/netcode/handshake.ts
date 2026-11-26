import {
  NETCODE_CLOSE,
  NETCODE_ERRORS,
  SessionHello,
  type NetcodeErrorCode,
  type SessionWelcome,
} from '@duskmarch/protocol';
import { Value } from '@sinclair/typebox/value';

type SemVer = readonly [number, number, number];

export function parseSemVer(value: string): SemVer | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const cmp = (a: SemVer, b: SemVer): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Совместимость версии клиента: тот же MAJOR, не ниже минимальной, MINOR не выше серверного
 * (PATCH клиента может быть любым внутри известного MINOR).
 */
export function negotiate(client: string, server: string, min: string): string | null {
  const c = parseSemVer(client);
  const s = parseSemVer(server);
  const m = parseSemVer(min);
  if (!c || !s || !m) return null;
  if (c[0] !== s[0] || cmp(c, m) < 0) return null;
  if (c[1] > s[1]) return null;
  return client;
}

export interface HandshakeConfig {
  protocolVersion: string;
  minSupportedProtocolVersion: string;
  rulesetFingerprint: string;
  /** Публичный срез профиля правил (P01 `publicProfile`). */
  ruleset: unknown;
  worldVersion: string;
  /** Патчи карты шарда поверх базовых данных. */
  patchIds: readonly string[];
  tickIntervalMs: number;
  clock: () => { tick: number; timeMs: number };
}

export type HandshakeResult =
  | { ok: true; welcome: SessionWelcome }
  | {
      ok: false;
      error: NetcodeErrorCode;
      close: number;
      details: Record<string, unknown>;
    };

/** Проверка `session.hello` и сборка `session.welcome`. */
export function handshake(config: HandshakeConfig, payload: unknown): HandshakeResult {
  if (!Value.Check(SessionHello, payload)) {
    return {
      ok: false,
      error: 'PROTO_INVALID_PAYLOAD',
      close: NETCODE_CLOSE.PROTOCOL_ERROR,
      details: {
        paths: [...Value.Errors(SessionHello, payload)].slice(0, 10).map((e) => e.path || '/'),
      },
    };
  }
  const negotiated = negotiate(
    payload.protocolVersion,
    config.protocolVersion,
    config.minSupportedProtocolVersion,
  );
  if (!negotiated) {
    return {
      ok: false,
      error: 'PROTO_VERSION_UNSUPPORTED',
      close: NETCODE_CLOSE.PROTOCOL_VERSION_MISMATCH,
      details: {
        serverVersion: config.protocolVersion,
        minSupportedVersion: config.minSupportedProtocolVersion,
        updateRequired: true,
      },
    };
  }
  if (payload.worldVersion !== config.worldVersion) {
    return {
      ok: false,
      error: 'PROTO_WORLD_DATA_INCOMPATIBLE',
      close: NETCODE_CLOSE.WORLD_DATA_MISMATCH,
      details: { expectedWorldVersion: config.worldVersion },
    };
  }
  const have = new Set(payload.patchIds ?? []);
  const missingPatchIds = config.patchIds.filter((id) => !have.has(id));
  const { tick, timeMs } = config.clock();
  return {
    ok: true,
    welcome: {
      negotiatedProtocolVersion: negotiated,
      minSupportedProtocolVersion: config.minSupportedProtocolVersion,
      compatibility: missingPatchIds.length > 0 ? 'PATCH_DIFF_WARNING' : 'OK',
      missingPatchIds,
      rulesetFingerprint: config.rulesetFingerprint,
      ruleset: config.ruleset,
      worldVersion: config.worldVersion,
      serverTick: tick,
      serverTimeMs: timeMs,
      tickIntervalMs: config.tickIntervalMs,
    },
  };
}

/** Тело `cmd.error` по коду ошибки. */
export function cmdError(
  error: NetcodeErrorCode,
  opts: {
    requestId?: number | null;
    opcode?: number | null;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  } = {},
) {
  const { code, retryable } = NETCODE_ERRORS[error];
  return {
    requestId: opts.requestId ?? null,
    opcode: opts.opcode ?? null,
    error,
    code,
    retryable,
    ...(opts.retryAfterMs !== undefined ? { retryAfterMs: opts.retryAfterMs } : {}),
    ...(opts.details ? { details: opts.details } : {}),
  };
}
