import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema/platform-meta.ts', './src/schema/identity.ts'],
  out: './drizzle',
});
