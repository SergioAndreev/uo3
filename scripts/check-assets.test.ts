import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { checkAssets, readManifest, type AssetManifest } from './check-assets.js';

const png = (size: number): Buffer => {
  const data = Buffer.alloc(size, 1);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(data);
  return data;
};
const empty = readManifest('.');
const check = (path: string, content: Buffer | string, manifest: AssetManifest = empty) =>
  checkAssets([{ path, content: Buffer.from(content) }], manifest);

it.each([
  ['a/model.fbx', 'text', 'ERR_FORBIDDEN_ASSET_TYPE'],
  ['data.bin', Buffer.from([0, 1]), 'ERR_FORBIDDEN_ASSET_TYPE'],
  ['map.dat', 'x', 'ERR_FORBIDDEN_ASSET_TYPE'],
  ['noext', Buffer.from([0xff, 0xfe, 0x80]), 'ERR_FORBIDDEN_ASSET_TYPE'],
  ['fake.png', Buffer.from('PK\x03\x04'), 'ERR_FORBIDDEN_ASSET_TYPE'],
  ['big.png', png(600 * 1024), 'ERR_BINARY_SIZE_LIMIT'],
  ['new.png', png(100), 'ERR_UNDECLARED_ASSET'],
])('%s → %3$s', (path, content, code) => {
  expect(check(path, content).join()).toContain(code);
});

it.each(['packages/asset-formats/src/chunk.ts', 'packages/rules/src/world/map-patch.ts', 'a.md'])(
  'пропускает исходник %s',
  (path) => expect(check(path, 'текст')).toEqual([]),
);

it('пропускает задекларированный ассет и сверяет хэш', () => {
  const content = png(12 * 1024);
  const manifest = (sha256: string): AssetManifest => ({
    ...empty,
    assets: [{ path: 'a.png', sha256, license: 'CC0-1.0', source: 'test', addedInPhase: 'P02' }],
  });
  const sha = createHash('sha256').update(content).digest('hex');
  expect(check('a.png', content, manifest(sha))).toEqual([]);
  expect(check('a.png', content, manifest('0'.repeat(64)))[0]).toContain('SHA-256');
});
