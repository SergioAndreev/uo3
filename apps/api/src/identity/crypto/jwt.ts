import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { AccessClaims, type JwkSet } from '@duskmarch/protocol';
import { Value } from '@sinclair/typebox/value';

/** Выведенный ключ остаётся в JWKS и принимается ещё сутки. */
export const RETIRED_KEY_GRACE_MS = 24 * 60 * 60 * 1000;

interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  retiredAt: number | undefined;
}

export interface KeySpec {
  kid: string;
  privateKeyPem: string;
  /** ISO-время вывода из оборота. */
  retiredAt?: string;
}

export type JwtFailure = 'expired' | 'invalid';
export type JwtResult = { ok: true; claims: AccessClaims } | { ok: false; reason: JwtFailure };

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

function parseJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

/** Набор ключей Ed25519: подписывает первый действующий, проверяют все из JWKS. */
export class KeyRing {
  private readonly keys: SigningKey[];

  private constructor(keys: SigningKey[]) {
    if (!keys.some((key) => key.retiredAt === undefined)) {
      throw new Error('нет действующего ключа подписи JWT');
    }
    this.keys = keys;
  }

  static fromSpecs(specs: readonly KeySpec[]): KeyRing {
    return new KeyRing(
      specs.map((spec) => {
        const privateKey = createPrivateKey(spec.privateKeyPem);
        if (privateKey.asymmetricKeyType !== 'ed25519') {
          throw new Error(`ключ ${spec.kid} не Ed25519`);
        }
        const retiredAt = spec.retiredAt === undefined ? undefined : Date.parse(spec.retiredAt);
        if (retiredAt !== undefined && Number.isNaN(retiredAt)) {
          throw new Error(`ключ ${spec.kid}: некорректное retiredAt`);
        }
        return { kid: spec.kid, privateKey, publicKey: createPublicKey(privateKey), retiredAt };
      }),
    );
  }

  /** Разбор `IDENTITY_JWT_SIGNING_KEYS_JSON`. */
  static fromJson(json: string): KeyRing {
    const specs = JSON.parse(json) as unknown;
    if (!Array.isArray(specs) || specs.length === 0) {
      throw new Error('IDENTITY_JWT_SIGNING_KEYS_JSON: ожидается непустой массив');
    }
    return KeyRing.fromSpecs(specs as KeySpec[]);
  }

  /** Ключ, созданный при старте (только вне production). */
  static generate(kid = 'dev'): KeyRing {
    return KeyRing.fromSpecs([{ kid, privateKeyPem: generateSpec() }]);
  }

  private visible(nowMs: number): SigningKey[] {
    return this.keys.filter(
      (key) => key.retiredAt === undefined || nowMs < key.retiredAt + RETIRED_KEY_GRACE_MS,
    );
  }

  sign(claims: AccessClaims): string {
    const key = this.keys.find((k) => k.retiredAt === undefined) as SigningKey;
    const body = `${b64({ alg: 'EdDSA', typ: 'JWT', kid: key.kid })}.${b64(claims)}`;
    return `${body}.${sign(null, Buffer.from(body), key.privateKey).toString('base64url')}`;
  }

  verify(token: string, nowMs: number, expected: { iss: string; aud: string }): JwtResult {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'invalid' };
    const [head = '', payload = '', signature = ''] = parts;
    const header = parseJson(head) as { alg?: unknown; kid?: unknown } | undefined;
    if (header?.alg !== 'EdDSA') return { ok: false, reason: 'invalid' };
    const key = this.visible(nowMs).find((k) => k.kid === header.kid);
    if (!key) return { ok: false, reason: 'invalid' };
    const valid = verify(
      null,
      Buffer.from(`${head}.${payload}`),
      key.publicKey,
      Buffer.from(signature, 'base64url'),
    );
    const claims = parseJson(payload);
    if (!valid || !Value.Check(AccessClaims, claims)) return { ok: false, reason: 'invalid' };
    if (claims.iss !== expected.iss || claims.aud !== expected.aud) {
      return { ok: false, reason: 'invalid' };
    }
    if (Math.floor(nowMs / 1000) >= claims.exp) return { ok: false, reason: 'expired' };
    return { ok: true, claims };
  }

  jwks(nowMs: number): JwkSet {
    return {
      keys: this.visible(nowMs).map((key) => {
        const jwk = key.publicKey.export({ format: 'jwk' });
        return {
          kty: 'OKP' as const,
          crv: 'Ed25519' as const,
          x: String(jwk.x),
          kid: key.kid,
          alg: 'EdDSA' as const,
          use: 'sig' as const,
        };
      }),
    };
  }
}

/** PEM нового закрытого ключа Ed25519 (для CLI и тестов). */
export function generateSpec(): string {
  return generateKeyPairSync('ed25519')
    .privateKey.export({ format: 'pem', type: 'pkcs8' })
    .toString();
}
