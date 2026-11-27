export type CapabilityCode =
  'ERR_SHELL_WEBGL2_UNAVAILABLE' | 'ERR_SHELL_WORKERS_UNAVAILABLE' | 'ERR_SHELL_CONFIG_INVALID';

export interface CapabilityReport {
  ok: boolean;
  failures: CapabilityCode[];
  /** Неблокирующие: нет OPFS — режим памяти для пакета ассетов. */
  warnings: 'storage_memory_only'[];
}

export interface BrowserProbe {
  webgl2(): boolean;
  workers(): boolean;
  opfs(): boolean;
  config(): boolean;
}

export const browserProbe = (readConfig: () => unknown): BrowserProbe => ({
  webgl2: () => {
    try {
      return Boolean(document.createElement('canvas').getContext('webgl2'));
    } catch {
      return false;
    }
  },
  workers: () => typeof Worker === 'function',
  opfs: () =>
    typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function',
  config: () => {
    try {
      readConfig();
      return true;
    } catch {
      return false;
    }
  },
});

/** Проверка при запуске: без WebGL2, Workers или конфигурации — блокирующий экран. */
export function checkCapabilities(probe: BrowserProbe): CapabilityReport {
  const failures: CapabilityCode[] = [];
  if (!probe.config()) failures.push('ERR_SHELL_CONFIG_INVALID');
  if (!probe.webgl2()) failures.push('ERR_SHELL_WEBGL2_UNAVAILABLE');
  if (!probe.workers()) failures.push('ERR_SHELL_WORKERS_UNAVAILABLE');
  return {
    ok: failures.length === 0,
    failures,
    warnings: probe.opfs() ? [] : ['storage_memory_only'],
  };
}
