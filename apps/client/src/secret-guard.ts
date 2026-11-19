export const FORBIDDEN_BUNDLE_PATTERNS: readonly RegExp[] = [
  /IDENTITY_JWT_SIGNING_KEYS_JSON/,
  /DATABASE_URL/,
  /VALKEY_URL/,
  /NATS_URL/,
  /PG_PASSWORD/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function scanBundleTextForSecrets(code: string): string | null {
  for (const pattern of FORBIDDEN_BUNDLE_PATTERNS) {
    if (pattern.test(code)) {
      return pattern.source;
    }
  }
  return null;
}
