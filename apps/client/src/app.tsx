import { PACKAGE_ID as assetFormats } from '@duskmarch/asset-formats';
import { PACKAGE_ID as domain } from '@duskmarch/domain';
import { PACKAGE_ID as protocol } from '@duskmarch/protocol';
import { DUSKMARCH, PACKAGE_ID as rules, publicProfile } from '@duskmarch/rules';
import { PlatformBadge } from '@duskmarch/ui-kit';
import type { AppConfig } from './config.js';

const MODULES = [domain, rules, protocol, assetFormats];
// До P05 клиент строит срез сам; затем срез будет приходить с сервера.
const RULESET = publicProfile(DUSKMARCH);

export function App({ config }: { config: AppConfig }) {
  return (
    <main>
      <PlatformBadge label={`Duskmarch · ${config.VITE_APP_ENV}`} />
      <ul>
        {MODULES.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
      <p data-testid="ruleset">
        Правила {RULESET.id} v{RULESET.version} · {RULESET.fingerprint.slice(0, 12)}
      </p>
    </main>
  );
}
