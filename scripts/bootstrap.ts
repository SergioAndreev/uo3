import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { corePorts, createMissingEnvFiles, readRootEnv, type PortKey } from './lib/env-files.js';
import { composeServices, dockerAvailable, isPortFree } from './lib/probes.js';

const SERVICE_OF: Record<PortKey, string> = {
  PG_PORT: 'postgres',
  VALKEY_PORT: 'valkey',
  NATS_PORT: 'nats',
  NATS_MONITOR_PORT: 'nats',
};

/** Порты, занятые не нашими контейнерами. */
export async function findPortConflicts(
  ports: Record<PortKey, number>,
  running: ReadonlySet<string>,
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const [key, port] of Object.entries(ports) as [PortKey, number][]) {
    if (running.has(SERVICE_OF[key]) || (await isPortFree(port))) continue;
    conflicts.push(`Порт ${port} занят. Задайте другой в .env: ${key}=<порт> и поправьте адреса`);
  }
  return conflicts;
}

export interface BootstrapDeps {
  docker: () => boolean;
  running: () => ReadonlySet<string>;
  run: (command: string, args: string[]) => boolean;
  log: (message: string) => void;
}

export async function bootstrap(root: string, deps: BootstrapDeps): Promise<number> {
  const { log } = deps;
  if (!deps.docker()) {
    log('Docker недоступен. Запустите Docker Engine (например, systemctl start docker).');
    return 1;
  }
  for (const file of createMissingEnvFiles(root)) log(`создан ${file}`);
  const conflicts = await findPortConflicts(corePorts(readRootEnv(root)), deps.running());
  if (conflicts.length > 0) {
    conflicts.forEach(log);
    return 1;
  }
  const up = ['compose', '--profile', 'core', 'up', '-d', '--wait', '--wait-timeout', '120'];
  const steps: [string, string, string[]][] = [
    ['контейнеры', 'docker', up],
    ['миграции', 'pnpm', ['db:migrate']],
    ['стартовые данные', 'pnpm', ['db:seed']],
    ['диагностика', 'pnpm', ['run', 'doctor']],
  ];
  for (const [name, command, args] of steps) {
    log(`→ ${name}`);
    if (!deps.run(command, args)) {
      log(`Шаг «${name}» завершился с ошибкой`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve('.');
  process.exitCode = await bootstrap(root, {
    docker: () => dockerAvailable(),
    running: () => new Set(composeServices(root).keys()),
    run: (command, args) => spawnSync(command, args, { cwd: root, stdio: 'inherit' }).status === 0,
    log: console.log,
  });
}
