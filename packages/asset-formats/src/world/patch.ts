import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  CELL_FLAGS,
  CHUNK_SIZE,
  NO_FLAGS,
  SURFACES,
  listFlags,
  withFlags,
  type CellFlags,
} from '@duskmarch/domain';
import {
  ChunkFormatError,
  encodeChunk,
  type Chunk,
  type ChunkObject,
  type Rotation,
} from '../chunk/index.js';
import { WorldError } from './errors.js';
import { indexChunk, type LoadedChunk, type RealmStore } from './store.js';
import { sha256 } from '@duskmarch/domain';

const Int = Type.Integer();
const Flags = Type.Array(Type.Union(CELL_FLAGS.map((f) => Type.Literal(f))));
const Surface = Type.Union(SURFACES.map((s) => Type.Literal(s)));
const CellFields = {
  surface: Type.Optional(Surface),
  h: Type.Optional(Int),
  flags: Type.Optional(Flags),
  tint: Type.Optional(Int),
};
const strict = { additionalProperties: false } as const;
export const PatchOpSchema = Type.Union([
  Type.Object({ op: Type.Literal('set-cell'), x: Int, y: Int, ...CellFields }, strict),
  Type.Object(
    { op: Type.Literal('fill'), x: Int, y: Int, width: Int, height: Int, ...CellFields },
    strict,
  ),
  Type.Object(
    {
      op: Type.Literal('add-object'),
      key: Type.String(),
      x: Int,
      y: Int,
      h: Int,
      rotation: Type.Optional(Int),
      tint: Type.Optional(Int),
      flags: Type.Optional(Flags),
    },
    strict,
  ),
  Type.Object(
    { op: Type.Literal('remove-object'), key: Type.String(), x: Int, y: Int, h: Int },
    strict,
  ),
]);
export const WorldPatchSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    base: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    ops: Type.Array(PatchOpSchema),
  },
  strict,
);
export type PatchOp = Static<typeof PatchOpSchema>;
export type WorldPatch = Static<typeof WorldPatchSchema>;

export interface PatchResult {
  version: string;
  /** Ключ чанка `cx,cy` → новые байты DMCK. */
  chunks: Map<string, Uint8Array>;
  inverse: WorldPatch;
}

const cloneChunk = (c: Chunk): Chunk => ({
  ...c,
  surfaces: c.surfaces.slice(),
  tints: c.tints.slice(),
  heights: c.heights.slice(),
  flags: c.flags.slice(),
  objects: c.objects.map((o) => ({ ...o })),
});

const invalid = (index: number, message: string): never => {
  throw new WorldError('PATCH_INVALID', `операция ${index}: ${message}`, { op: index });
};

