import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CONTENT_KEY_PATTERN, canonicalJson, sha256 } from '@duskmarch/domain';
import { error, warning, type Issue } from '../util/issues.js';

export const ASSET_KINDS = [
  'model',
  'texture',
  'audio',
  'palette',
  'chunk',
  'world-index',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'original', 'synthetic-generated'] as const;

const MIB = 1024 * 1024;
export const EXTENSIONS: Readonly<Record<AssetKind, readonly string[]>> = {
  model: ['.glb'],
  texture: ['.ktx2', '.png', '.webp'],
  audio: ['.ogg'],
  palette: ['.json'],
  chunk: ['.dmck'],
  'world-index': ['.json'],
};
export const SIZE_LIMITS: Readonly<Record<AssetKind, number>> = {
  model: 8 * MIB,
  texture: 8 * MIB,
  audio: 8 * MIB,
  palette: MIB,
  chunk: 64 * 1024,
  'world-index': MIB,
};

export const PackEntrySchema = Type.Object(
  {
    key: Type.String({ pattern: CONTENT_KEY_PATTERN.source }),
    kind: Type.Union(ASSET_KINDS.map((k) => Type.Literal(k))),
    path: Type.String({ minLength: 1 }),
    sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
    bytes: Type.Integer({ minimum: 0 }),
    license: Type.Union(LICENSES.map((l) => Type.Literal(l))),
    attribution: Type.Optional(Type.String({ minLength: 1 })),
    source: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export const PackManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    id: Type.String({ pattern: '^pack\\.[a-z0-9-]+$' }),
    version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$' }),
    entries: Type.Array(PackEntrySchema),
  },
  { additionalProperties: false },
);
export type PackEntry = Static<typeof PackEntrySchema>;
export type PackManifest = Static<typeof PackManifestSchema>;

const extOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot).toLowerCase();
};

export const isSafePath = (path: string): boolean =>
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !/^[a-zA-Z]:/.test(path) &&
  path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

/** Проверка манифеста без чтения файлов. */
export function validateManifest(value: unknown): Issue[] {
  if (!Value.Check(PackManifestSchema, value)) {
    return [...Value.Errors(PackManifestSchema, value)].map((e) =>
      error('ASSET_SCHEMA', `${e.path}: ${e.message}`),
    );
  }
  const issues: Issue[] = [];
  const keys = new Set<string>();
  const paths = new Set<string>();
  for (const entry of value.entries) {
    const { key, kind, path, license } = entry;
    if (!isSafePath(path))
      issues.push(error('ASSET_PATH_UNSAFE', `путь «${path}» небезопасен`, key));
    if (!EXTENSIONS[kind].includes(extOf(path))) {
      issues.push(
        error('ASSET_KIND_EXTENSION', `${kind}: ожидается ${EXTENSIONS[kind].join(', ')}`, key),
      );
    }
    if (keys.has(key)) issues.push(error('ASSET_DUPLICATE_KEY', `ключ ${key} повторяется`, key));
    if (paths.has(path))
      issues.push(error('ASSET_DUPLICATE_PATH', `путь ${path} повторяется`, key));
    keys.add(key);
    paths.add(path);
    if (license === 'CC-BY-4.0' && !entry.attribution) {
      issues.push(error('ASSET_LICENSE', 'CC-BY-4.0 требует поля attribution', key));
    }
    if (entry.bytes > SIZE_LIMITS[kind]) {
      issues.push(error('ASSET_TOO_LARGE', `${entry.bytes} байт > ${SIZE_LIMITS[kind]}`, key));
    }
  }
  return issues;
}

export type ReadFile = (path: string) => Promise<Uint8Array | undefined>;

/** Сверка файлов с манифестом; `listed` — все файлы каталога пакета кроме `pack.json`. */
export async function verifyContents(
  manifest: PackManifest,
  read: ReadFile,
  listed: readonly string[] = [],
): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const entry of manifest.entries) {
    const bytes = await read(entry.path);
    if (!bytes) {
      issues.push(error('ASSET_MISSING', `нет файла ${entry.path}`, entry.key));
      continue;
    }
    if (bytes.length !== entry.bytes) {
      issues.push(
        error(
          'ASSET_SIZE_MISMATCH',
          `размер ${bytes.length}, в манифесте ${entry.bytes}`,
          entry.key,
        ),
      );
    }
    const actual = sha256(bytes);
    if (actual !== entry.sha256) {
      issues.push(
        error('ASSET_HASH_MISMATCH', `ожидался ${entry.sha256}, получен ${actual}`, entry.key),
      );
    }
  }
  const known = new Set(manifest.entries.map((e) => e.path));
  for (const path of listed) {
    if (!known.has(path))
      issues.push(warning('ASSET_UNLISTED', `файл ${path} не указан в манифесте`));
  }
  return issues;
}

/** SHA-256 канонического JSON из id, версии и записей по ключу. */
export function packFingerprint(manifest: PackManifest): string {
  const entries = [...manifest.entries]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(({ key, kind, sha256: hash, bytes }) => ({ key, kind, sha256: hash, bytes }));
  return sha256(canonicalJson({ id: manifest.id, version: manifest.version, entries }));
}

export class PackError extends Error {
  override readonly name = 'PackError';
  constructor(
    readonly code: 'ASSET_UNKNOWN_KEY' | 'ASSET_HASH_MISMATCH' | 'ASSET_MISSING',
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** Изоморфный загрузчик: байты выдаются только после сверки SHA-256. */
export class PackLoader {
  private readonly byKey: Map<string, PackEntry>;

  constructor(
    readonly manifest: PackManifest,
    private readonly read: ReadFile,
  ) {
    this.byKey = new Map(manifest.entries.map((e) => [e.key, e]));
  }

  entry(key: string): PackEntry {
    const entry = this.byKey.get(key);
    if (!entry) throw new PackError('ASSET_UNKNOWN_KEY', `ключ ${key} не найден`);
    return entry;
  }

  async load(key: string): Promise<Uint8Array> {
    const entry = this.entry(key);
    const bytes = await this.read(entry.path);
    if (!bytes) throw new PackError('ASSET_MISSING', `нет файла ${entry.path}`);
    if (sha256(bytes) !== entry.sha256)
      throw new PackError('ASSET_HASH_MISMATCH', `${key}: хэш не совпадает`);
    return bytes;
  }
}

/** Запись манифеста для байтов файла. */
export const entryFor = (
  key: string,
  kind: AssetKind,
  path: string,
  bytes: Uint8Array,
  source: string,
  license: PackEntry['license'] = 'synthetic-generated',
): PackEntry => ({ key, kind, path, sha256: sha256(bytes), bytes: bytes.length, license, source });

export type { Issue } from '../util/issues.js';
