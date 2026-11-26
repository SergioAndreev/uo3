import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RealmStore,
  SYNTHETIC_CATALOG,
  WorldError,
  generateSyntheticPack,
  type PackManifest,
} from '@duskmarch/asset-formats';

export interface WorldConfig {
  NODE_ENV: string;
  WORLD_PACK_DIR?: string | undefined;
}

export type WorldResult =
  | { ok: true; store: RealmStore; version: string; source: string }
  | { ok: false; errors: string[] };

function fromDirectory(dir: string): RealmStore {
  const manifestFile = join(dir, 'pack.json');
  if (!existsSync(manifestFile)) throw new WorldError('WORLD_SCHEMA', `нет ${manifestFile}`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as PackManifest;
  const read = (path: string): Uint8Array | undefined => {
    const file = join(dir, path);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
  };
  return RealmStore.fromPack(manifest, read, SYNTHETIC_CATALOG);
}

function synthetic(): RealmStore {
  const pack = generateSyntheticPack('proving', 42);
  return RealmStore.fromPack(pack.manifest, (path) => pack.files.get(path), SYNTHETIC_CATALOG);
}

/** Мир шарда: пакет из `WORLD_PACK_DIR` или синтетический `proving` вне production (design P03 D9). */
export function loadWorld(config: WorldConfig): WorldResult {
  try {
    if (config.WORLD_PACK_DIR) {
      const store = fromDirectory(config.WORLD_PACK_DIR);
      return { ok: true, store, version: store.version(), source: config.WORLD_PACK_DIR };
    }
    if (config.NODE_ENV === 'production') {
      return {
        ok: false,
        errors: ['[CONFIG_VALIDATION_FAILED] WORLD_PACK_DIR: обязателен в production'],
      };
    }
    const store = synthetic();
    return { ok: true, store, version: store.version(), source: 'synthetic:proving' };
  } catch (error) {
    const code = error instanceof WorldError ? `[${error.code}] ` : '';
    return { ok: false, errors: [`${code}${(error as Error).message}`] };
  }
}
