import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';

interface DryRun {
  tasks: { taskId: string; hash: string }[];
}

function hashes(): Map<string, string> {
  const out = execFileSync('node_modules/.bin/turbo', ['run', 'typecheck', 'build', '--dry=json'], {
    encoding: 'utf8',
  });
  return new Map((JSON.parse(out) as DryRun).tasks.map((task) => [task.taskId, task.hash]));
}

it('изменение ui-kit инвалидирует только ui-kit, client и admin', () => {
  const file = 'packages/ui-kit/src/index.ts';
  const source = readFileSync(file, 'utf8');
  const before = hashes();
  try {
    writeFileSync(file, `${source}// cache probe\n`);
    const changed = [...hashes()].filter(([id, hash]) => before.get(id) !== hash);
    expect(new Set(changed.map(([id]) => id.split('#')[0]))).toEqual(
      new Set(['@duskmarch/ui-kit', '@duskmarch/client', '@duskmarch/admin']),
    );
  } finally {
    writeFileSync(file, source);
  }
});

it('повторный прогон — FULL TURBO не дольше 5 с', () => {
  const run = () =>
    execFileSync('node_modules/.bin/turbo', ['run', 'typecheck', 'build'], { encoding: 'utf8' });
  run();
  const start = performance.now();
  expect(run()).toContain('FULL TURBO');
  expect(performance.now() - start).toBeLessThanOrEqual(5_000);
}, 180_000);
