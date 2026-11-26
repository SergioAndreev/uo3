import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_CODE_COUNT,
  hashBackupCode,
  looksLikeBackupCode,
  newBackupCode,
  normalizeBackupCode,
} from './backup-codes.js';
import { KeyRing, RETIRED_KEY_GRACE_MS, generateSpec } from './jwt.js';
import { PasswordHasher, passwordViolations } from './password.js';
import { newToken, safeEqual, sha256Hex, systemEntropy, uuidv7, type Entropy } from './random.js';
import { SecretBox } from './secret-box.js';
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, totpAt } from './totp.js';

/** Детерминированная «случайность» для тестов. */
export const counterEntropy = (seed = 1): Entropy => {
  let n = seed;
  return {
    bytes: (size) => Buffer.from(Array.from({ length: size }, () => (n = (n * 131 + 7) % 251))),
  };
};

describe('случайность и идентификаторы', () => {
  it('UUIDv7: версия, вариант, время в начале', () => {
    const id = uuidv7(Date.UTC(2026, 10, 26), counterEntropy());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.UTC(2026, 10, 26));
    expect(uuidv7(1, systemEntropy) < uuidv7(2, systemEntropy)).toBe(true);
  });

  it('токены 256 бит, хэши и сравнение', () => {
    expect(Buffer.from(newToken(systemEntropy), 'base64url')).toHaveLength(32);
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(safeEqual('a', 'a')).toBe(true);
    expect(safeEqual('a', 'b')).toBe(false);
  });
});

describe('пароли', () => {
  it('политика: длина, email, словарь', () => {
    expect(passwordViolations('длинная фраза с пробелами 🌒', 'hero@example.com')).toEqual([]);
    expect(passwordViolations('a'.repeat(11), 'x@y.zz')).toEqual(['length']);
    expect(passwordViolations('a'.repeat(129), 'x@y.zz')).toEqual(['length']);
    expect(passwordViolations('a'.repeat(128), 'x@y.zz')).toEqual([]);
    expect(passwordViolations('Hero.Champion', 'hero.champion@example.com')).toEqual([
      'matches_email',
    ]);
    expect(passwordViolations('Password1234', 'x@y.zz')).toEqual(['common']);
  });

  it('длина считается в символах после NFC', () => {
    const decomposed = 'é'.repeat(12);
    expect(passwordViolations(decomposed, 'x@y.zz')).toEqual([]);
    expect(passwordViolations('😀'.repeat(12), 'x@y.zz')).toEqual([]);
  });

  it('argon2id: хэш, проверка, холостой проход, пересчёт', async () => {
    const hasher = new PasswordHasher({ memoryKiB: 1024, timeCost: 1 });
    const stored = await hasher.hash('é очень длинный пароль');
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    expect(await hasher.verify(stored, 'é очень длинный пароль')).toBe(true);
    expect(await hasher.verify(stored, 'другой')).toBe(false);
    expect(await hasher.verify('мусор', 'x')).toBe(false);
    expect(await hasher.verifyDummy('x')).toBe(false);
    expect(hasher.needsRehash(stored)).toBe(false);
    expect(new PasswordHasher({ memoryKiB: 2048, timeCost: 1 }).needsRehash(stored)).toBe(true);
    expect(hasher.needsRehash('$2b$10$bcrypt')).toBe(true);
  });
});

describe('JWT EdDSA', () => {
  const now = Date.UTC(2026, 10, 26, 12);
  const expected = { iss: 'duskmarch', aud: 'duskmarch-api' };
  const claims = (iat = now / 1000) => ({
    ...expected,
    sub: 'a',
    sid: 's',
    jti: 'j',
    iat,
    exp: iat + 900,
    acl: 'player' as const,
    eacl: 'player' as const,
    mfa: false,
    ver: 1 as const,
  });

  it('подпись, проверка, срок', () => {
    const ring = KeyRing.generate('k1');
    const token = ring.sign(claims());
    expect(JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString())).toEqual({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: 'k1',
    });
    const result = ring.verify(token, now, expected);
    expect(result).toEqual({ ok: true, claims: claims() });
    expect(ring.verify(token, now + 899_000, expected).ok).toBe(true);
    expect(ring.verify(token, now + 900_000, expected)).toEqual({ ok: false, reason: 'expired' });
  });

  it('подделка, чужой ключ, чужая аудитория, мусор', () => {
    const ring = KeyRing.generate('k1');
    const token = ring.sign(claims());
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims(), acl: 'owner' })).toString('base64url');
    expect(ring.verify(`${h}.${forged}.${s}`, now, expected).ok).toBe(false);
    expect(KeyRing.generate('k1').verify(token, now, expected).ok).toBe(false);
    expect(ring.verify(token, now, { ...expected, aud: 'x' }).ok).toBe(false);
    expect(ring.verify('a.b', now, expected).ok).toBe(false);
    expect(ring.verify(`${h}.${p}`, now, expected).ok).toBe(false);
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url');
    expect(ring.verify(`${none}.${p}.${s}`, now, expected).ok).toBe(false);
    expect(ring.verify(`%%%.${p}.${s}`, now, expected).ok).toBe(false);
  });

  it('ротация: старый ключ в JWKS и принимается сутки', () => {
    const k1 = generateSpec();
    const before = KeyRing.fromSpecs([{ kid: 'k1', privateKeyPem: k1 }]);
    const old = before.sign(claims());
    const after = KeyRing.fromJson(
      JSON.stringify([
        { kid: 'k2', privateKeyPem: generateSpec() },
        { kid: 'k1', privateKeyPem: k1, retiredAt: new Date(now).toISOString() },
      ]),
    );
    expect(after.jwks(now).keys.map((k) => k.kid)).toEqual(['k2', 'k1']);
    expect(after.verify(old, now + 1000, expected).ok).toBe(true);
    expect(after.sign(claims()).split('.')[0]).toBe(
      Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: 'k2' })).toString('base64url'),
    );
    expect(after.jwks(now + RETIRED_KEY_GRACE_MS).keys.map((k) => k.kid)).toEqual(['k2']);
    const jwk = after.jwks(now).keys[0];
    expect(jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
  });

  it('ошибки конфигурации ключей', () => {
    expect(() => KeyRing.fromJson('[]')).toThrow('непустой');
    const pem = generateSpec();
    expect(() =>
      KeyRing.fromSpecs([{ kid: 'k', privateKeyPem: pem, retiredAt: '2026-01-01T00:00:00Z' }]),
    ).toThrow('действующего');
    expect(() => KeyRing.fromSpecs([{ kid: 'k', privateKeyPem: pem, retiredAt: 'вчера' }])).toThrow(
      'retiredAt',
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    expect(() => KeyRing.fromSpecs([{ kid: 'r', privateKeyPem: rsa }])).toThrow('Ed25519');
  });
});

