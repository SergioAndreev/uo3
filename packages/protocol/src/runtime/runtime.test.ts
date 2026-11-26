import { readFileSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { AnnounceRequest, JoinOptions, RUNTIME_OPCODES, WS_CLOSE } from './index.js';

it('опкоды в диапазоне P06 и уникальны; коды закрытия — из реестра', () => {
  const codes = Object.values(RUNTIME_OPCODES);
  expect(new Set(codes).size).toBe(codes.length);
  for (const code of codes) expect(code >= 0x20 && code <= 0x3f).toBe(true);
  const registry = readFileSync(
    new URL('../../../../docs/PROTOCOL_REGISTRY.md', import.meta.url),
    'utf8',
  );
  for (const [name, code] of Object.entries(WS_CLOSE)) {
    expect(registry, name).toMatch(new RegExp(`\\| \`${code}\` \\| \`WS_CLOSE_${name}\``));
  }
  for (const [name, code] of Object.entries(RUNTIME_OPCODES)) {
    expect(registry, name).toContain(
      `\`0x${code.toString(16).toUpperCase().padStart(4, '0')}\` | \`${name}\``,
    );
  }
});

it('опции подключения и объявление', () => {
  expect(Value.Check(JoinOptions, { ticket: 'A'.repeat(43) })).toBe(true);
  expect(
    Value.Check(JoinOptions, { reconnect: { accountId: 'a', sessionId: 's', token: 't' } }),
  ).toBe(true);
  expect(Value.Check(JoinOptions, {})).toBe(false);
  const ok = {
    severity: 'info',
    displayMode: 'chat',
    text: 'x',
    scope: { kind: 'realm', realm: 'dusk' },
    pinned: false,
    expiresAtMs: null,
  };
  expect(Value.Check(AnnounceRequest, ok)).toBe(true);
  expect(Value.Check(AnnounceRequest, { ...ok, text: '' })).toBe(false);
});
