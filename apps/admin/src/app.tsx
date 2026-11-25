import { PlatformBadge } from '@duskmarch/ui-kit';
import type { AppConfig } from './config.js';

export function App({ config }: { config: AppConfig }) {
  return (
    <main>
      <PlatformBadge label={`Duskmarch · консоль · ${config.VITE_APP_ENV}`} />
    </main>
  );
}
