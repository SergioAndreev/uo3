import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { IDENTITY_ERRORS } from '../identity/errors.js';
import { PERSIST_ERRORS } from '../persistence/errors.js';
import {
  API_ERRORS,
  CharacterCreateRequest,
  SHARD_ERRORS,
  ShardCreateRequest,
  ShardUpdateRequest,
  TicketPayload,
  TicketRequest,
} from './index.js';

describe('контракты P05', () => {
  it('коды ошибок: префиксы, без пересечения с identity', () => {
    for (const [code, status] of Object.entries(SHARD_ERRORS)) {
      expect(code).toMatch(/^(SHARD|TICKET|CHAR|IDEMPOTENCY|ACCOUNT)_[A-Z_]+$/);
      expect(code in IDENTITY_ERRORS).toBe(false);
      expect([400, 401, 403, 404, 409, 410, 426, 429, 503]).toContain(status);
    }
    expect(Object.keys(API_ERRORS)).toHaveLength(
      Object.keys(IDENTITY_ERRORS).length +
        Object.keys(SHARD_ERRORS).length +
        Object.keys(PERSIST_ERRORS).length,
    );
  });

  it('шард: создание и частичное изменение', () => {
    expect(
      Value.Check(ShardCreateRequest, {
        id: 'ember',
        name: 'Угли',
        region: 'eu',
        preset: 'standard',
      }),
    ).toBe(true);
    expect(
      Value.Check(ShardCreateRequest, { id: 'Ember', name: 'x', region: 'eu', preset: 'standard' }),
    ).toBe(false);
    expect(
      Value.Check(ShardCreateRequest, {
        id: 'ember',
        name: 'x',
        region: 'eu',
        preset: 'standard',
        characterSlots: 8,
      }),
    ).toBe(false);
    expect(Value.Check(ShardUpdateRequest, { characterSlots: 3 })).toBe(true);
    expect(Value.Check(ShardUpdateRequest, { id: 'x' })).toBe(false);
  });

  it('создание героя', () => {
    const ok = {
      name: 'Ясна',
      background: 'resonant',
      appearance: {
        build: 'average',
        face: 3,
        hairStyle: 5,
        beard: 0,
        skinTint: 10,
        hairTint: 200,
      },
      startCity: 'lad',
    };
    expect(Value.Check(CharacterCreateRequest, ok)).toBe(true);
    expect(
      Value.Check(CharacterCreateRequest, { ...ok, appearance: { ...ok.appearance, face: 9 } }),
    ).toBe(false);
    expect(Value.Check(CharacterCreateRequest, { ...ok, x: 1 })).toBe(false);
  });

  it('билеты', () => {
    expect(
      Value.Check(TicketRequest, { characterId: '0190f0a1-0000-7000-8000-000000000000' }),
    ).toBe(true);
    expect(Value.Check(TicketRequest, { characterId: 'x' })).toBe(false);
    const payload = {
      bundleId: 'b',
      shardId: 'ember',
      roomType: 'world',
      roomId: 'r',
      accountId: 'a',
      characterId: 'c',
      entityId: 1,
      name: 'Ясна',
      accessLevel: 'player',
      effectiveLevel: 'player',
      realm: 'dawn',
      x: 1,
      y: 2,
      h: 0,
      purpose: 'initial_login',
      takeover: false,
      issuedAt: 0,
      expiresAt: 30_000,
    };
    expect(Value.Check(TicketPayload, payload)).toBe(true);
    expect(Value.Check(TicketPayload, { ...payload, roomType: 'lobby' })).toBe(false);
  });
});
