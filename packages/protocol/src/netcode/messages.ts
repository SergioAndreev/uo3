import { Type, type Static } from '@sinclair/typebox';
import { NETCODE_ERRORS } from './errors.js';

const SemVer = Type.String({
  pattern: '^(0|[1-9]\\d{0,4})\\.(0|[1-9]\\d{0,4})\\.(0|[1-9]\\d{0,4})$',
});
const Hex64 = Type.String({ pattern: '^[0-9a-f]{64}$' });

export const SessionHello = Type.Object(
  {
    protocolVersion: SemVer,
    rulesetFingerprint: Hex64,
    worldVersion: Hex64,
    patchIds: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 64 })),
  },
  { additionalProperties: false },
);
export type SessionHello = Static<typeof SessionHello>;

export const SessionWelcome = Type.Object({
  negotiatedProtocolVersion: SemVer,
  minSupportedProtocolVersion: SemVer,
  compatibility: Type.Union([Type.Literal('OK'), Type.Literal('PATCH_DIFF_WARNING')]),
  missingPatchIds: Type.Array(Type.String()),
  rulesetFingerprint: Hex64,
  ruleset: Type.Unknown(),
  worldVersion: Hex64,
  serverTick: Type.Integer(),
  serverTimeMs: Type.Number(),
  tickIntervalMs: Type.Integer(),
});
export type SessionWelcome = Static<typeof SessionWelcome>;

export const TimePing = Type.Object(
  { seq: Type.Integer({ minimum: 0, maximum: 0xffff_ffff }), clientSendMs: Type.Number() },
  { additionalProperties: false },
);
export type TimePing = Static<typeof TimePing>;

export const TimePong = Type.Object({
  seq: Type.Integer(),
  clientSendMs: Type.Number(),
  serverRecvMs: Type.Number(),
  serverSendMs: Type.Number(),
  serverTick: Type.Integer(),
  serverTickStartMs: Type.Number(),
  tickIntervalMs: Type.Integer(),
  serverTickLoadPct: Type.Integer({ minimum: 0, maximum: 255 }),
  serverTickOverrun: Type.Boolean(),
});
export type TimePong = Static<typeof TimePong>;

export const CmdError = Type.Object({
  requestId: Type.Union([Type.Integer(), Type.Null()]),
  opcode: Type.Union([Type.Integer(), Type.Null()]),
  error: Type.Union(Object.keys(NETCODE_ERRORS).map((k) => Type.Literal(k))),
  code: Type.Integer(),
  retryable: Type.Boolean(),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type CmdError = Static<typeof CmdError>;
