import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema/platform-meta.ts',
    './src/schema/identity.ts',
    './src/schema/shards.ts',
    './src/schema/world.ts',
  ],
  out: './drizzle',
});
