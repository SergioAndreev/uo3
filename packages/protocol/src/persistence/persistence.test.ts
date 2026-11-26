import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { API_ERRORS } from '../shards/errors.js';
import {
  CRITICAL_TX_TYPES,
  ItemRestoreRequest,
  LedgerQuery,
  PERSIST_ERRORS,
  PersistError,
  RestorePointRequest,
  STAFF_TX_TYPES,
} from './index.js';

describe('protocol/persistence', () => {
  it('коды: префикс, HTTP-статусы, входят в API_ERRORS', () => {
    for (const [code, status] of Object.entries(PERSIST_ERRORS)) {
      expect(code).toMatch(/^PERSIST_[A-Z_]+$/);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(API_ERRORS[code as keyof typeof API_ERRORS]).toBe(status);
    }
    const e = new PersistError('PERSIST_FLUSH_COOLDOWN_ACTIVE', 'охлаждение', {
      retryAfterMs: 3_000,
    });
    expect(e).toMatchObject({
      status: 429,
      code: 'PERSIST_FLUSH_COOLDOWN_ACTIVE',
      details: { retryAfterMs: 3_000 },
    });
  });

  it('типы транзакций и операции персонала', () => {
    for (const t of STAFF_TX_TYPES) expect(CRITICAL_TX_TYPES).toContain(t);
    expect(STAFF_TX_TYPES.has('TRADE_EXCHANGE')).toBe(false);
  });

  it('схемы API: обоснование 8..500, имя точки, режим восстановления', () => {
    expect(
      Value.Check(RestorePointRequest, {
        name: 'pre-p13-release-2026-12-01',
        reason: 'Контрольная точка перед миграцией',
      }),
    ).toBe(true);
    expect(Value.Check(RestorePointRequest, { name: 'X', reason: 'коротко' })).toBe(false);
    expect(
      Value.Check(ItemRestoreRequest, {
        itemId: 0x60008822,
        toCharacterId: '7d0e2a8e-1c7e-4c49-9a5f-2b4a1f0e9d11',
        mode: 'reclaim_original',
        reason: 'Возврат украденного предмета',
      }),
    ).toBe(true);
    expect(
      Value.Check(ItemRestoreRequest, {
        itemId: 1,
        toCharacterId: 'x',
        mode: 'copy',
        reason: 'Возврат предмета',
      }),
    ).toBe(false);
    expect(Value.Check(LedgerQuery, { itemId: 1_610_633_217, limit: 100 })).toBe(true);
    expect(Value.Check(LedgerQuery, { limit: 1_000 })).toBe(false);
  });
});
