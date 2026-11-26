import { Type } from '@sinclair/typebox';
import { DomainError } from '../errors/index.js';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EntityKind = 'hero' | 'creature' | 'item' | 'structure' | 'ephemeral';
/** Виды мира; локальные маркеры клиента сюда не входят. */
export type WorldEntityKind = Exclude<EntityKind, 'ephemeral'>;

export type EntityId = Brand<number, 'EntityId'>;
export type HeroId = Brand<EntityId, 'hero'>;
export type CreatureId = Brand<EntityId, 'creature'>;
export type ItemId = Brand<EntityId, 'item'>;
export type StructureId = Brand<EntityId, 'structure'>;
export type EphemeralId = Brand<EntityId, 'ephemeral'>;
export type IdOf<K extends EntityKind> = {
  hero: HeroId;
  creature: CreatureId;
  item: ItemId;
  structure: StructureId;
  ephemeral: EphemeralId;
}[K];

export const KIND_SHIFT = 29;
export const SEQ_MASK = 0x1fffffff;
export const MAX_SEQ = SEQ_MASK;
export const NULL_ENTITY_ID = 0 as EntityId;

export const KIND_CODES: Readonly<Record<EntityKind, number>> = Object.freeze({
  hero: 1,
  creature: 2,
  item: 3,
  structure: 4,
  ephemeral: 7,
});
const KIND_BY_CODE: readonly (EntityKind | undefined)[] = [
  undefined,
  'hero',
  'creature',
  'item',
  'structure',
  undefined,
  undefined,
  'ephemeral',
];
const LETTERS: Readonly<Record<EntityKind, string>> = {
  hero: 'H',
  creature: 'C',
  item: 'I',
  structure: 'S',
  ephemeral: 'E',
};

const isUint32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** Вид по старшим битам или `undefined` для пустого, нулевого номера и резервных кодов. */
export function kindOf(value: number): EntityKind | undefined {
  if (!isUint32(value) || (value & SEQ_MASK) === 0) return undefined;
  return KIND_BY_CODE[value >>> KIND_SHIFT];
}

export const seqOf = (id: EntityId): number => id & SEQ_MASK;
export const isNullEntityId = (value: number): boolean => value === 0;
export const makeEntityId = <K extends EntityKind>(kind: K, seq: number): IdOf<K> => {
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_SEQ) {
    throw new DomainError('ERR_INVALID_ENTITY_ID', `номер ${seq} вне 1..${MAX_SEQ}`);
  }
  return (((KIND_CODES[kind] << KIND_SHIFT) | seq) >>> 0) as IdOf<K>;
};

export function asEntityId(value: number): EntityId {
  if (!isUint32(value)) {
    throw new DomainError('ERR_INVALID_ENTITY_ID', `${value} не uint32`);
  }
  if (value !== 0 && kindOf(value) === undefined) {
    throw new DomainError('ERR_INVALID_ENTITY_ID', `${hex(value)}: резервный вид или номер 0`);
  }
  return value as EntityId;
}

function asKind<K extends EntityKind>(kind: K): (value: number) => IdOf<K> {
  return (value) => {
    const actual = kindOf(asEntityId(value));
    if (actual !== kind) {
      throw new DomainError('ERR_ENTITY_KIND_MISMATCH', `${hex(value)}: ожидался ${kind}`, {
        details: { expected: kind, actual: actual ?? 'null' },
      });
    }
    return value as IdOf<K>;
  };
}
export const asHeroId = asKind('hero');
export const asCreatureId = asKind('creature');
export const asItemId = asKind('item');
export const asStructureId = asKind('structure');
export const asEphemeralId = asKind('ephemeral');

const hex = (value: number): string => (value >>> 0).toString(16).toUpperCase().padStart(8, '0');

/** `I-6000002A`: буква вида и 8 hex-цифр всего значения. */
export function formatEntityId(id: EntityId): string {
  const kind = kindOf(id);
  if (kind === undefined) throw new DomainError('ERR_INVALID_ENTITY_ID', 'пустой идентификатор');
  return `${LETTERS[kind]}-${hex(id)}`;
}

const TEXT = /^([HCISE])-([0-9A-F]{8})$/;
export function parseEntityId(text: string): EntityId {
  const match = TEXT.exec(text);
  if (!match?.[1] || !match[2]) {
    throw new DomainError('ERR_INVALID_ENTITY_ID', `неканоническая форма «${text}»`);
  }
  const id = asEntityId(Number.parseInt(match[2], 16));
  const kind = kindOf(id);
  if (kind === undefined || LETTERS[kind] !== match[1]) {
    throw new DomainError('ERR_INVALID_ENTITY_ID', `буква ${match[1]} не соответствует виду`, {
      details: { kind: kind ?? 'null' },
    });
  }
  return id;
}

/** Идентификатор из JSON: только целое число. */
export const entityIdFromJson = (value: unknown): EntityId => {
  if (typeof value !== 'number') throw new DomainError('ERR_INVALID_ENTITY_ID', 'ожидалось число');
  return asEntityId(value);
};

export function writeEntityId(id: EntityId, target: Uint8Array, offset = 0): void {
  if (target.length - offset < 4) throw new DomainError('ERR_INVALID_ENTITY_ID', 'буфер < 4 байт');
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, id, false);
}

export function readEntityId(source: Uint8Array, offset = 0): EntityId {
  if (source.length - offset < 4) throw new DomainError('ERR_INVALID_ENTITY_ID', 'буфер < 4 байт');
  return asEntityId(
    new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(offset, false),
  );
}

/** Беззнаковый порядок: одинаков на клиенте и сервере. */
export const compareEntityIds = (a: EntityId, b: EntityId): number => (a >>> 0) - (b >>> 0);

export const EntityIdSchema = Type.Integer({ minimum: 0, maximum: 0xffffffff, $id: 'EntityId' });
export const EntityIdTextSchema = Type.String({ pattern: TEXT.source, $id: 'EntityIdText' });
