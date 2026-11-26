import { Type, type Static } from '@sinclair/typebox';
import { AccessLevelSchema } from '../identity/schemas.js';

/** Опкоды сессии и хаба (диапазон P06 `0x0020..0x003F` реестра протокола). */
export const RUNTIME_OPCODES = {
  'session:ready': 0x0020,
  'session:logout_request': 0x0021,
  'session:logout_pending': 0x0022,
  'session:heartbeat': 0x0023,
  'session:reconnect_token': 0x0024,
  'hub:motd': 0x0028,
  'hub:announcement': 0x0029,
  'hub:presence_summary': 0x002a,
  'hub:announce_request': 0x002b,
} as const;
export type RuntimeMessage = keyof typeof RUNTIME_OPCODES;

/** Коды закрытия WebSocket, используемые в P06 (реестр `4100..4199`). */
export const WS_CLOSE = {
  INVALID_TICKET: 4101,
  UNAUTHORIZED: 4102,
  BANNED: 4103,
  DUPLICATE_SESSION: 4104,
  CHARACTER_NOT_FOUND: 4105,
  PARTITION_FULL: 4106,
  IDLE_TIMEOUT: 4109,
  SERVER_SHUTDOWN: 4112,
  PARTITION_DRAINING: 4116,
  LOGOUT_COMPLETE: 4122,
  SESSION_REVOKED: 4123,
  ACCOUNT_ALREADY_IN_WORLD: 4124,
  CHARACTER_LOCKED: 4125,
  CHARACTER_FORCE_RENAME: 4126,
  SHARD_MAINTENANCE: 4127,
  PARTITION_NOT_READY: 4128,
  EPOCH_FENCED: 4117,
} as const;

/** Опции подключения к комнате: билет P05 или переподключение. */
export const JoinOptions = Type.Union([
  Type.Object(
    { ticket: Type.String({ minLength: 16, maxLength: 128 }) },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      reconnect: Type.Object({
        accountId: Type.String({ maxLength: 64 }),
        sessionId: Type.String({ maxLength: 128 }),
        token: Type.String({ maxLength: 128 }),
      }),
    },
    { additionalProperties: true },
  ),
]);
export type JoinOptions = Static<typeof JoinOptions>;

export const SessionReady = Type.Object({
  sessionId: Type.String(),
  entityId: Type.Integer(),
  realm: Type.String(),
  x: Type.Optional(Type.Integer()),
  y: Type.Optional(Type.Integer()),
  h: Type.Optional(Type.Integer()),
});
export const ReconnectToken = Type.Object({ sessionId: Type.String(), token: Type.String() });
export const LogoutPending = Type.Object({ reason: Type.String(), delayMs: Type.Integer() });
export const PresenceSummary = Type.Object({ onlineCount: Type.Integer({ minimum: 0 }) });

export const AnnouncementScope = Type.Union([
  Type.Object({ kind: Type.Literal('all') }),
  Type.Object({ kind: Type.Literal('realm'), realm: Type.String({ maxLength: 32 }) }),
  Type.Object({ kind: Type.Literal('staff_only') }),
]);
export const Severity = Type.Union(
  ['info', 'warning', 'critical', 'maintenance', 'shutdown_countdown'].map((s) => Type.Literal(s)),
);
export const AnnounceRequest = Type.Object(
  {
    severity: Severity,
    displayMode: Type.Union([Type.Literal('chat'), Type.Literal('banner'), Type.Literal('both')]),
    text: Type.String({ minLength: 1, maxLength: 512 }),
    localeKey: Type.Optional(Type.String({ maxLength: 128 })),
    scope: AnnouncementScope,
    pinned: Type.Boolean(),
    expiresAtMs: Type.Union([Type.Integer(), Type.Null()]),
  },
  { additionalProperties: false },
);

/** События шины игрового сервера (присутствие и сессии). */
export const SessionEntered = Type.Object({
  accountId: Type.String(),
  characterId: Type.String(),
  entityId: Type.Integer(),
  name: Type.String(),
  realm: Type.String(),
  partitionId: Type.String(),
  accessLevel: AccessLevelSchema,
  effectiveLevel: AccessLevelSchema,
});
export const SessionExited = Type.Object({
  accountId: Type.String(),
  characterId: Type.String(),
  partitionId: Type.String(),
});
