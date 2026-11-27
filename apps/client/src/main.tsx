import { createRoot } from 'react-dom/client';
import { App, bootstrap } from './app.js';
import { browserProbe, checkCapabilities } from './app/capabilities.js';
import { readConfig } from './config.js';

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
createRoot(host).render(<App config={config} capabilities={capabilities} />);
