import { CHUNK_SIZE } from '@duskmarch/domain';
import { encodeChunk } from '../chunk/index.js';
import { PALETTE } from '../palette/index.js';
import { entryFor, type PackEntry, type PackManifest } from '../pack/index.js';
import { chunkKey, chunkPath, type WorldIndex } from '../world/index.js';
import { modelFiles } from './models.js';
import { fieldWorld, provingWorld, type GeneratedWorld } from './world.js';

export * from './noise.js';
export * from './models.js';
export * from './world.js';

export const GENERATOR_VERSION = 1;
export const SYNTHETIC_PRESETS = ['proving', 'field'] as const;
export type SyntheticPreset = (typeof SYNTHETIC_PRESETS)[number];

export interface SyntheticPack {
  manifest: PackManifest;
  /** Путь → байты, включая `pack.json`. */
  files: Map<string, Uint8Array>;
  world: WorldIndex;
}

const text = (value: unknown): Uint8Array => {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);
  return bytes;
};

/** Синтетический пакет; одинаковые параметры — одинаковые байты всех файлов. */
export function generateSyntheticPack(preset: SyntheticPreset, seed: number): SyntheticPack {
  const { grid, landmarks }: GeneratedWorld =
    preset === 'proving' ? provingWorld() : fieldWorld(seed >>> 0);
  const source = `asset-formats synthetic ${preset} seed ${seed >>> 0} v${GENERATOR_VERSION}`;
  const files = new Map<string, Uint8Array>();
  const entries: PackEntry[] = [];
  const add = (key: string, kind: PackEntry['kind'], path: string, bytes: Uint8Array): void => {
    files.set(path, bytes);
    entries.push(entryFor(key, kind, path, bytes, source));
  };
  add('palette.default', 'palette', 'palette.json', text(PALETTE.map((e) => e.color)));
  for (const model of modelFiles()) add(model.key, 'model', model.path, model.bytes);
  const chunks: WorldIndex['chunks'] = [];
  for (const chunk of grid.toChunks()) {
    const key = chunkKey(grid.realmKey, chunk.cx, chunk.cy);
    const bytes = encodeChunk(chunk);
    add(key, 'chunk', chunkPath(grid.realmKey, chunk.cx, chunk.cy), bytes);
    chunks.push({ cx: chunk.cx, cy: chunk.cy, key, sha256: entries.at(-1)?.sha256 ?? '' });
  }
  const world: WorldIndex = {
    schemaVersion: 1,
    realm: { id: grid.realm, key: grid.realmKey },
    width: grid.width,
    height: grid.height,
    chunkSize: CHUNK_SIZE,
    chunks,
    landmarks,
  };
  add(`world.${grid.realmKey}`, 'world-index', 'world.json', text(world));
  const manifest: PackManifest = {
    schemaVersion: 1,
    id: `pack.synthetic-${preset}`,
    version: '1.0.0',
    entries,
  };
  files.set('pack.json', text(manifest));
  return { manifest, files, world };
}
