import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { platformEnvMetadata } from './schema/index.js';

export const SEED_ROWS = [
  { key: 'seed.version', value: 'p00-v1', description: 'Версия стартовых данных' },
  {
    key: 'shard.default',
    value: { id: 'local-dev', name: 'Duskmarch Local Dev', ruleset: 'duskmarch' },
    description: 'Шард по умолчанию',
  },
  { key: 'world.synthetic_ready', value: false, description: 'Готов ли синтетический мир' },
] as const;

/** Повторный вызов приводит строки к тому же состоянию. */
export async function seedDatabase(db: Pick<Database, 'transaction'>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(platformEnvMetadata)
      .values([...SEED_ROWS])
      .onConflictDoUpdate({
        target: platformEnvMetadata.key,
        set: { value: sql`excluded.value`, description: sql`excluded.description` },
      });
  });
}
