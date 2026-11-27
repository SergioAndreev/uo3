/** Связность браузера: `online`/`offline`; подписчики приостанавливают опрос. */
export class Connectivity {
  online: boolean;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(
    target: Pick<Window, 'addEventListener'> & { navigator?: { onLine: boolean } } = window,
  ) {
    this.online = target.navigator?.onLine ?? true;
    target.addEventListener('online', () => this.set(true));
    target.addEventListener('offline', () => this.set(false));
  }

  private set(online: boolean): void {
    this.online = online;
    for (const l of this.listeners) l(online);
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
