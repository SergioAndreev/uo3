import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { SECRET_KEYS, bundleGuard, findLeaks } from './bundle-guard.js';

async function bundle(code: string): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), 'duskmarch-vite-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/a.js"></script>');
    writeFileSync(join(root, 'src/a.js'), code);
    const result = await build({
      root,
      logLevel: 'silent',
      configFile: false,
      plugins: [bundleGuard({ DATABASE_URL: 'postgres://very-secret' })],
      build: { write: false },
    });
    const outputs = Array.isArray(result) ? result : [result];
    return outputs.flatMap((o) => ('output' in o ? o.output.map((item) => item.fileName) : []));
  } finally {
    rmSync(root, { recursive: true });
  }
}

it('пропускает чистый бандл и пишет отчёт', async () => {
  expect(await bundle('document.title = "ok";')).toContain('bundle-stats.json');
});

it.each([
  'document.title = window.env.DATABASE_URL;',
  'document.title = "CHANGE_ME_LOCAL_DEV_ONLY";',
  'document.title = "postgres://very-secret";',
  'import fs from "node:fs"; document.title = fs.x;',
])('прерывает сборку: %s', async (code) => {
  await expect(bundle(code)).rejects.toThrow('CONFIG_CLIENT_SECRET_FORBIDDEN');
});

it('знает секреты серверных схем', () => {
  expect(SECRET_KEYS).toContain('IDENTITY_JWT_SIGNING_KEYS_JSON');
  expect(findLeaks('const a = 1')).toEqual([]);
});
