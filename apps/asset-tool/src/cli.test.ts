import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { chunkKey, crc32, packFingerprint } from '@duskmarch/asset-formats';
import { afterAll, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

const root = mkdtempSync(join(tmpdir(), 'duskmarch-asset-tool-'));
afterAll(() => rmSync(root, { recursive: true }));

const run = async (...args: string[]) => {
  const log = vi.fn();
  const code = await runCli(args, log);
  const output = log.mock.calls.map((c) => String(c[0])).join('\n');
  return { code, output, json: () => JSON.parse(output) as Record<string, unknown> };
};

it('--version, справка и коды вызова', async () => {
  expect((await run('--version')).output).toContain('asset-tool 0.0.0');
  expect((await run('--help')).code).toBe(0);
  const unknown = await run('unpack');
  expect(unknown.code).toBe(2);
  expect(unknown.output).toContain('validate-pack');
  expect((await run()).code).toBe(2);
  expect((await run('validate-pack')).code).toBe(2);
  expect((await run('generate-world', '--preset')).code).toBe(2);
  expect((await run('generate-world', '--preset', 'moon', '--out', join(root, 'x'))).code).toBe(2);
  expect((await run('validate-pack', join(root, 'none'), '--json')).json()).toMatchObject({
    ok: false,
  });
});

it('check-env принимает значения по умолчанию', async () => {
  expect(await runCli(['check-env'], vi.fn())).toBe(0);
});

it('невалидное окружение завершается кодом 78', () => {
  const result = spawnSync(
    resolve('node_modules/.bin/tsx'),
    [resolve('src/index.ts'), 'check-env'],
    {
      cwd: '/',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'], LOG_LEVEL: 'loud' },
    },
  );
  expect(result.status).toBe(78);
  expect(result.stderr).toContain('LOG_LEVEL');
});

it('генерация, проверка, инспекция, превью и отпечаток', async () => {
  const out = join(root, 'proving');
  const generated = await run(
    'generate-world',
    '--preset',
    'proving',
    '--seed',
    '42',
    '--out',
    out,
    '--json',
  );
  expect(generated.code).toBe(0);
  const marker = join(out, 'pack.json');
  const before = readFileSync(marker);
  const again = await run('generate-world', '--preset', 'proving', '--out', out);
  expect(again.code).toBe(1);
  expect(readFileSync(marker)).toEqual(before);
  expect((await run('generate-world', '--preset', 'proving', '--out', out, '--force')).code).toBe(
    0,
  );

  const valid = await run('validate-pack', out);
  expect(valid.code).toBe(0);
  expect(valid.output).toContain('корректен');

  const inspect = await run('inspect-chunk', join(out, 'chunks/proving/0_0.dmck'), '--json');
  const data = inspect.json();
  expect(data).toMatchObject({ cx: 0, cy: 0, cells: 1024 });
  expect(Object.values(data['surfaces'] as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
    1024,
  );
  expect((await run('inspect-chunk', join(out, 'chunks/proving/0_0.dmck'))).output).toContain(
    'Поверхности',
  );

  const png = join(root, 'radar.png');
  expect((await run('radar', out, '--out', png)).code).toBe(0);
  const bytes = new Uint8Array(readFileSync(png));
  const view = new DataView(bytes.buffer);
  expect([...bytes.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([64, 64]);
  for (let p = 8; p < bytes.length;) {
    const length = view.getUint32(p);
    expect(view.getUint32(p + 8 + length)).toBe(crc32(bytes, p + 4, p + 8 + length));
    if (String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === 'IDAT') {
      expect(inflateSync(bytes.subarray(p + 8, p + 8 + length)).length).toBe(64 * (64 * 3 + 1));
    }
    p += 12 + length;
  }

  const fp = (await run('fingerprint', out, '--json')).json();
  const manifest = JSON.parse(readFileSync(marker, 'utf8')) as Parameters<
    typeof packFingerprint
  >[0];
  expect(fp['fingerprint']).toBe(packFingerprint(manifest));
  expect(fp['fingerprint']).toMatch(/^[0-9a-f]{64}$/);
});

it('повреждённый чанк и лишний файл', async () => {
  const out = join(root, 'broken');
  await run('generate-world', '--preset', 'proving', '--out', out);
  const chunk = join(out, 'chunks/proving/1_1.dmck');
  const bytes = readFileSync(chunk);
  bytes[100] = (bytes[100] ?? 0) ^ 0xff;
  writeFileSync(chunk, bytes);
  writeFileSync(join(out, 'notes.txt'), 'x');
  const result = await run('validate-pack', out, '--json');
  expect(result.code).toBe(1);
  const issues = result.json()['issues'] as { code: string; key?: string }[];
  expect(issues).toContainEqual(
    expect.objectContaining({ code: 'ASSET_HASH_MISMATCH', key: chunkKey('proving', 1, 1) }),
  );
  expect(issues).toContainEqual(expect.objectContaining({ code: 'ASSET_UNLISTED' }));
  expect(readdirSync(out)).toContain('notes.txt');
});

it('повреждение, которое ловит только декодер', async () => {
  const out = join(root, 'decoder');
  await run('generate-world', '--preset', 'proving', '--out', out);
  const manifestFile = join(out, 'pack.json');
  const chunk = join(out, 'chunks/proving/0_0.dmck');
  const bytes = readFileSync(chunk);
  bytes[4] = 9;
  writeFileSync(chunk, bytes);
  const { sha256 } = await import('@duskmarch/domain');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    entries: { path: string; sha256: string }[];
  };
  for (const e of manifest.entries)
    if (e.path === 'chunks/proving/0_0.dmck') e.sha256 = sha256(new Uint8Array(bytes));
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const result = await run('validate-pack', out, '--json');
  expect(result.json()['issues']).toContainEqual(
    expect.objectContaining({ code: 'CHUNK_VERSION' }),
  );
  expect((await run('validate-pack', out)).output).toContain('ОШИБКА CHUNK_VERSION');
});
