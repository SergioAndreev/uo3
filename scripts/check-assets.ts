import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { listGitFiles, type GitFile } from './lib/git-files.js';
import { AssetManifestSchema } from './lib/schemas.js';

export type AssetManifest = Static<typeof AssetManifestSchema>;

const ascii = (text: string): Buffer => Buffer.from(text, 'latin1');
const MAGIC: Readonly<Record<string, (head: Buffer) => boolean>> = {
  '.png': (h) => h.subarray(0, 8).equals(ascii('\x89PNG\r\n\x1a\n')),
  '.webp': (h) => h.subarray(0, 4).equals(ascii('RIFF')) && h.subarray(8, 12).equals(ascii('WEBP')),
  '.glb': (h) => h.subarray(0, 4).equals(ascii('glTF')),
  '.ktx2': (h) => h.subarray(0, 12).equals(ascii('\xabKTX 20\xbb\r\n\x1a\n')),
  '.ogg': (h) => h.subarray(0, 4).equals(ascii('OggS')),
  '.woff2': (h) => h.subarray(0, 4).equals(ascii('wOF2')),
};
/** Форматы ассетов и данных, запрещённые независимо от содержимого. */
const FORBIDDEN = new Set([
  '.fbx',
  '.bin',
  '.dat',
  '.blend',
  '.obj',
  '.psd',
  '.zip',
  '.7z',
  '.rar',
]);

/** Нулевой байт или невалидный UTF-8. */
function isBinary(content: Buffer): boolean {
  if (content.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return false;
  } catch {
    return true;
  }
}

export function checkAssets(files: readonly GitFile[], manifest: AssetManifest): string[] {
  const declared = new Map(manifest.assets.map((asset) => [asset.path, asset]));
  return files.flatMap(({ path, content }) => {
    const ext = extname(path).toLowerCase();
    const magic = MAGIC[ext];
    if (!magic && !FORBIDDEN.has(ext) && !isBinary(content)) return [];
    if (!magic) return [`ERR_FORBIDDEN_ASSET_TYPE ${path}: формат вне белого списка (ADR-002)`];
    if (!magic(content.subarray(0, 16))) {
      return [`ERR_FORBIDDEN_ASSET_TYPE ${path}: сигнатура не соответствует ${ext} (ADR-002)`];
    }
    if (content.length > manifest.maxBinaryBytes) {
      return [`ERR_BINARY_SIZE_LIMIT ${path}: ${content.length} > ${manifest.maxBinaryBytes} байт`];
    }
    const entry = declared.get(path);
    if (!entry) return [`ERR_UNDECLARED_ASSET ${path}: нет записи в assets/ASSET_MANIFEST.json`];
    const sha256 = createHash('sha256').update(content).digest('hex');
    return sha256 === entry.sha256 ? [] : [`ERR_UNDECLARED_ASSET ${path}: SHA-256 не совпадает`];
  });
}

export function readManifest(root: string): AssetManifest {
  const raw: unknown = JSON.parse(readFileSync(join(root, 'assets/ASSET_MANIFEST.json'), 'utf8'));
  if (!Value.Check(AssetManifestSchema, raw)) {
    throw new Error('assets/ASSET_MANIFEST.json не соответствует схеме');
  }
  return raw;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve('.');
  const files = listGitFiles(root, process.argv.includes('--staged'));
  const errors = checkAssets(files, readManifest(root));
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log(`Ассеты: проверено файлов ${files.length}`);
}
