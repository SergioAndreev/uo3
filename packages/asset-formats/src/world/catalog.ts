import { flagBit } from '@duskmarch/domain';

export type ObjectRole = 'prop' | 'obstacle' | 'platform';
export interface ObjectSpec {
  /** Высота модели в шагах по 0,25 м. */
  height: number;
  role: ObjectRole;
}
export type ObjectCatalog = ReadonlyMap<string, ObjectSpec>;

/** Каталог синтетических моделей P02 (design P03 D3). */
export const SYNTHETIC_CATALOG: ObjectCatalog = new Map<string, ObjectSpec>([
  ['model.test-crate', { height: 3, role: 'platform' }],
  ['model.test-column', { height: 10, role: 'obstacle' }],
  ['model.test-wall', { height: 12, role: 'obstacle' }],
  ['model.test-tree', { height: 13, role: 'obstacle' }],
  ['model.test-dummy', { height: 7, role: 'prop' }],
]);

const IMPASSABLE = flagBit('impassable');
const STANDABLE = flagBit('standable');
const ROOF = flagBit('roof');
const BLOCKS_SIGHT = flagBit('blocks-sight');

/** Свойства объекта с учётом роли модели и флагов в чанке. */
export interface ResolvedObject {
  base: number;
  top: number;
  obstacle: boolean;
  platform: boolean;
  roof: boolean;
  blocksSight: boolean;
}

export function resolveObject(spec: ObjectSpec, h: number, flags: number): ResolvedObject {
  return {
    base: h,
    top: h + spec.height,
    obstacle: spec.role === 'obstacle' || (flags & IMPASSABLE) !== 0,
    platform: spec.role === 'platform' || (flags & STANDABLE) !== 0,
    roof: (flags & ROOF) !== 0,
    blocksSight: (flags & BLOCKS_SIGHT) !== 0,
  };
}
