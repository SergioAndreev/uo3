import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED: Readonly<Record<'apps' | 'packages', readonly string[]>> = {
  apps: ['admin', 'api', 'asset-tool', 'bot-client', 'client', 'game-server'],
  packages: [
    'asset-formats',
    'config',
    'content',
    'db',
    'domain',
    'protocol',
    'rules',
    'test-kit',
    'ui-kit',
  ],
};

interface Manifest {
  name?: string;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const RUNTIME = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;

export function checkWorkspaceManifests(root: string): string[] {
  const errors: string[] = [];
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    engines?: { node?: string };
    packageManager?: string;
    pnpm?: { onlyBuiltDependencies?: string[] };
  };
  if (rootManifest.engines?.node !== '>=22.0.0 <23.0.0')
    errors.push('корень: неверный engines.node');
  if (!/^pnpm@9\.\d+\.\d+/.test(rootManifest.packageManager ?? '')) {
    errors.push('корень: packageManager должен фиксировать точную версию pnpm 9');
  }

  if (!rootManifest.pnpm?.onlyBuiltDependencies?.length) {
    errors.push('корень: нужен белый список pnpm.onlyBuiltDependencies');
  }

  for (const group of ['apps', 'packages'] as const) {
    const actual = readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const extra of actual.filter((name) => !EXPECTED[group].includes(name))) {
      errors.push(`${group}/${extra}: неизвестный модуль`);
    }
    for (const name of EXPECTED[group]) {
      const dir = join(root, group, name);
      const at = `${group}/${name}`;
      if (!existsSync(join(dir, 'package.json'))) {
        errors.push(`${at}: нет package.json`);
        continue;
      }
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
      if (manifest.name !== `@duskmarch/${name}`) errors.push(`${at}: неверное имя`);
      if (manifest.type !== 'module') errors.push(`${at}: требуется type: module`);
      if (!existsSync(join(dir, 'tsconfig.json'))) errors.push(`${at}: нет tsconfig.json`);

      for (const section of [...RUNTIME, 'devDependencies'] as const) {
        for (const [dep, range] of Object.entries(manifest[section] ?? {})) {
          if (dep.startsWith('@duskmarch/') && range !== 'workspace:*') {
            errors.push(`${at}: ${dep} должен использовать workspace:*`);
          }
        }
      }
      for (const section of RUNTIME) {
        const deps = Object.keys(manifest[section] ?? {});
        if (deps.includes('@duskmarch/test-kit')) {
          errors.push(`${at}: @duskmarch/test-kit допустим только в devDependencies`);
        }
        if (name === 'domain') {
          for (const dep of deps.filter((d) => d !== '@sinclair/typebox')) {
            errors.push(`${at}: запрещённая runtime-зависимость ${dep}`);
          }
        }
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkWorkspaceManifests(resolve(process.argv[2] ?? '.'));
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log('Манифесты: 6 приложений, 9 пакетов — OK');
}
