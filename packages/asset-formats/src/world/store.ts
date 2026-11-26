import {
  CHUNK_SIZE,
  canonicalJson,
  flagBit,
  sha256,
  stepOffset,
  type Direction,
} from '@duskmarch/domain';
import { decodeChunk, encodeChunk, ChunkFormatError, type Chunk } from '../chunk/index.js';
import { resolveObject, type ObjectCatalog, type ResolvedObject } from './catalog.js';
import { WorldError } from './errors.js';
import { validateManifest, type PackManifest } from '../pack/index.js';
import { validateWorldIndex, type WorldIndex } from './world-index.js';

const STANDABLE = flagBit('standable');
const IMPASSABLE = flagBit('impassable');

/** Чанк с объектами, разложенными по клеткам. */
export interface LoadedChunk {
  chunk: Chunk;
  hash: string;
  /** `start[i]..start[i+1]` — объекты клетки `i` в `objects`. */
  start: Uint16Array;
  objects: ResolvedObject[];
}

export function indexChunk(
  chunk: Chunk,
  catalog: ObjectCatalog,
  hash = sha256(encodeChunk(chunk)),
): LoadedChunk {
  const cells = CHUNK_SIZE * CHUNK_SIZE;
  const counts = new Uint16Array(cells + 1);
  const resolved = chunk.objects.map((o) => {
    const spec = catalog.get(o.key);
    if (!spec) {
      throw new WorldError(
        'WORLD_UNKNOWN_OBJECT',
        `${o.key} в (${chunk.cx * CHUNK_SIZE + o.lx}, ${chunk.cy * CHUNK_SIZE + o.ly})`,
        {
          key: o.key,
          x: chunk.cx * CHUNK_SIZE + o.lx,
          y: chunk.cy * CHUNK_SIZE + o.ly,
        },
      );
    }
    const cell = o.ly * CHUNK_SIZE + o.lx;
    counts[cell + 1] = (counts[cell + 1] ?? 0) + 1;
    return { cell, object: resolveObject(spec, o.h, o.flags) };
  });
  for (let i = 0; i < cells; i++) counts[i + 1] = (counts[i + 1] ?? 0) + (counts[i] ?? 0);
  const objects: ResolvedObject[] = new Array<ResolvedObject>(resolved.length);
  const fill = counts.slice();
  for (const { cell, object } of resolved) objects[fill[cell]!++] = object;
  return { chunk, hash, start: counts, objects };
}

export interface PlaceOptions {
  height: number;
}
export interface StepOptions extends PlaceOptions {
  climb: number;
}
export type StepFailure = 'out-of-realm' | 'no-surface' | 'too-high' | 'blocked' | 'corner';
export type StepResult =
  { ok: true; x: number; y: number; h: number } | { ok: false; reason: StepFailure };

export interface CellView {
  surface: number;
  tint: number;
  h: number;
  flags: number;
}

/** План в памяти. Изоморфен; параметры героя передаёт вызывающий код. */
export class RealmStore {
  readonly cols: number;
  readonly rows: number;
  protected chunks: LoadedChunk[];

  constructor(
    readonly realm: { id: number; key: string },
    readonly width: number,
    readonly height: number,
    chunks: LoadedChunk[],
    readonly catalog: ObjectCatalog,
  ) {
    this.cols = width / CHUNK_SIZE;
    this.rows = height / CHUNK_SIZE;
    this.chunks = chunks;
  }

  /** Загрузка из индекса мира и байтов чанков по ключу. */
  static load(
    index: WorldIndex,
    files: ReadonlyMap<string, Uint8Array>,
    catalog: ObjectCatalog,
  ): RealmStore {
    const issues = validateWorldIndex(index);
    if (issues.length > 0)
      throw new WorldError(
        issues[0]?.code ?? 'WORLD_SCHEMA',
        issues.map((i) => i.message).join('; '),
      );
    const cols = index.width / CHUNK_SIZE;
    const chunks: LoadedChunk[] = new Array<LoadedChunk>(cols * (index.height / CHUNK_SIZE));
    for (const ref of index.chunks) {
      const bytes = files.get(ref.key);
      if (!bytes)
        throw new WorldError('WORLD_CHUNK_MISSING', `нет чанка ${ref.key}`, { key: ref.key });
      const hash = sha256(bytes);
      if (hash !== ref.sha256)
        throw new WorldError('WORLD_CHUNK_HASH', `${ref.key}: хэш не совпадает`, { key: ref.key });
      let chunk: Chunk;
      try {
        chunk = decodeChunk(bytes);
      } catch (error) {
        if (error instanceof ChunkFormatError)
          throw new WorldError(error.code, `${ref.key}: ${error.message}`, { key: ref.key });
        throw error;
      }
      chunks[ref.cy * cols + ref.cx] = indexChunk(chunk, catalog, hash);
    }
    return new RealmStore(index.realm, index.width, index.height, chunks, catalog);
  }

