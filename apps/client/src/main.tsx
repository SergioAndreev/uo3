import { createRoot } from 'react-dom/client';
import { App, bootstrap } from './app.js';
import { browserProbe, checkCapabilities } from './app/capabilities.js';
import { readConfig } from './config.js';
import { createBrowserServices } from './session/browser.js';

const host = document.getElementById('root');
if (!host) throw new Error('Нет элемента #root');
bootstrap(document.documentElement);
const capabilities = checkCapabilities(browserProbe(() => readConfig(import.meta.env)));
let config = null;
try {
  config = readConfig(import.meta.env);
} catch {
  config = null;
}
const services = config ? createBrowserServices(config.VITE_API_BASE_URL) : null;
// Тихое обновление при старте: cookie `httpOnly` может держать живую сессию.
void (services?.store.refresh() ?? Promise.resolve(false)).finally(() => {
  createRoot(host).render(
    <App
      config={config}
      capabilities={capabilities}
      {...(services
        ? { session: () => services.store.kind, connectivity: services.connectivity }
        : {})}
    />,
  );
});
