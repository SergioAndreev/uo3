import { Type, type Static } from '@sinclair/typebox';

/** Типы критических транзакций; правила операций добавляют фазы-владельцы. */
export const CRITICAL_TX_TYPES = [
  'TRADE_EXCHANGE',
  'BANK_TRANSFER',
  'MERCHANT_BUY',
  'MERCHANT_SELL',
  'STRUCTURE_TRANSFER',
  'STARTER_LOADOUT_GRANT',
  'STAFF_ITEM_GRANT',
  'STAFF_ITEM_MODIFY',
  'STAFF_ITEM_DELETE',
  'ROLLBACK_RESTORE',
] as const;
export type CriticalTxType = (typeof CRITICAL_TX_TYPES)[number];

/** Операции персонала: обязательны исполнитель и обоснование. */
export const STAFF_TX_TYPES: ReadonlySet<CriticalTxType> = new Set([
  'STAFF_ITEM_GRANT',
  'STAFF_ITEM_MODIFY',
  'STAFF_ITEM_DELETE',
  'ROLLBACK_RESTORE',
]);

/** События журнала предметов. */
export const LEDGER_EVENTS = [
  'CREATE',
  'SPLIT',
  'MERGE',
  'TRANSFER',
  'MODIFY',
  'DESTROY',
  'RESTORE',
] as const;
export type LedgerEvent = (typeof LEDGER_EVENTS)[number];

/** Длина обоснования операций персонала. */
export const REASON_MIN = 8;
export const REASON_MAX = 500;
export const Reason = Type.String({ minLength: REASON_MIN, maxLength: REASON_MAX });

const EntityIdParam = Type.Integer({ minimum: 1, maximum: 0xffff_ffff });
const Uuid = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
});
const IsoTime = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$',
});

/** Запрос журнала предметов. */
export const LedgerQuery = Type.Object(
  {
    itemId: Type.Optional(EntityIdParam),
    characterId: Type.Optional(Uuid),
    accountId: Type.Optional(Uuid),
    txId: Type.Optional(Uuid),
    from: Type.Optional(IsoTime),
    to: Type.Optional(IsoTime),
    cursor: Type.Optional(Type.String({ maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  },
  { additionalProperties: false },
);
export type LedgerQuery = Static<typeof LedgerQuery>;

export const FlushRequest = Type.Object(
  { force: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);

export const FlushResult = Type.Object({
  flushId: Type.String(),
  entitiesSaved: Type.Integer({ minimum: 0 }),
  durationMs: Type.Number({ minimum: 0 }),
  checkpointSeq: Type.Integer({ minimum: 0 }),
});
export type FlushResult = Static<typeof FlushResult>;

export const RestorePointRequest = Type.Object(
  { name: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{2,63}$' }), reason: Reason },
  { additionalProperties: false },
);

export const CharacterRollbackPreview = Type.Object(
  {
    characterId: Uuid,
    targetTime: IsoTime,
  },
  { additionalProperties: false },
);

export const CharacterRollbackApply = Type.Object(
  {
    characterId: Uuid,
    previewToken: Type.String({ minLength: 16, maxLength: 256 }),
    kickIfOnline: Type.Boolean(),
    reason: Reason,
  },
  { additionalProperties: false },
);

export const ItemRestoreRequest = Type.Object(
  {
    itemId: EntityIdParam,
    toCharacterId: Uuid,
    mode: Type.Union([
      Type.Literal('strict_no_conflict'),
      Type.Literal('reclaim_original'),
      Type.Literal('reissue_new_id'),
    ]),
    reason: Reason,
  },
  { additionalProperties: false },
);
