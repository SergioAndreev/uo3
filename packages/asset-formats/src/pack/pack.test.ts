import { sha256 } from '@duskmarch/domain';
import { expect, it } from 'vitest';
import {
  PackError,
  PackLoader,
  packFingerprint,
  validateManifest,
  verifyContents,
  type PackManifest,
} from './index.js';

const crate = new Uint8Array([1, 2, 3]);
const manifest = (entries: Partial<PackManifest['entries'][number]>[] = [{}]): PackManifest => ({
  schemaVersion: 1,
  id: 'pack.test',
  version: '1.0.0',
  entries: entries.map((e, i) => ({
    key: `model.test-crate${i || ''}`,
    kind: 'model',
    path: `models/test-crate${i || ''}.glb`,
    sha256: sha256(crate),
    bytes: 3,
    license: 'synthetic-generated',
    source: 'тест',
    ...e,
  })),
});
const codes = (m: unknown) => validateManifest(m).map((i) => i.code);

it('корректный манифест', () => {
  expect(validateManifest(manifest())).toEqual([]);
});

it.each([
  ['audio', 'sounds/bell.wav'],
  ['texture', 'textures/a.jpg'],
  ['chunk', 'chunks/a.bin'],
])('расширение не соответствует виду %s', (kind, path) => {
  expect(validateManifest(manifest([{ kind: kind as 'audio', path }]))).toEqual([
    expect.objectContaining({ code: 'ASSET_KIND_EXTENSION', key: 'model.test-crate' }),
  ]);
});

it('небезопасные пути', () => {
  const paths = ['../secret.glb', '/etc/x.glb', 'a\\b.glb', 'a/./b.glb', 'C:/x.glb', 'a//b.glb'];
  expect(codes(manifest(paths.map((path) => ({ path }))))).toEqual(
    paths.map(() => 'ASSET_PATH_UNSAFE'),
  );
});

it('повторы ключей и путей', () => {
  expect(
    codes(manifest([{}, { key: 'model.test-crate' }, { path: 'models/test-crate.glb' }])),
  ).toEqual(['ASSET_DUPLICATE_KEY', 'ASSET_DUPLICATE_PATH']);
});

it('лицензии и лимиты', () => {
  expect(codes(manifest([{ license: 'CC-BY-4.0' }]))).toEqual(['ASSET_LICENSE']);
  expect(codes(manifest([{ license: 'CC-BY-4.0', attribution: 'Автор, CC BY 4.0' }]))).toEqual([]);
  expect(codes(manifest([{ license: 'GPL-3.0' as 'original' }]))).toEqual(
    expect.arrayContaining(['ASSET_SCHEMA']),
  );
  expect(codes(manifest([{ kind: 'chunk', path: 'c.dmck', bytes: 70_000 }]))).toEqual([
    'ASSET_TOO_LARGE',
  ]);
  expect(codes({ schemaVersion: 2 })).toContain('ASSET_SCHEMA');
});

it('сверка содержимого', async () => {
  const m = manifest([{}, {}, {}]);
  const files = new Map<string, Uint8Array>([
    ['models/test-crate.glb', crate],
    ['models/test-crate1.glb', new Uint8Array([1, 2, 4])],
    ['models/test-crate2.glb', new Uint8Array([1, 2, 3, 4])],
  ]);
  const read = async (path: string) => files.get(path);
  const issues = await verifyContents(m, read, [...files.keys(), 'extra.bin']);
  expect(issues.map((i) => [i.code, i.key ?? null])).toEqual([
    ['ASSET_HASH_MISMATCH', 'model.test-crate1'],
    ['ASSET_SIZE_MISMATCH', 'model.test-crate2'],
    ['ASSET_HASH_MISMATCH', 'model.test-crate2'],
    ['ASSET_UNLISTED', null],
  ]);
  expect(issues.at(-1)?.severity).toBe('warning');
  const missing = await verifyContents(manifest([{ path: 'models/none.glb' }]), read);
  expect(missing.map((i) => i.code)).toEqual(['ASSET_MISSING']);
});

it('отпечаток не зависит от порядка и меняется с хэшем', () => {
  const m = manifest([{}, {}, {}]);
  const reversed = { ...m, entries: [...m.entries].reverse() };
  expect(packFingerprint(reversed)).toBe(packFingerprint(m));
  expect(packFingerprint(m)).toMatch(/^[0-9a-f]{64}$/);
  const changed = {
    ...m,
    entries: m.entries.map((e, i) => (i ? e : { ...e, sha256: '0'.repeat(64) })),
  };
  expect(packFingerprint(changed)).not.toBe(packFingerprint(m));
});

it('загрузчик проверяет хэш', async () => {
  const m = manifest();
  const good = new PackLoader(m, async () => crate);
  expect(await good.load('model.test-crate')).toEqual(crate);
  await expect(
    new PackLoader(m, async () => new Uint8Array([9])).load('model.test-crate'),
  ).rejects.toMatchObject({
    code: 'ASSET_HASH_MISMATCH',
  });
  await expect(
    new PackLoader(m, async () => undefined).load('model.test-crate'),
  ).rejects.toMatchObject({
    code: 'ASSET_MISSING',
  });
  expect(() => good.entry('model.unknown')).toThrow(PackError);
  await expect(good.load('model.unknown')).rejects.toMatchObject({ code: 'ASSET_UNKNOWN_KEY' });
});
