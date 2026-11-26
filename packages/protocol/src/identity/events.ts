import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { AccessLevelSchema, IsoTime } from './schemas.js';

const base = <T extends Record<string, TSchema>>(fields: T) =>
  Type.Object({
    eventId: Type.String(),
    accountId: Type.String(),
    occurredAt: IsoTime,
    ...fields,
  });

/** События шины NATS; игровой сервер (P06) кикает по ним. */
export const IDENTITY_EVENTS = {
  'identity.account.banned': base({
    banId: Type.String(),
    reason: Type.String(),
    expiresAt: Type.Union([Type.String(), Type.Null()]),
  }),
  'identity.account.unbanned': base({ banId: Type.String() }),
  'identity.account.sessions_revoked': base({
    sessionIds: Type.Array(Type.String()),
    reason: Type.String(),
  }),
  'identity.account.access_level_changed': base({
    previousLevel: AccessLevelSchema,
    newLevel: AccessLevelSchema,
    changedBy: Type.String(),
  }),
  'identity.account.effective_level_changed': base({
    maxLevel: AccessLevelSchema,
    effectiveLevel: AccessLevelSchema,
  }),
} as const;

export type IdentitySubject = keyof typeof IDENTITY_EVENTS;
export type IdentityEvent<S extends IdentitySubject> = Static<(typeof IDENTITY_EVENTS)[S]>;
export const IDENTITY_STREAM = 'IDENTITY_EVENTS';
