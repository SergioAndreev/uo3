import { MapSchema, schema, type SchemaType } from '@colyseus/schema';

/** Видимый слот снаряжения: модель и оттенок. */
export const ReplicatedEquip = schema(
  {
    model: 'string',
    tint: 'uint8',
  },
  'ReplicatedEquip',
);

/** Публичная проекция героя или существа: только визуальные поля. */
export const ReplicatedBeing = schema(
  {
    entityId: 'uint32',
    kind: 'string',
    name: 'string',
    model: 'string',
    tint: 'uint8',
    x: 'uint16',
    y: 'uint16',
    h: 'int16',
    direction: 'uint8',
    baseReputation: 'string',
    statusFlags: 'uint16',
    healthPercent: 'uint8',
    mountModel: 'string',
    mountTint: 'uint8',
    equipment: { map: ReplicatedEquip },
  },
  'ReplicatedBeing',
);

/** Предмет на земле. */
export const ReplicatedItem = schema(
  {
    entityId: 'uint32',
    contentKey: 'string',
    tint: 'uint8',
    amount: 'uint16',
    x: 'uint16',
    y: 'uint16',
    h: 'int16',
    directionOrLight: 'uint8',
    flags: 'uint16',
    structureId: 'uint32',
    structureRevision: 'uint16',
  },
  'ReplicatedItem',
);

/** Постройка: прямоугольник клеток и ревизия. */
export const ReplicatedStructure = schema(
  {
    entityId: 'uint32',
    contentKey: 'string',
    minX: 'uint16',
    minY: 'uint16',
    maxX: 'uint16',
    maxY: 'uint16',
    h: 'int16',
    revision: 'uint16',
    flags: 'uint16',
  },
  'ReplicatedStructure',
);

/** Предмет в открытом контейнере — только открывшему. */
export const ReplicatedContainerItem = schema(
  {
    entityId: 'uint32',
    containerId: 'uint32',
    contentKey: 'string',
    tint: 'uint8',
    amount: 'uint16',
    gridX: 'uint8',
    gridY: 'uint8',
    flags: 'uint16',
  },
  'ReplicatedContainerItem',
);

/** Приватное состояние владельца: точные характеристики, ресурсы, отношения к видимым героям. */
export const PrivateHeroState = schema(
  {
    entityId: 'uint32',
    might: 'uint8',
    finesse: 'uint8',
    will: 'uint8',
    health: 'uint16',
    maxHealth: 'uint16',
    verve: 'uint16',
    maxVerve: 'uint16',
    resonance: 'uint16',
    maxResonance: 'uint16',
    weightKg: 'uint16',
    maxWeightKg: 'uint16',
    money: 'uint32',
    defense: 'uint16',
    personalLight: 'uint8',
    offenderRemainingMs: 'uint32',
    outcastKills: 'uint16',
    /** `EntityId` → `ally` | `enemy` | `attackable`. */
    relations: { map: 'string' },
  },
  'PrivateHeroState',
);

/** Корневое состояние комнаты партиции; коллекции фильтруются `StateView`. */
export const PartitionState = schema(
  {
    shardId: 'string',
    partitionId: 'string',
    realm: 'string',
    serverTick: 'uint32',
    onlineCount: 'uint16',
    gameTimeMinutes: 'uint32',
    lightLevel: 'uint8',
    season: 'string',
    protocolVersion: 'string',
    worldVersion: 'string',
    rulesetFingerprint: 'string',
    beings: { map: ReplicatedBeing, view: true },
    items: { map: ReplicatedItem, view: true },
    structures: { map: ReplicatedStructure, view: true },
    containerItems: { map: ReplicatedContainerItem, view: true },
    privates: { map: PrivateHeroState, view: true },
  },
  'PartitionState',
);

/** Состояние хаба: без сущностей мира. */
export const HubState = schema(
  {
    shardId: 'string',
    shardStatus: 'string',
    onlineCount: 'uint16',
    announcement: 'string',
  },
  'HubState',
);

export type ReplicatedBeing = SchemaType<typeof ReplicatedBeing>;
export type ReplicatedItem = SchemaType<typeof ReplicatedItem>;
export type ReplicatedStructure = SchemaType<typeof ReplicatedStructure>;
export type ReplicatedContainerItem = SchemaType<typeof ReplicatedContainerItem>;
export type PrivateHeroState = SchemaType<typeof PrivateHeroState>;
export type PartitionState = SchemaType<typeof PartitionState>;
export type HubState = SchemaType<typeof HubState>;
export { MapSchema };
