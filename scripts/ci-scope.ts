import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface Scope {
  full: boolean;
  /** Аргумент `turbo run`; пустой при полном прогоне. */
  filter: string;
  /** Каталоги для ESLint. */
  paths: string[];
}

/** Файлы модулей и документация; всё прочее считается корневым и требует полного прогона. */
const NARROW = /^(apps|packages)\/[^/]+\/|^(docs|openspec|\.changeset)\/|^[^/]+\.md$/;

/** `deps`: каталог модуля → каталоги его зависимостей внутри монорепозитория. */
export function computeScope(
  base: string,
  files: readonly string[],
  deps: ReadonlyMap<string, readonly string[]>,
): Scope {
  const isRoot = (file: string): boolean =>
    !NARROW.test(file) || file.startsWith('packages/config/');
  if (!base || files.some(isRoot)) return { full: true, filter: '', paths: ['.'] };
  const affected = new Set(
    [...deps.keys()].filter((dir) => files.some((file) => file.startsWith(`${dir}/`))),
  );
  for (let size = -1; size !== affected.size;) {
    size = affected.size;
    for (const [dir, list] of deps) if (list.some((d) => affected.has(d))) affected.add(dir);
  }
  return { full: false, filter: `--filter=...[${base}]`, paths: [...affected].sort() };
}

export function readDependencies(): Map<string, string[]> {
  const manifests = ['apps', 'packages'].flatMap((group) =>
    readdirSync(group)
      .map((name) => `${group}/${name}`)
      .filter((dir) => existsSync(`${dir}/package.json`))
      .map((dir) => {
        const json = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as {
          name: string;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        return { dir, name: json.name, uses: { ...json.dependencies, ...json.devDependencies } };
      }),
  );
  return new Map(
    manifests.map(({ dir, uses }) => [
      dir,
      manifests.filter((other) => other.name in uses).map((other) => other.dir),
    ]),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env['BASE_SHA'] ?? '';
  const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' });
  // Turbo сравнивает с коммитом напрямую, поэтому нужна точка ветвления.
  const base = event && git('merge-base', event, 'HEAD').trim();
  const files = base ? git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean) : [];
  const { full, filter, paths } = computeScope(base, files, readDependencies());
  console.log(`full=${full}\nfilter=${filter}\npaths=${paths.join(' ')}`);
}
