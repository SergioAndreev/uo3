import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { readConfig } from './config.js';

const host = document.getElementById('root');
if (!host) throw new Error('Нет элемента #root');
createRoot(host).render(<App config={readConfig(import.meta.env)} />);