/** Применение патча: всё или ничего (design P03 D8). */
export function applyPatch(store: RealmStore, patch: unknown): PatchResult {
  if (!Value.Check(WorldPatchSchema, patch)) {
    const first = [...Value.Errors(WorldPatchSchema, patch)][0];
    const op = Number(/^\/ops\/(\d+)/.exec(first?.path ?? '')?.[1] ?? -1);
    throw new WorldError('PATCH_INVALID', `${first?.path}: ${first?.message}`, { op });
  }
  const before = store.version();
  if (patch.base !== before)
    throw new WorldError('PATCH_BASE_MISMATCH', `база ${patch.base} ≠ ${before}`);
  const copies = new Map<number, Chunk>();
  const inverseCells = new Map<string, PatchOp>();
  const inverseObjects: PatchOp[] = [];
  const chunkFor = (x: number, y: number, index: number): { chunk: Chunk; i: number } => {
    if (!store.inside(x, y)) invalid(index, `клетка (${x}, ${y}) вне плана`);
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const key = cy * store.cols + cx;
    let chunk = copies.get(key);
    if (!chunk) {
      chunk = cloneChunk((store.chunkAt(cx, cy) as LoadedChunk).chunk);
      copies.set(key, chunk);
    }
    return { chunk, i: (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE) };
  };
  const setCell = (
    x: number,
    y: number,
    fields: Partial<Record<'surface' | 'h' | 'flags' | 'tint', unknown>>,
    index: number,
  ): void => {
    const { chunk, i } = chunkFor(x, y, index);
    const id = `${x},${y}`;
    if (!inverseCells.has(id)) {
      inverseCells.set(id, {
        op: 'set-cell',
        x,
        y,
        surface: SURFACES[chunk.surfaces[i] ?? 0] ?? 'void',
        h: chunk.heights[i] ?? 0,
        flags: listFlags((chunk.flags[i] ?? 0) as CellFlags),
        tint: chunk.tints[i] ?? 0,
      });
    }
    if (fields.surface !== undefined)
      chunk.surfaces[i] = SURFACES.indexOf(fields.surface as (typeof SURFACES)[number]);
    if (fields.h !== undefined) {
      const h = fields.h as number;
      if (h < -1024 || h > 1023) invalid(index, `высота ${h}`);
      chunk.heights[i] = h;
    }
    if (fields.flags !== undefined)
      chunk.flags[i] = withFlags(NO_FLAGS, ...(fields.flags as (typeof CELL_FLAGS)[number][]));
    if (fields.tint !== undefined) {
      const tint = fields.tint as number;
      if (tint < 0 || tint > 255) invalid(index, `оттенок ${tint}`);
      chunk.tints[i] = tint;
    }
  };
  patch.ops.forEach((op, index) => {
    switch (op.op) {
      case 'set-cell':
        setCell(op.x, op.y, op, index);
        break;
      case 'fill':
        if (op.width < 1 || op.height < 1) invalid(index, 'пустой прямоугольник');
        for (let y = op.y; y < op.y + op.height; y++)
          for (let x = op.x; x < op.x + op.width; x++) setCell(x, y, op, index);
        break;
      case 'add-object': {
        if (!store.catalog.has(op.key)) invalid(index, `модель ${op.key} не в каталоге`);
        const { chunk } = chunkFor(op.x, op.y, index);
        const object: ChunkObject = {
          key: op.key,
          lx: op.x % CHUNK_SIZE,
          ly: op.y % CHUNK_SIZE,
          h: op.h,
          rotation: (op.rotation ?? 0) as Rotation,
          tint: op.tint ?? 0,
          flags: withFlags(NO_FLAGS, ...(op.flags ?? [])),
        };
        chunk.objects.push(object);
        inverseObjects.unshift({ op: 'remove-object', key: op.key, x: op.x, y: op.y, h: op.h });
        break;
      }
      case 'remove-object': {
        const { chunk } = chunkFor(op.x, op.y, index);
        const at = chunk.objects.findIndex(
          (o) =>
            o.key === op.key &&
            o.lx === op.x % CHUNK_SIZE &&
            o.ly === op.y % CHUNK_SIZE &&
            o.h === op.h,
        );
        if (at < 0) {
          throw new WorldError(
            'PATCH_CONFLICT',
            `операция ${index}: нет объекта ${op.key} в (${op.x}, ${op.y}, ${op.h})`,
            {
              op: index,
            },
          );
        }
        const [removed] = chunk.objects.splice(at, 1);
        if (removed) {
          inverseObjects.unshift({
            op: 'add-object',
            key: removed.key,
            x: op.x,
            y: op.y,
            h: removed.h,
            rotation: removed.rotation,
            tint: removed.tint,
            flags: listFlags(removed.flags as CellFlags),
          });
        }
        break;
      }
    }
  });
  const replacements = new Map<number, LoadedChunk>();
  const bytes = new Map<string, Uint8Array>();
  for (const [key, chunk] of copies) {
    let encoded: Uint8Array;
    try {
      encoded = encodeChunk(chunk);
    } catch (error) {
      if (error instanceof ChunkFormatError) throw new WorldError('PATCH_INVALID', error.message);
      throw error;
    }
    replacements.set(key, indexChunk(chunk, store.catalog, sha256(encoded)));
    bytes.set(`${chunk.cx},${chunk.cy}`, encoded);
  }
  store.commit(replacements);
  const version = store.version();
  return {
    version,
    chunks: bytes,
    inverse: {
      id: `${patch.id}.inverse`,
      base: version,
      ops: [...inverseObjects, ...inverseCells.values()],
    },
  };
}
