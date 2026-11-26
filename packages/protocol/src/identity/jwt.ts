import { Type, type Static } from '@sinclair/typebox';
import { AccessLevelSchema } from './schemas.js';

/** Срок Access JWT, секунды. */
export const ACCESS_TOKEN_TTL_S = 900;
export const ACCESS_TOKEN_VERSION = 1;

/** Утверждения Access JWT; `scope: 'tfa_setup'` — ограниченный токен персонала без 2FA. */
export const AccessClaims = Type.Object({
  iss: Type.String(),
  aud: Type.String(),
  sub: Type.String(),
  sid: Type.String(),
  jti: Type.String(),
  iat: Type.Integer(),
  exp: Type.Integer(),
  acl: AccessLevelSchema,
  eacl: AccessLevelSchema,
  mfa: Type.Boolean(),
  ver: Type.Literal(ACCESS_TOKEN_VERSION),
  scope: Type.Optional(Type.Literal('tfa_setup')),
});
export type AccessClaims = Static<typeof AccessClaims>;

export const Jwk = Type.Object({
  kty: Type.Literal('OKP'),
  crv: Type.Literal('Ed25519'),
  x: Type.String(),
  kid: Type.String(),
  alg: Type.Literal('EdDSA'),
  use: Type.Literal('sig'),
});
export const JwkSet = Type.Object({ keys: Type.Array(Jwk) });
export type JwkSet = Static<typeof JwkSet>;
