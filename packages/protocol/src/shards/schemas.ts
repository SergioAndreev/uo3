import { Type, type Static } from '@sinclair/typebox';
import { AccessLevelSchema, IsoTime } from '../identity/schemas.js';

const Slug = Type.String({ minLength: 2, maxLength: 32, pattern: '^[a-z][a-z0-9-]*$' });
const strict = { additionalProperties: false } as const;
const Int = (minimum: number, maximum: number) => Type.Integer({ minimum, maximum });

export const ShardVisibility = Type.Union([
  Type.Literal('public'),
  Type.Literal('unlisted'),
  Type.Literal('staff'),
]);
export const ShardManualStatus = Type.Union([
  Type.Literal('normal'),
  Type.Literal('maintenance'),
  Type.Literal('draining'),
]);
export const ShardStatus = Type.Union(
  ['online', 'degraded', 'offline', 'maintenance', 'draining', 'unknown'].map((s) =>
    Type.Literal(s),
  ),
);
export const LoadLevel = Type.Union(
  ['low', 'medium', 'high', 'full', 'unknown'].map((s) => Type.Literal(s)),
);
export const RenamePolicy = Type.Union([
  Type.Literal('free'),
  Type.Literal('cooldown'),
  Type.Literal('disabled'),
]);

/** Создание шарда администратором. */
export const ShardCreateRequest = Type.Object(
  {
    id: Slug,
    name: Type.String({ minLength: 1, maxLength: 64 }),
    region: Type.String({ minLength: 1, maxLength: 32 }),
    preset: Type.Union([Type.Literal('standard'), Type.Literal('proving')]),
    rulesetOverride: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    visibility: Type.Optional(ShardVisibility),
    creationOpen: Type.Optional(Type.Boolean()),
    characterSlots: Type.Optional(Int(1, 7)),
    renamePolicy: Type.Optional(RenamePolicy),
    ticketTtlS: Type.Optional(Int(10, 60)),
    softCapacity: Type.Optional(Int(1, 100_000)),
    hardCapacity: Type.Optional(Int(1, 100_000)),
    staffBuffer: Type.Optional(Int(0, 10_000)),
    protocolRange: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    startCities: Type.Optional(Type.Array(Slug, { minItems: 1, maxItems: 16 })),
    sortOrder: Type.Optional(Int(0, 10_000)),
  },
  strict,
);
export const ShardUpdateRequest = Type.Partial(Type.Omit(ShardCreateRequest, ['id']), strict);
export const ShardStatusRequest = Type.Object(
  {
    status: ShardManualStatus,
    etaAt: Type.Optional(IsoTime),
    message: Type.Optional(Type.String({ maxLength: 500 })),
  },
  strict,
);

/** Требование шарда к пакету ассетов: идентификатор `pack.<имя>` и минимальная версия. */
export const AssetPackRequirement = Type.Object(
  {
    id: Type.String({ pattern: '^pack\\.[a-z0-9-]+$', maxLength: 64 }),
    minVersion: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$', maxLength: 32 }),
  },
  strict,
);

export const ShardSummary = Type.Object({
  id: Type.String(),
  name: Type.String(),
  region: Type.String(),
  preset: Type.String(),
  realms: Type.Array(Type.Object({ key: Type.String(), name: Type.String(), pvp: Type.String() })),
  characterSlots: Type.Integer(),
  status: ShardStatus,
  load: LoadLevel,
  onlineCount: Type.Union([Type.Integer(), Type.Null()]),
  protocolRange: Type.String(),
  compatible: Type.Optional(Type.Boolean()),
  myCharacters: Type.Optional(Type.Integer()),
  canEnter: Type.Optional(Type.Boolean()),
  entryBlockedReason: Type.Optional(Type.String()),
  /** Требование к пакету ассетов P02 (P09). */
  assetPack: Type.Optional(AssetPackRequirement),
});

export const StatsSchema = Type.Object(
  { might: Type.Integer(), finesse: Type.Integer(), will: Type.Integer() },
  strict,
);
export const SkillPickSchema = Type.Object(
  { skill: Type.String({ pattern: '^[a-z]+$', maxLength: 32 }), tenths: Type.Integer() },
  strict,
);
export const AppearanceSchema = Type.Object(
  {
    build: Type.Union([Type.Literal('lean'), Type.Literal('average'), Type.Literal('sturdy')]),
    face: Int(0, 7),
    hairStyle: Int(0, 11),
    beard: Int(0, 5),
    skinTint: Int(0, 255),
    hairTint: Int(0, 255),
  },
  strict,
);

export const CharacterCreateRequest = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 64 }),
    background: Type.Optional(Type.String({ maxLength: 32 })),
    stats: Type.Optional(StatsSchema),
    skills: Type.Optional(Type.Array(SkillPickSchema, { maxItems: 8 })),
    appearance: AppearanceSchema,
    startCity: Type.String({ maxLength: 32 }),
  },
  strict,
);
export const NameRequest = Type.Object(
  { name: Type.String({ minLength: 1, maxLength: 64 }) },
  strict,
);
export const DeleteCharacterRequest = Type.Object(
  { confirmName: Type.String({ maxLength: 64 }) },
  strict,
);
export const StaffReasonRequest = Type.Object({ reason: Type.String({ maxLength: 2000 }) }, strict);

export const TicketPurpose = Type.Union([
  Type.Literal('initial_login'),
  Type.Literal('partition_handoff'),
  Type.Literal('realm_transfer'),
]);
export const TicketRequest = Type.Object(
  {
    characterId: Type.String({ pattern: '^[0-9a-f-]{36}$' }),
    purpose: Type.Optional(TicketPurpose),
    takeover: Type.Optional(Type.Boolean()),
  },
  strict,
);

export const RoomType = Type.Union([Type.Literal('world'), Type.Literal('hub')]);

/** Полезная нагрузка билета в Valkey; игровой сервер получает её при погашении. */
export const TicketPayload = Type.Object({
  bundleId: Type.String(),
  shardId: Type.String(),
  roomType: RoomType,
  roomId: Type.String(),
  accountId: Type.String(),
  characterId: Type.String(),
  entityId: Type.Integer(),
  name: Type.String(),
  accessLevel: AccessLevelSchema,
  effectiveLevel: AccessLevelSchema,
  realm: Type.String(),
  x: Type.Integer(),
  y: Type.Integer(),
  h: Type.Integer(),
  purpose: TicketPurpose,
  takeover: Type.Boolean(),
  issuedAt: Type.Integer(),
  expiresAt: Type.Integer(),
});
export type TicketPayload = Static<typeof TicketPayload>;

export const TicketBundle = Type.Object({
  bundleId: Type.String(),
  world: Type.Object({ ticket: Type.String(), roomId: Type.String(), wsUrl: Type.String() }),
  hub: Type.Object({ ticket: Type.String(), roomId: Type.String(), wsUrl: Type.String() }),
  expiresAt: IsoTime,
});
