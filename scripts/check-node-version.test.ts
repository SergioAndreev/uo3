import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each([
  ['20.18.0', 1],
  ['23.0.0', 1],
  ['22.12.0', 0],
])('Node %s → код %i', (version, code) => {
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/check-node-version.ts', version],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(code);
  if (code) expect(run.stderr).toContain(`22.x, обнаружена ${version}`);
});
