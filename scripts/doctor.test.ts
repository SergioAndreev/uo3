import { expect, it } from 'vitest';
import { checkEnvFiles, checkNetwork, report } from './doctor.js';

it('недоступный Valkey даёт FAIL, адрес и команду', async () => {
  const results = await checkNetwork({ VALKEY_PORT: '1', NATS_PORT: '1' });
  const { text, code } = report(results);
  expect(code).toBe(1);
  expect(text).toMatch(/FAIL {2}Valkey 127\.0\.0\.1:1\n\s+docker compose .* valkey/);
});

it('сообщает об отсутствующих .env', () => {
  expect(checkEnvFiles('/nonexistent').every((r) => !r.ok)).toBe(true);
});

it('успешный отчёт имеет код 0', () => {
  expect(report([{ name: 'a', ok: true, hint: '' }])).toEqual({ text: 'PASS  a', code: 0 });
});
