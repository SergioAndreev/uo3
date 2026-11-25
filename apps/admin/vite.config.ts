import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { bundleGuard } from '@duskmarch/config/vite/bundle-guard';

export default defineConfig({
  plugins: [react(), bundleGuard()],
  server: { port: 5274, strictPort: true },
  build: { target: 'es2022', outDir: 'dist' },
});
