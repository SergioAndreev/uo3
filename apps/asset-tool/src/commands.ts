import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  CELLS_PER_CHUNK,
  ChunkFormatError,
  decodeChunk,
  generateSyntheticPack,
  packFingerprint,
  validateManifest,
  validateWorldIndex,
  verifyContents,
  type Issue,
  type PackManifest,
  type SyntheticPreset,
  type WorldIndex,
} from '@duskmarch/asset-formats';
import { CELL_FLAGS, CHUNK_SIZE, SURFACES } from '@duskmarch/domain';
import { encodePng } from './png.js';

export class UsageError extends Error {}

export interface CommandResult {
  ok: boolean;
  /** Строки вывода без `--json`. */
  lines: string[];
  data: Record<string, unknown>;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8')) as unknown;

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

const readFile = (root: string) => async (path: string) => {
  const file = join(root, path);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
};

function loadManifest(dir: string): PackManifest {
  const file = join(dir, 'pack.json');
  if (!existsSync(file)) throw new UsageError(`нет файла ${file}`);
  return readJson(file) as PackManifest;
}

const format = (issue: Issue): string =>
  `${issue.severity === 'error' ? 'ОШИБКА' : 'ВНИМАНИЕ'} ${issue.code}${issue.key ? ` [${issue.key}]` : ''}: ${issue.message}`;

export async function validatePack(dir: string): Promise<CommandResult> {
  const manifest = loadManifest(dir);
  const issues = validateManifest(manifest);
  if (issues.length === 0) {
    const listed = listFiles(dir).filter((p) => p !== 'pack.json');
    issues.push(...(await verifyContents(manifest, readFile(dir), listed)));
    for (const entry of manifest.entries) {
      const file = join(dir, entry.path);
      if (!existsSync(file) || issues.some((i) => i.key === entry.key && i.severity === 'error'))
        continue;
      if (entry.kind === 'chunk') {
        try {
          decodeChunk(new Uint8Array(readFileSync(file)));
        } catch (error) {
          if (!(error instanceof ChunkFormatError)) throw error;
          issues.push({
            code: error.code,
            severity: 'error',
            message: error.message,
            key: entry.key,
          });
        }
      }
      if (entry.kind === 'world-index') {
        issues.push(...validateWorldIndex(readJson(file)).map((i) => ({ ...i, key: entry.key })));
      }
    }
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  return {
    ok: errors === 0,
    lines: [
      ...issues.map(format),
      errors === 0
        ? `Пакет ${manifest.id} корректен: записей ${manifest.entries.length}`
        : `Ошибок: ${errors}`,
    ],
    data: { id: manifest.id, entries: manifest.entries.length, issues },
  };
}

export function inspectChunk(file: string): CommandResult {
  if (!existsSync(file)) throw new UsageError(`нет файла ${file}`);
  const chunk = decodeChunk(new Uint8Array(readFileSync(file)));
  const surfaces: Record<string, number> = {};
  const flags: Record<string, number> = {};
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < CELLS_PER_CHUNK; i++) {
    const s = SURFACES[chunk.surfaces[i] ?? 0] ?? 'void';
    surfaces[s] = (surfaces[s] ?? 0) + 1;
    CELL_FLAGS.forEach((name, bit) => {
      if (((chunk.flags[i] ?? 0) >>> bit) & 1) flags[name] = (flags[name] ?? 0) + 1;
    });
    min = Math.min(min, chunk.heights[i] ?? 0);
    max = Math.max(max, chunk.heights[i] ?? 0);
  }
  const data = {
    realm: chunk.realm,
    cx: chunk.cx,
    cy: chunk.cy,
    cells: CELLS_PER_CHUNK,
    surfaces,
    flags,
    heights: { min, max },
    objects: chunk.objects,
  };
  return {
    ok: true,
    lines: [
      `Чанк (${chunk.cx}, ${chunk.cy}) плана ${chunk.realm}: клеток ${CELLS_PER_CHUNK}, объектов ${chunk.objects.length}`,
      `Высоты: ${min}..${max}`,
      `Поверхности: ${Object.entries(surfaces)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
      `Флаги: ${
        Object.entries(flags)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'нет'
      }`,
    ],
    data,
  };
}

export function generateWorld(
  preset: string,
  seed: number,
  out: string,
  force: boolean,
): CommandResult {
  if (preset !== 'proving' && preset !== 'field')
    throw new UsageError(`пресет ${preset}: ожидается proving или field`);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new UsageError(`сид ${seed}: ожидается целое 0..4294967295`);
  if (existsSync(out) && readdirSync(out).length > 0 && !force) {
    return {
      ok: false,
      lines: [`Каталог ${out} не пуст: добавьте --force`],
      data: { error: 'not-empty', out },
    };
  }
  const pack = generateSyntheticPack(preset as SyntheticPreset, seed);
  for (const [path, bytes] of pack.files) {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
  const fingerprint = packFingerprint(pack.manifest);
  return {
    ok: true,
    lines: [
      `Создан пакет ${pack.manifest.id} в ${out}: файлов ${pack.files.size}`,
      `Отпечаток: ${fingerprint}`,
    ],
    data: { id: pack.manifest.id, out, files: pack.files.size, fingerprint },
  };
}

/** Цвета поверхностей превью: собственная схема, не связанная с палитрой оттенков. */
const SURFACE_RGB: Record<string, [number, number, number]> = {
  soil: [120, 92, 60],
  grass: [92, 140, 70],
  sand: [214, 190, 130],
  stone: [130, 130, 136],
  snow: [236, 240, 246],
  ice: [190, 220, 240],
  ash: [70, 66, 70],
  moss: [80, 110, 80],
  'shallow-water': [70, 130, 190],
  'deep-water': [30, 60, 130],
  void: [0, 0, 0],
};

export function radar(dir: string, out: string): CommandResult {
  const manifest = loadManifest(dir);
  const worldEntry = manifest.entries.find((e) => e.kind === 'world-index');
  if (!worldEntry) throw new UsageError('в пакете нет индекса мира');
  const world = readJson(join(dir, worldEntry.path)) as WorldIndex;
  const paths = new Map(manifest.entries.map((e) => [e.key, e.path]));
  const rgb = new Uint8Array(world.width * world.height * 3);
  for (const ref of world.chunks) {
    const chunk = decodeChunk(new Uint8Array(readFileSync(join(dir, paths.get(ref.key) ?? ''))));
    for (let i = 0; i < CELLS_PER_CHUNK; i++) {
      const x = ref.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const y = ref.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      const base = SURFACE_RGB[SURFACES[chunk.surfaces[i] ?? 0] ?? 'void'] ?? [0, 0, 0];
      const shade = Math.max(60, Math.min(140, 100 + (chunk.heights[i] ?? 0)));
      base.forEach((c, k) => {
        rgb[(y * world.width + x) * 3 + k] = Math.min(255, Math.round((c * shade) / 100));
      });
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng(world.width, world.height, rgb));
  return {
    ok: true,
    lines: [`Превью ${world.width}×${world.height} записано в ${out}`],
    data: { out, width: world.width, height: world.height },
  };
}

export function fingerprint(dir: string): CommandResult {
  const manifest = loadManifest(dir);
  const value = packFingerprint(manifest);
  return { ok: true, lines: [value], data: { id: manifest.id, fingerprint: value } };
}
