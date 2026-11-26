import { createCipheriv, createDecipheriv } from 'node:crypto';
import type { Entropy } from './random.js';

export interface Sealed {
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: string;
}

/** AES-256-GCM с версиями ключей; AAD привязывает шифротекст к владельцу. */
export class SecretBox {
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(
    keys: Readonly<Record<string, string | Buffer>>,
    private readonly current: string,
    private readonly entropy: Entropy,
  ) {
    const map = new Map<string, Buffer>();
    for (const [version, key] of Object.entries(keys)) {
      const bytes = typeof key === 'string' ? Buffer.from(key, 'base64') : key;
      if (bytes.length !== 32) throw new Error(`ключ TOTP ${version}: нужно 32 байта`);
      map.set(version, bytes);
    }
    if (!map.has(current)) throw new Error(`нет ключа TOTP версии ${current}`);
    this.keys = map;
  }

  /** Разбор `IDENTITY_TOTP_KEYS_JSON`. */
  static fromJson(json: string, current: string, entropy: Entropy): SecretBox {
    return new SecretBox(JSON.parse(json) as Record<string, string>, current, entropy);
  }

  seal(plain: Buffer, aad: string): Sealed {
    const iv = this.entropy.bytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current) as Buffer, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.current,
    };
  }

  /** Бросает исключение при неверном ключе, AAD или подмене. */
  open(sealed: Sealed, aad: string): Buffer {
    const key = this.keys.get(sealed.keyVersion);
    if (!key) throw new Error(`нет ключа TOTP версии ${sealed.keyVersion}`);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }
}
