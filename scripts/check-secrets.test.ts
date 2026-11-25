import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { checkSecrets } from './check-secrets.js';

const check = (path: string, text: string): string[] =>
  checkSecrets([{ path, content: Buffer.from(text) }], resolve('.gitleaks.toml'));
// Образцы собираются во время теста, чтобы не попасть в репозиторий.
const body = randomBytes(96).toString('base64');
const pem = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const aws = `AKIA${'Q3EGZT7XWPLM2VNB'}`;

it.each([
  ['private-key', `${pem}\n${body}\n${pem.replace('BEGIN', 'END')}\n`, body],
  ['aws-access-token', `const k = "${aws}";\n`, aws],
  ['uri-password', `DATABASE_URL=postgresql://u:${body.slice(0, 12)}x@h/d\n`, body.slice(0, 12)],
])('блокирует %s и не раскрывает значение', (rule, text, secret) => {
  const errors = check('src/a.ts', text).join('\n');
  expect(errors).toContain(rule);
  expect(errors).not.toContain(secret);
});

it('пропускает заглушку в .env.example', () => {
  const text =
    'IDENTITY_KEY=CHANGE_ME_LOCAL_DEV_ONLY\nA=postgresql://u:CHANGE_ME_LOCAL_DEV_ONLY@h/d\n';
  expect(check('.env.example', text)).toEqual([]);
});
