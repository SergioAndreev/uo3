import { ACCESS_LEVELS } from '@duskmarch/domain';
import { Type, type Static } from '@sinclair/typebox';

const Email = Type.String({ minLength: 1, maxLength: 320 });
/** Длина пароля проверяет политика: здесь только предел размера тела. */
const Password = Type.String({ minLength: 1, maxLength: 1024 });
const Token = Type.String({ minLength: 16, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$' });
const Code = Type.String({ minLength: 6, maxLength: 16 });
const Reason = Type.String({ maxLength: 2000 });
/** ISO 8601 UTC с миллисекундами, как выдаёт `Date#toISOString`. */
export const IsoTime = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$',
});
const Iso = IsoTime;

export const AccessLevelSchema = Type.Union(ACCESS_LEVELS.map((level) => Type.Literal(level)));
export const OAuthProviderSchema = Type.Union([Type.Literal('discord'), Type.Literal('google')]);
export type OAuthProvider = Static<typeof OAuthProviderSchema>;

export const RegisterRequest = Type.Object(
  {
    email: Email,
    password: Password,
    tosAccepted: Type.Boolean(),
    tosVersion: Type.Optional(Type.String({ maxLength: 64 })),
    privacyVersion: Type.Optional(Type.String({ maxLength: 64 })),
    challengeToken: Type.Optional(Type.String({ maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export const VerifyEmailRequest = Type.Object({ token: Token }, { additionalProperties: false });
export const EmailOnlyRequest = Type.Object({ email: Email }, { additionalProperties: false });

export const LoginRequest = Type.Object(
  { email: Email, password: Password },
  { additionalProperties: false },
);
export const MfaVerifyRequest = Type.Object(
  { challengeToken: Token, code: Code },
  { additionalProperties: false },
);
export const LogoutAllRequest = Type.Object(
  { keepCurrent: Type.Boolean() },
  { additionalProperties: false },
);
export const ReauthRequest = Type.Object(
  { password: Type.Optional(Password), code: Type.Optional(Code) },
  { additionalProperties: false },
);
export const OAuthOnboardRequest = Type.Object(
  {
    onboardingToken: Token,
    tosAccepted: Type.Boolean(),
    tosVersion: Type.Optional(Type.String({ maxLength: 64 })),
    privacyVersion: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: false },
);

export const TfaConfirmRequest = Type.Object(
  { setupToken: Token, code: Code },
  { additionalProperties: false },
);
export const TfaCodeRequest = Type.Object(
  { code: Code, password: Type.Optional(Password) },
  { additionalProperties: false },
);

export const PasswordResetConfirmRequest = Type.Object(
  { token: Token, newPassword: Password },
  { additionalProperties: false },
);
export const PasswordChangeRequest = Type.Object(
  {
    currentPassword: Type.Optional(Password),
    newPassword: Password,
    code: Type.Optional(Code),
  },
  { additionalProperties: false },
);
export const EmailChangeRequest = Type.Object(
  { newEmail: Email, password: Password, code: Type.Optional(Code) },
  { additionalProperties: false },
);
export const EmailChangeConfirmRequest = Type.Object(
  { token: Token },
  { additionalProperties: false },
);
export const PageQuery = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);

export const BanRequest = Type.Object(
  { reason: Reason, expiresAt: Type.Optional(Iso) },
  { additionalProperties: false },
);
export const ReasonRequest = Type.Object({ reason: Reason }, { additionalProperties: false });
export const AccessLevelChangeRequest = Type.Object(
  { level: Type.String({ maxLength: 32 }), reason: Reason, code: Code },
  { additionalProperties: false },
);
export const EffectiveLevelRequest = Type.Object(
  { level: Type.String({ maxLength: 32 }) },
  { additionalProperties: false },
);

/** Ответы. */
export const SessionIssued = Type.Object({
  status: Type.Literal('authenticated'),
  accessToken: Type.String(),
  expiresIn: Type.Integer(),
  sessionId: Type.String(),
  accessLevel: AccessLevelSchema,
});
export const LoginResponse = Type.Union([
  SessionIssued,
  Type.Object({
    status: Type.Literal('mfa_required'),
    mfaChallengeToken: Type.String(),
    expiresIn: Type.Integer(),
  }),
  Type.Object({
    status: Type.Literal('staff_2fa_setup_required'),
    accessToken: Type.String(),
    expiresIn: Type.Integer(),
  }),
]);
export const SessionView = Type.Object({
  id: Type.String(),
  createdAt: Iso,
  lastUsedAt: Iso,
  ip: Type.String(),
  userAgent: Type.String(),
  isCurrent: Type.Boolean(),
});
export const SecurityEventView = Type.Object({
  id: Type.String(),
  type: Type.String(),
  outcome: Type.Union([Type.Literal('success'), Type.Literal('failure')]),
  reasonCode: Type.Union([Type.String(), Type.Null()]),
  ip: Type.String(),
  userAgent: Type.String(),
  at: Iso,
});
export const TfaStatus = Type.Object({
  enabled: Type.Boolean(),
  enabledAt: Type.Union([Iso, Type.Null()]),
  remainingBackupCodes: Type.Integer(),
});

export type RegisterRequest = Static<typeof RegisterRequest>;
export type LoginResponse = Static<typeof LoginResponse>;
export type SessionView = Static<typeof SessionView>;
export type SecurityEventView = Static<typeof SecurityEventView>;
export type TfaStatus = Static<typeof TfaStatus>;
