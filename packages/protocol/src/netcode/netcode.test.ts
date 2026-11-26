import { readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  BASE_CATALOG,
  BASE_INTENTS,
  CmdError,
  NETCODE_ERRORS,
  NETCODE_OPCODES,
  SessionHello,
  TimePing,
  buildCatalog,
  checkIntent,
  defineIntent,
  sane,
} from './index.js';

const hex = 'a'.repeat(64);

describe('опкоды и ошибки P07', () => {
  it('опкоды в блоке P07 и в реестре', () => {
    const registry = readFileSync(
      new URL('../../../../docs/PROTOCOL_REGISTRY.md', import.meta.url),
      'utf8',
    );
    for (const [name, code] of Object.entries(NETCODE_OPCODES)) {
      expect(code >= 1 && code <= 0x1f).toBe(true);
      expect(registry, name).toContain(
        `\`0x${code.toString(16).toUpperCase().padStart(4, '0')}\` | \`${name}\``,
      );
    }
    const codes = Object.values(NETCODE_ERRORS).map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const name of Object.keys(NETCODE_ERRORS))
      expect(name).toMatch(/^(PROTO|CMD|NET)_[A-Z_]+$/);
  });

  it('схемы рукопожатия, зонда и ошибки', () => {
    expect(
      Value.Check(SessionHello, {
        protocolVersion: '1.2.4',
        rulesetFingerprint: hex,
        worldVersion: hex,
      }),
    ).toBe(true);
    expect(
      Value.Check(SessionHello, {
        protocolVersion: 'latest',
        rulesetFingerprint: hex,
        worldVersion: hex,
      }),
    ).toBe(false);
    expect(Value.Check(TimePing, { seq: 1, clientSendMs: 10.5 })).toBe(true);
    expect(
      Value.Check(CmdError, {
        requestId: 771,
        opcode: 0x0125,
        error: 'CMD_TARGET_NOT_FOUND',
        code: 2008,
        retryable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(CmdError, {
        requestId: null,
        opcode: null,
        error: 'NOPE',
        code: 1,
        retryable: false,
      }),
    ).toBe(false);
  });
});

describe('каталог намерений', () => {
  it('сборка: блок фазы, уникальность, формат имени', () => {
    const base = {
      room: 'world' as const,
      rate: 'world' as const,
      minLevel: 'player' as const,
      states: ['alive' as const],
      schema: Type.Object({}),
    };
    expect(() =>
      buildCatalog([defineIntent({ ...base, name: 'x.bad', phase: 'P13', opcode: 0x0100 })]),
    ).toThrow('вне блока P13');
    expect(() =>
      buildCatalog([
        defineIntent({ ...base, name: 'x.a', phase: 'P13', opcode: 0x0120 }),
        defineIntent({ ...base, name: 'x.b', phase: 'P13', opcode: 0x0120 }),
      ]),
    ).toThrow('опкод уже занят');
    expect(() =>
      buildCatalog([
        defineIntent({ ...base, name: 'x.a', phase: 'P13', opcode: 0x0120 }),
        defineIntent({ ...base, name: 'x.a', phase: 'P13', opcode: 0x0121 }),
      ]),
    ).toThrow('имя уже занято');
    expect(() =>
      buildCatalog([defineIntent({ ...base, name: 'Bad', phase: 'P13', opcode: 0x0120 })]),
    ).toThrow('namespace.action');
    expect(BASE_CATALOG.byName.size).toBe(BASE_INTENTS.length);
  });

  it('неизвестный опкод, не та комната, лишнее поле, строковый id, размер фрейма', () => {
    expect(checkIntent(BASE_CATALOG, 0x9999, {}, 'world', 10)).toEqual({
      ok: false,
      error: 'PROTO_UNKNOWN_OPCODE',
    });
    expect(checkIntent(BASE_CATALOG, 0x0100, { seq: 1, direction: 2 }, 'hub', 10)).toEqual({
      ok: false,
      error: 'PROTO_WRONG_ROOM_TYPE',
    });
    expect(
      checkIntent(BASE_CATALOG, 0x02f0, { channel: 'общий', text: 'привет' }, 'world', 10),
    ).toEqual({ ok: false, error: 'PROTO_WRONG_ROOM_TYPE' });
    const extra = checkIntent(BASE_CATALOG, 0x0126, { targetId: 5, forceOpen: true }, 'world', 10);
    expect(extra).toMatchObject({
      ok: false,
      error: 'PROTO_INVALID_PAYLOAD',
      details: { paths: expect.any(Array) },
    });
    expect(checkIntent(BASE_CATALOG, 0x0126, { targetId: '5' }, 'world', 10)).toMatchObject({
      ok: false,
      error: 'PROTO_INVALID_PAYLOAD',
    });
    expect(checkIntent(BASE_CATALOG, 0x0126, { targetId: 5 }, 'world', 24_576)).toEqual({
      ok: false,
      error: 'PROTO_FRAME_TOO_LARGE',
    });
    expect(
      checkIntent(
        BASE_CATALOG,
        0x0151,
        { panelId: 1, button: 0, fields: { a: 'я'.repeat(4_000) } },
        'world',
        32_768,
      ).ok,
    ).toBe(true);
    expect(checkIntent(BASE_CATALOG, 0x0151, { panelId: 1, button: 0 }, 'world', 70_000)).toEqual({
      ok: false,
      error: 'PROTO_FRAME_TOO_LARGE',
    });
    expect(checkIntent(BASE_CATALOG, 0x0360, { command: 'go', args: [] }, 'hub', 10).ok).toBe(true);
  });

  it('исходы симуляции не принимаются; валидное намерение проходит', () => {
    expect(
      checkIntent(BASE_CATALOG, 0x01a1, { targetId: 7, damage: 999 }, 'world', 10),
    ).toMatchObject({ error: 'PROTO_INVALID_PAYLOAD' });
    expect(
      checkIntent(BASE_CATALOG, 0x01a1, { targetId: 7, bypassLos: true }, 'world', 10),
    ).toMatchObject({ error: 'PROTO_INVALID_PAYLOAD' });
    expect(checkIntent(BASE_CATALOG, 0x0126, { targetId: 1_610_617_396 }, 'world', 10).ok).toBe(
      true,
    );
  });

  it('инварианты шага: seq 0..255, направление с битом бега', () => {
    expect(checkIntent(BASE_CATALOG, 0x0100, { seq: 42, direction: 0x82 }, 'world', 10).ok).toBe(
      true,
    );
    expect(
      checkIntent(BASE_CATALOG, 0x0100, { seq: 256, direction: 2 }, 'world', 10),
    ).toMatchObject({ error: 'PROTO_INVALID_PAYLOAD' });
    expect(
      checkIntent(BASE_CATALOG, 0x0100, { seq: 1, direction: 0x40 }, 'world', 10),
    ).toMatchObject({ error: 'PROTO_INVALID_PAYLOAD' });
    expect(checkIntent(BASE_CATALOG, 0x0100, { seq: 1, direction: 8 }, 'world', 10)).toMatchObject({
      error: 'PROTO_INVALID_PAYLOAD',
    });
  });

  it('NaN, Infinity и глубина вложенности', () => {
    expect(sane({ a: Number.NaN })).toBe(false);
    expect(sane({ a: Infinity })).toBe(false);
    expect(sane({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toBe(false);
    expect(sane({ a: [1, { b: 2 }] })).toBe(true);
    expect(checkIntent(BASE_CATALOG, 0x0126, { targetId: Infinity }, 'world', 10)).toMatchObject({
      error: 'PROTO_INVALID_PAYLOAD',
    });
    expect(checkIntent(BASE_CATALOG, 0x01f0, { tones: ['heat'] }, 'world', 10)).toMatchObject({
      error: 'PROTO_INVALID_PAYLOAD',
    });
    expect(checkIntent(BASE_CATALOG, 0x01f0, { tones: ['heat', 'light'] }, 'world', 10).ok).toBe(
      true,
    );
  });
});
