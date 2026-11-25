import { spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';

/** Отправляет запрос и ждёт в ответе ожидаемую подстроку. */
export function probeTcp(
  port: number,
  send: string,
  expected: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    let received = '';
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
    socket.on('connect', () => void (send && socket.write(send)));
    socket.on('data', (chunk) => {
      received += chunk.toString();
      if (received.includes(expected)) finish(true);
    });
  });
}

export const probeValkey = (port: number): Promise<boolean> => probeTcp(port, 'PING\r\n', '+PONG');
export const probeNats = (port: number): Promise<boolean> => probeTcp(port, '', 'INFO ');

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export function dockerAvailable(timeoutMs = 8_000, command = 'docker'): boolean {
  const run = spawnSync(command, ['info', '--format', '{{.ServerVersion}}'], {
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  return run.status === 0 && run.stdout.trim() !== '';
}

/** Запущенные сервисы Compose этого проекта и их состояние здоровья. */
export function composeServices(root: string): Map<string, string> {
  const run = spawnSync(
    'docker',
    ['compose', '--profile', 'core', 'ps', '--format', '{{.Service}} {{.Health}}'],
    { cwd: root, timeout: 8_000, encoding: 'utf8' },
  );
  const lines = run.status === 0 ? run.stdout.trim().split('\n').filter(Boolean) : [];
  return new Map(lines.map((line) => line.split(' ') as [string, string]));
}