  /** Загрузка из пакета: синхронное чтение файла по пути внутри пакета. */
  static fromPack(
    manifest: PackManifest,
    read: (path: string) => Uint8Array | undefined,
    catalog: ObjectCatalog,
  ): RealmStore {
    const issues = validateManifest(manifest);
    if (issues.length > 0)
      throw new WorldError(
        issues[0]?.code ?? 'ASSET_SCHEMA',
        issues.map((i) => i.message).join('; '),
      );
    const worldEntry = manifest.entries.find((e) => e.kind === 'world-index');
    const worldBytes = worldEntry && read(worldEntry.path);
    if (!worldBytes) throw new WorldError('WORLD_SCHEMA', 'в пакете нет индекса мира');
    const index = JSON.parse(String.fromCharCode(...worldBytes)) as WorldIndex;
    const paths = new Map(manifest.entries.map((e) => [e.key, e.path]));
    const files = new Map<string, Uint8Array>();
    for (const ref of index.chunks) {
      const bytes = read(paths.get(ref.key) ?? '');
      if (bytes) files.set(ref.key, bytes);
    }
    return RealmStore.load(index, files, catalog);
  }

  /** SHA-256 канонического JSON плана и хэшей чанков в порядке (cy, cx). */
  version(): string {
    return sha256(canonicalJson({ realm: this.realm.key, chunks: this.chunks.map((c) => c.hash) }));
  }

  chunkHashes(): { cx: number; cy: number; hash: string }[] {
    return this.chunks.map((c, i) => ({
      cx: i % this.cols,
      cy: Math.floor(i / this.cols),
      hash: c.hash,
    }));
  }

  /** Загруженный чанк по координатам чанка. */
  chunkAt(cx: number, cy: number): LoadedChunk | undefined {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return undefined;
    return this.chunks[cy * this.cols + cx];
  }

  /** Замена чанков одним присваиванием: чтения видят старый или новый план целиком. */
  commit(replacements: ReadonlyMap<number, LoadedChunk>): void {
    const next = this.chunks.slice();
    for (const [index, loaded] of replacements) next[index] = loaded;
    this.chunks = next;
  }

  inside(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  protected at(x: number, y: number): { loaded: LoadedChunk; i: number } {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    return {
      loaded: this.chunks[cy * this.cols + cx] as LoadedChunk,
      i: (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE),
    };
  }

  cell(x: number, y: number): CellView | undefined {
    if (!this.inside(x, y)) return undefined;
    const { loaded, i } = this.at(x, y);
    const c = loaded.chunk;
    return {
      surface: c.surfaces[i] ?? 0,
      tint: c.tints[i] ?? 0,
      h: c.heights[i] ?? 0,
      flags: c.flags[i] ?? 0,
    };
  }

  /** Объекты клетки (без копирования массива объектов чанка). */
  objectsAt(x: number, y: number): readonly ResolvedObject[] {
    if (!this.inside(x, y)) return [];
    const { loaded, i } = this.at(x, y);
    return loaded.objects.slice(loaded.start[i], loaded.start[i + 1]);
  }

  /** Опоры по возрастанию: пол клетки при `standable` и вершины платформ. */
  surfaces(x: number, y: number): number[] {
    const cell = this.cell(x, y);
    if (!cell) return [];
    const out = (cell.flags & STANDABLE) !== 0 ? [cell.h] : [];
    for (const o of this.objectsAt(x, y)) if (o.platform) out.push(o.top);
    return [...new Set(out)].sort((a, b) => a - b);
  }

  /** Наименьшее основание препятствия или потолка строго выше `h`. */
  ceiling(x: number, y: number, h: number): number | undefined {
    let best: number | undefined;
    for (const o of this.objectsAt(x, y)) {
      if (
        (o.obstacle || o.roof || o.platform) &&
        o.base > h &&
        (best === undefined || o.base < best)
      )
        best = o.base;
    }
    return best;
  }

  /** Есть ли на высоте `h` опора, свободный объём и достаточный потолок. */
  canPlace(x: number, y: number, h: number, { height }: PlaceOptions): boolean {
    const cell = this.cell(x, y);
    if (!cell || (cell.flags & IMPASSABLE) !== 0) return false;
    if (!this.surfaces(x, y).includes(h)) return false;
    for (const o of this.objectsAt(x, y)) {
      if (o.obstacle && o.base < h + height && o.top > h) return false;
    }
    const ceiling = this.ceiling(x, y, h);
    return ceiling === undefined || ceiling >= h + height;
  }

  /** Непроходима ли клетка на высоте `h` для сущности ростом `height` (для правила углов). */
  blocksAt(x: number, y: number, h: number, height: number): boolean {
    const cell = this.cell(x, y);
    if (!cell || (cell.flags & IMPASSABLE) !== 0) return true;
    return this.objectsAt(x, y).some((o) => o.obstacle && o.base < h + height && o.top > h);
  }

  step(
    from: { x: number; y: number; h: number },
    dir: Direction,
    { height, climb }: StepOptions,
  ): StepResult {
    const { dx, dy } = stepOffset(dir);
    const x = from.x + dx;
    const y = from.y + dy;
    if (!this.inside(x, y)) return { ok: false, reason: 'out-of-realm' };
    const surfaces = this.surfaces(x, y);
    if (surfaces.length === 0) return { ok: false, reason: 'no-surface' };
    const reachable = surfaces.filter((s) => s <= from.h + climb);
    if (reachable.length === 0) return { ok: false, reason: 'too-high' };
    const target = [...reachable].reverse().find((s) => this.canPlace(x, y, s, { height }));
    if (target === undefined) return { ok: false, reason: 'blocked' };
    if (dx !== 0 && dy !== 0) {
      const h = Math.max(from.h, target);
      if (
        this.blocksAt(from.x + dx, from.y, h, height) ||
        this.blocksAt(from.x, from.y + dy, h, height)
      ) {
        return { ok: false, reason: 'corner' };
      }
    }
    return { ok: true, x, y, h: target };
  }
}
