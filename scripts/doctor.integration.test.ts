import { expect, it } from 'vitest';
import { checkNetwork, doctor, report } from './doctor.js';
import { readRootEnv } from './lib/env-files.js';

it('здоровый стенд проходит все проверки', async () => {
  const { text, code } = report(await doctor('.'));
  expect(text).not.toContain('FAIL');
  expect(code).toBe(0);
}, 60_000);

it('отказ одного Valkey не скрывает остальные', async () => {
  const results = await checkNetwork({ ...readRootEnv('.'), VALKEY_PORT: '1' });
  expect(results.map((r) => r.ok)).toEqual([true, false, true]);
}, 30_000);
