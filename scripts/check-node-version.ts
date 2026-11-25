import { pathToFileURL } from 'node:url';

/** Возвращает код выхода и сообщение для версии Node.js. */
export function checkNodeVersion(version: string): { code: number; message: string } {
  const ok = /^v?22\.\d+\.\d+$/.test(version);
  return ok
    ? { code: 0, message: `Node.js ${version}: OK` }
    : { code: 1, message: `Требуется Node.js 22.x, обнаружена ${version}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, message } = checkNodeVersion(process.argv[2] ?? process.version);
  console[code === 0 ? 'log' : 'error'](message);
  process.exitCode = code;
}
