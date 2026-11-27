import { Panel } from '@duskmarch/ui-kit';
import type { ScreenKey } from '../app/routes.js';

/** Временный экран до реализации (группы 3–4 P09). */
export const stub = (key: ScreenKey) =>
  function StubScreen() {
    return (
      <Panel title={key}>
        <p data-screen={key}>Экран «{key}» появится в P09.</p>
      </Panel>
    );
  };
