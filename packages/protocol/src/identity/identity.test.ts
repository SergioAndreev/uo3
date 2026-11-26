import { ACCESS_LEVELS } from '@duskmarch/domain';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  AccessClaims,
  AccessLevelChangeRequest,
  BanRequest,
  IDENTITY_ERRORS,
  IDENTITY_EVENTS,
  JwkSet,
  LoginResponse,
  PageQuery,
  RegisterRequest,
  VerifyEmailRequest,
  isIdentityErrorCode,
} from './index.js';

describe('коды ошибок', () => {
  it('префиксы и статусы', () => {
    for (const [code, status] of Object.entries(IDENTITY_ERRORS)) {
      expect(code).toMatch(/^(REG|AUTH|TFA|SEC|RBAC)_[A-Z_]+$/);
      expect([400, 401, 403, 404, 409, 410, 429, 502]).toContain(status);
    }
    expect(isIdentityErrorCode('AUTH_SESSION_REVOKED')).toBe(true);
    expect(isIdentityErrorCode('toString')).toBe(false);
  });

  it('статусы из спецификаций', () => {
    expect(IDENTITY_ERRORS.REG_TOS_VERSION_OUTDATED).toBe(409);
    expect(IDENTITY_ERRORS.REG_VERIFICATION_TOKEN_EXPIRED).toBe(410);
    expect(IDENTITY_ERRORS.TFA_CHALLENGE_EXHAUSTED).toBe(429);
    expect(IDENTITY_ERRORS.RBAC_LAST_OWNER).toBe(409);
  });
});

describe('схемы запросов', () => {
  it('регистрация', () => {
    const ok = { email: 'a@b.cd', password: 'x', tosAccepted: true, tosVersion: '1' };
    expect(Value.Check(RegisterRequest, ok)).toBe(true);
    expect(Value.Check(RegisterRequest, { email: 'a@b.cd', tosAccepted: true })).toBe(false);
    expect(Value.Check(RegisterRequest, { ...ok, admin: true })).toBe(false);
  });

  it('токен — только base64url', () => {
    expect(Value.Check(VerifyEmailRequest, { token: 'A'.repeat(43) })).toBe(true);
    expect(Value.Check(VerifyEmailRequest, { token: 'a b'.repeat(10) })).toBe(false);
  });

  it('бан, смена уровня, страница', () => {
    expect(Value.Check(BanRequest, { reason: 'r', expiresAt: '2026-01-01T00:00:00.000Z' })).toBe(
      true,
    );
    expect(Value.Check(BanRequest, { reason: 'r', expiresAt: 'завтра' })).toBe(false);
    expect(Value.Check(AccessLevelChangeRequest, { level: 'x', reason: 'r', code: '123456' })).toBe(
      true,
    );
    expect(Value.Check(PageQuery, { limit: 100 })).toBe(true);
    expect(Value.Check(PageQuery, { limit: 101 })).toBe(false);
  });

  it('ответ входа — одна из трёх форм', () => {
    expect(
      Value.Check(LoginResponse, {
        status: 'mfa_required',
        mfaChallengeToken: 't',
        expiresIn: 300,
      }),
    ).toBe(true);
    expect(Value.Check(LoginResponse, { status: 'authenticated' })).toBe(false);
  });
});

describe('JWT и события', () => {
  const claims = {
    iss: 'duskmarch',
    aud: 'duskmarch-api',
    sub: 'a',
    sid: 's',
    jti: 'j',
    iat: 0,
    exp: 900,
    acl: 'moderator',
    eacl: 'player',
    mfa: true,
    ver: 1,
  };

  it('утверждения Access JWT', () => {
    expect(Value.Check(AccessClaims, claims)).toBe(true);
    expect(Value.Check(AccessClaims, { ...claims, scope: 'tfa_setup' })).toBe(true);
    expect(Value.Check(AccessClaims, { ...claims, acl: 'superuser' })).toBe(false);
    for (const level of ACCESS_LEVELS) {
      expect(Value.Check(AccessClaims, { ...claims, acl: level })).toBe(true);
    }
  });

  it('JWKS', () => {
    const key = { kty: 'OKP', crv: 'Ed25519', x: 'abc', kid: 'k1', alg: 'EdDSA', use: 'sig' };
    expect(Value.Check(JwkSet, { keys: [key] })).toBe(true);
    expect(Value.Check(JwkSet, { keys: [{ ...key, kty: 'RSA' }] })).toBe(false);
  });

  it('события имеют общие поля', () => {
    const common = { eventId: 'e', accountId: 'a', occurredAt: '2026-11-26T10:00:00.000Z' };
    expect(
      Value.Check(IDENTITY_EVENTS['identity.account.banned'], {
        ...common,
        banId: 'b',
        reason: 'r',
        expiresAt: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(IDENTITY_EVENTS['identity.account.access_level_changed'], {
        ...common,
        previousLevel: 'helper',
        newLevel: 'moderator',
        changedBy: 'o',
      }),
    ).toBe(true);
    for (const subject of Object.keys(IDENTITY_EVENTS)) {
      expect(subject).toMatch(/^identity\.account\.[a-z_]+$/);
    }
  });
});
