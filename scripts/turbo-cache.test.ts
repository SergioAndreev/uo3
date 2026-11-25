import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

// Асинхронно: долгий синхронный вызов обрывает связь воркера с Vitest.
const run = promisify(execFile);

interface DryRun {
  tasks: { taskId: string; hash: string }[];
}

async function turbo(...args: string[]): Promise<string> {
  const options = { maxBuffer: 64 * 1024 * 1024 };
  return (await run('node_modules/.bin/turbo', ['run', 'typecheck', 'build', ...args], options))
    .stdout;
}

async function hashes(): Promise<Map<string, string>> {
  const { tasks } = JSON.parse(await turbo('--dry=json')) as DryRun;
  return new Map(tasks.map((task) => [task.taskId, task.hash]));
}

it('изменение ui-kit инвалидирует только ui-kit, client и admin', async () => {
  const file = 'packages/ui-kit/src/index.ts';
  const source = readFileSync(file, 'utf8');
  const before = await hashes();
  try {
    writeFileSync(file, `${source}// cache probe\n`);
    const changed = [...(await hashes())].filter(([id, hash]) => before.get(id) !== hash);
    expect(new Set(changed.map(([id]) => id.split('#')[0]))).toEqual(
      new Set(['@duskmarch/ui-kit', '@duskmarch/client', '@duskmarch/admin']),
    );
  } finally {
    writeFileSync(file, source);
  }
});

it('повторный прогон — FULL TURBO не дольше 5 с', async () => {
  await turbo();
  const start = performance.now();
  expect(await turbo()).toContain('FULL TURBO');
  expect(performance.now() - start).toBeLessThanOrEqual(5_000);
}, 300_000);
