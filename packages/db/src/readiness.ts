export type DependencyState = 'up' | 'down';
export type Probe = () => Promise<unknown>;

export interface Readiness {
  status: 'ok' | 'unavailable';
  dependencies: Record<string, DependencyState>;
}

/** Параллельно выполняет пробы; ошибка или таймаут означают `down`. */
export async function checkReadiness(
  probes: Readonly<Record<string, Probe>>,
  timeoutMs: number,
): Promise<Readiness> {
  const entries = await Promise.all(
    Object.entries(probes).map(async ([name, probe]): Promise<[string, DependencyState]> => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<DependencyState>((resolve) => {
        timer = setTimeout(() => resolve('down'), timeoutMs);
      });
      const attempt = (async () => {
        await probe();
        return 'up' as const;
      })().catch(() => 'down' as const);
      const state = await Promise.race([attempt, timeout]);
      clearTimeout(timer);
      return [name, state];
    }),
  );
  const ok = entries.every(([, state]) => state === 'up');
  return { status: ok ? 'ok' : 'unavailable', dependencies: Object.fromEntries(entries) };
}
