import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { loadRuleset } from './ruleset.js';

const dir = mkdtempSync(join(tmpdir(), 'duskmarch-ruleset-'));
afterAll(() => rmSync(dir, { recursive: true }));
const file = (name: string, text: string): string => {
  writeFileSync(join(dir, name), text);
  return join(dir, name);
};

it('пресет без файла', () => {
  const result = loadRuleset({ SHARD_RULESET_PRESET: 'proving' });
  expect(result.ok && result.profile.time.gameHourMs).toBe(24_000);
});

it('YAML и JSON переопределения', () => {
  const yaml = loadRuleset({
    SHARD_RULESET_PRESET: 'standard',
    SHARD_RULESET_FILE: file(
      'a.yaml',
      'features:\n  playerBounties: false\nlimits:\n  groundDecayMs: 1800000\n',
    ),
  });
  expect(yaml.ok && yaml.profile.limits.groundDecayMs).toBe(1_800_000);
  const json = loadRuleset({
    SHARD_RULESET_PRESET: 'standard',
    SHARD_RULESET_FILE: file(
      'b.json',
      '{"limits":{"groundDecayMs":1800000},"features":{"playerBounties":false}}',
    ),
  });
  expect(json.ok && yaml.ok && json.fingerprint).toBe(yaml.ok && yaml.fingerprint);
  expect(
    loadRuleset({ SHARD_RULESET_PRESET: 'standard', SHARD_RULESET_FILE: file('e.yml', '') }).ok,
  ).toBe(true);
});

it('нарушения инвариантов с путями полей', () => {
  const result = loadRuleset({
    SHARD_RULESET_PRESET: 'standard',
    SHARD_RULESET_FILE: file('c.yaml', 'movement:\n  runMs: 400\nstats:\n  totalCap: 20\n'),
  });
  expect(result).toEqual({
    ok: false,
    errors: [
      expect.stringMatching(/^\[ERR_RULESET_INVARIANT\] movement\.runMs/),
      expect.stringMatching(/stats\.totalCap/),
    ],
  });
});

it.each([
  ['missing.yaml', undefined, 'не читается'],
  ['d.txt', 'x', 'ожидается .json'],
  ['f.json', '{', 'ошибка разбора'],
  ['g.yaml', 'features: { flying: true }', 'ERR_UNKNOWN_FEATURE_FLAG'],
])('отказ для %s', (name, text, message) => {
  const path = text === undefined ? join(dir, name) : file(name, text);
  const result = loadRuleset({ SHARD_RULESET_PRESET: 'standard', SHARD_RULESET_FILE: path });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.errors.join()).toContain(message);
});
