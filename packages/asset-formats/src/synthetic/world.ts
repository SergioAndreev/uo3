import {
  CHUNK_SIZE,
  DAWN,
  NO_FLAGS,
  PROVING,
  SURFACES,
  withFlags,
  type CellFlag,
  type CellFlags,
  type Surface,
} from '@duskmarch/domain';
import { emptyChunk, type Chunk, type ChunkObject } from '../chunk/index.js';
import { valueNoise } from './noise.js';

/** Изменяемая карта плана в памяти; режется на чанки при сборке. */
export class WorldGrid {
  readonly surfaces: Uint8Array;
  readonly heights: Int16Array;
  readonly flags: Uint32Array;
  readonly objects: (ChunkObject & { x: number; y: number })[] = [];

  constructor(
    readonly realm: number,
    readonly realmKey: string,
    readonly width: number,
    readonly height: number,
  ) {
    const size = width * height;
    this.surfaces = new Uint8Array(size);
    this.heights = new Int16Array(size);
    this.flags = new Uint32Array(size);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  set(x: number, y: number, surface: Surface, h: number, ...flags: CellFlag[]): void {
    const i = this.index(x, y);
    this.surfaces[i] = SURFACES.indexOf(surface);
    this.heights[i] = h;
    this.flags[i] = withFlags(NO_FLAGS, ...flags);
  }

  fill(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    surface: Surface,
    h: number,
    ...flags: CellFlag[]
  ): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) this.set(x, y, surface, h, ...flags);
  }

  place(
    key: string,
    x: number,
    y: number,
    h: number,
    flags: CellFlag[] = [],
    rotation: 0 | 1 | 2 | 3 = 0,
  ): void {
    const local = { lx: x % CHUNK_SIZE, ly: y % CHUNK_SIZE };
    this.objects.push({
      key,
      x,
      y,
      ...local,
      h,
      rotation,
      tint: 0,
      flags: withFlags(NO_FLAGS as CellFlags, ...flags),
    });
  }

  toChunks(): Chunk[] {
    const chunks: Chunk[] = [];
    for (let cy = 0; cy < this.height / CHUNK_SIZE; cy++) {
      for (let cx = 0; cx < this.width / CHUNK_SIZE; cx++) {
        const chunk = emptyChunk(this.realm, cx, cy);
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const i = this.index(cx * CHUNK_SIZE + lx, cy * CHUNK_SIZE + ly);
            const j = ly * CHUNK_SIZE + lx;
            chunk.surfaces[j] = this.surfaces[i] ?? 0;
            chunk.heights[j] = this.heights[i] ?? 0;
            chunk.flags[j] = this.flags[i] ?? 0;
          }
        }
        chunk.objects = this.objects
          .filter((o) => Math.floor(o.x / CHUNK_SIZE) === cx && Math.floor(o.y / CHUNK_SIZE) === cy)
          .map((o) => ({
            key: o.key,
            lx: o.lx,
            ly: o.ly,
            h: o.h,
            rotation: o.rotation,
            tint: o.tint,
            flags: o.flags,
          }));
        chunks.push(chunk);
      }
    }
    return chunks;
  }
}

export type Landmarks = Record<string, { x: number; y: number }[]>;
export interface GeneratedWorld {
  grid: WorldGrid;
  landmarks: Landmarks;
}

const cells = (x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};

/** План `proving`: испытательные стенды по таблице design.md. */
export function provingWorld(): GeneratedWorld {
  const g = new WorldGrid(PROVING, 'proving', 64, 64);
  g.fill(0, 0, 63, 63, 'grass', 0, 'standable');
  [0, 2, 4, 6, 8].forEach((h, i) => g.set(4 + i, 4, 'stone', h, 'standable'));
  for (let x = 12; x <= 14; x++) g.place('model.test-crate', x, 4, 6, ['roof']);
  for (let y = 2; y <= 10; y++) {
    if (y === 6) continue;
    g.set(20, y, 'stone', 0, 'impassable', 'blocks-sight');
    g.place('model.test-wall', 20, y, 0, ['impassable', 'blocks-sight'], 1);
  }
  g.set(20, 12, 'stone', 0, 'door', 'standable');
  g.fill(40, 4, 47, 11, 'shallow-water', -1, 'water', 'standable');
  g.fill(48, 4, 55, 11, 'deep-water', -8, 'water', 'deep');
  g.fill(8, 40, 11, 43, 'stone', 0, 'shelter', 'standable');
  g.fill(40, 40, 43, 43, 'ash', 0, 'hazard', 'standable');
  g.place('model.test-dummy', 32, 34, 0);
  g.place('model.test-column', 30, 30, 0, ['impassable']);
  return {
    grid: g,
    landmarks: {
      spawn: [{ x: 32, y: 32 }],
      stairs: cells(4, 4, 8, 4),
      'low-ceiling': cells(12, 4, 14, 4),
      'wall-window': [...cells(20, 2, 20, 5), ...cells(20, 7, 20, 10)],
      'wall-opening': [{ x: 20, y: 6 }],
      door: [{ x: 20, y: 12 }],
      'shallow-water': cells(40, 4, 47, 11),
      'deep-water': cells(48, 4, 55, 11),
      shelter: cells(8, 40, 11, 43),
      hazard: cells(40, 40, 43, 43),
    },
  };
}

export const MAX_LAND_STEP = 2;

/** Ограничивает перепад соседних клеток: `h ≤ min(h соседа) + step`, до устойчивости. */
export function limitSlopes(
  heights: Int16Array,
  width: number,
  height: number,
  step = MAX_LAND_STEP,
): void {
  for (let changed = true; changed;) {
    changed = false;
    for (const forward of [true, false]) {
      for (let k = 0; k < width * height; k++) {
        const i = forward ? k : width * height - 1 - k;
        const x = i % width;
        const y = (i - x) / width;
        let limit = heights[i] ?? 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height) {
              limit = Math.min(limit, (heights[ny * width + nx] ?? 0) + step);
            }
          }
        }
        if (limit < (heights[i] ?? 0)) {
          heights[i] = limit;
          changed = true;
        }
      }
    }
  }
}

/** План `dawn` 256×256 с рельефом из шума. */
export function fieldWorld(seed: number): GeneratedWorld {
  const size = 256;
  const g = new WorldGrid(DAWN, 'dawn', size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      g.heights[g.index(x, y)] = Math.round((valueNoise(seed, x, y, 96) - 0.42) * 140);
    }
  }
  limitSlopes(g.heights, size, size);
  const forest = (seed ^ 0x5bd1e995) >>> 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = g.heights[g.index(x, y)] ?? 0;
      if (h < -6) g.set(x, y, 'deep-water', h, 'water', 'deep');
      else if (h < 0) g.set(x, y, 'shallow-water', h, 'water', 'standable');
      else if (h < 3) g.set(x, y, 'sand', h, 'standable');
      else if (h < 24) {
        g.set(x, y, 'grass', h, 'standable');
        if (valueNoise(forest, x, y, 24, 2) > 0.62 && (x * 7 + y * 13) % 5 === 0) {
          g.place('model.test-tree', x, y, h, ['impassable']);
        }
      } else if (h < 36) g.set(x, y, 'stone', h, 'standable');
      else g.set(x, y, 'snow', h, 'standable');
    }
  }
  const center = size / 2;
  g.set(center, center, 'grass', g.heights[g.index(center, center)] ?? 0, 'standable');
  return { grid: g, landmarks: { spawn: [{ x: center, y: center }] } };
}