describe('TOTP', () => {
  // RFC 6238, приложение B: секрет ASCII "12345678901234567890", SHA-1, 8 цифр.
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('вектор RFC 6238 t=%i', (t, code) => {
    expect(hotp(secret, Math.floor(t / 30), 8)).toBe(code);
  });

  it('векторы RFC 4226', () => {
    expect([0, 1, 2, 9].map((c) => hotp(secret, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '520489',
    ]);
  });

  it('окно ±1 шаг', () => {
    const now = 1_000_000_000_000;
    const code = totpAt(secret, now);
    expect(matchTotp(secret, code, now)).toBe(Math.floor(now / 30_000));
    expect(matchTotp(secret, code, now + 30_000)).not.toBeNull();
    expect(matchTotp(secret, code, now + 60_000)).toBeNull();
    expect(matchTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('Base32 и otpauth', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI======').toString()).toBe('foobar');
    expect(() => base32Decode('1!')).toThrow();
    const encoded = base32Encode(secret);
    expect(base32Decode(encoded)).toEqual(secret);
    expect(otpauthUri('Duskmarch', 'a@b.cd', encoded)).toBe(
      `otpauth://totp/Duskmarch%3Aa%40b.cd?secret=${encoded}&issuer=Duskmarch&algorithm=SHA1&digits=6&period=30`,
    );
  });
});

describe('AES-256-GCM', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const box = SecretBox.fromJson(JSON.stringify({ '1': key }), '1', counterEntropy());

  it('шифрует и расшифровывает с AAD', () => {
    const sealed = box.seal(Buffer.from('секрет'), 'dm:totp:v1:a');
    expect(sealed.keyVersion).toBe('1');
    expect(box.open(sealed, 'dm:totp:v1:a').toString()).toBe('секрет');
    expect(() => box.open(sealed, 'dm:totp:v1:b')).toThrow();
    expect(() =>
      box.open({ ...sealed, ciphertext: Buffer.from('x').toString('base64') }, 'dm:totp:v1:a'),
    ).toThrow();
    expect(() => box.open({ ...sealed, keyVersion: '9' }, 'x')).toThrow('версии 9');
  });

  it('ротация ключей: старые записи читаются', () => {
    const sealed = box.seal(Buffer.from('s'), 'a');
    const next = new SecretBox({ '1': key, '2': Buffer.alloc(32, 9) }, '2', systemEntropy);
    expect(next.open(sealed, 'a').toString()).toBe('s');
    expect(next.seal(Buffer.from('s'), 'a').keyVersion).toBe('2');
  });

  it('ошибки ключей', () => {
    expect(() => new SecretBox({ '1': Buffer.alloc(16) }, '1', systemEntropy)).toThrow('32 байта');
    expect(() => new SecretBox({ '1': key }, '2', systemEntropy)).toThrow('версии 2');
  });
});

describe('резервные коды', () => {
  it('формат, 40 бит, нормализация, хэш', () => {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => newBackupCode(systemEntropy));
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(looksLikeBackupCode(code.toLowerCase())).toBe(true);
    }
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
    expect(normalizeBackupCode(' ab12-cd34 ')).toBe('AB12CD34');
    expect(looksLikeBackupCode('123456')).toBe(false);
    expect(hashBackupCode('p', 'a', 'ab12-cd34')).toBe(hashBackupCode('p', 'a', 'AB12CD34'));
    expect(hashBackupCode('p', 'a', 'AB12CD34')).not.toBe(hashBackupCode('p', 'b', 'AB12CD34'));
    expect(newBackupCode({ bytes: (n) => Buffer.alloc(n, 0) })).toBe('0000-0000');
    expect(newBackupCode({ bytes: (n) => Buffer.alloc(n, 255) })).toBe('ZZZZ-ZZZZ');
  });
});
