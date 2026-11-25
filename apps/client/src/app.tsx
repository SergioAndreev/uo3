import { PACKAGE_ID as assetFormats } from '@duskmarch/asset-formats';
import { PACKAGE_ID as domain } from '@duskmarch/domain';
import { PACKAGE_ID as protocol } from '@duskmarch/protocol';
import { PACKAGE_ID as rules } from '@duskmarch/rules';
import { PlatformBadge } from '@duskmarch/ui-kit';
import type { AppConfig } from './config.js';

const MODULES = [domain, rules, protocol, assetFormats];

export function App({ config }: { config: AppConfig }) {
  return (
    <main>
      <PlatformBadge label={`Duskmarch · ${config.VITE_APP_ENV}`} />
      <ul>
        {MODULES.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
    </main>
  );
}
