import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { platformEnvMetadata, shardEntitySequences, shards } from './schema/index.js';

export const SEED_ROWS = [
  { key: 'seed.version', value: 'p00-v1', description: 'Версия стартовых данных' },
  {
    key: 'shard.default',
    value: { id: 'local-dev', name: 'Duskmarch Local Dev', ruleset: 'duskmarch' },
    description: 'Шард по умолчанию',
  },
  { key: 'world.synthetic_ready', value: false, description: 'Готов ли синтетический мир' },
] as const;

/** Шарды разработки: `local-dev` (испытательный план) и `ember` (Заря и Марь). */
export const SEED_SHARDS = [
  {
    id: 'local-dev',
    name: 'Испытательный рубеж',
    region: 'local',
    preset: 'proving',
    visibility: 'public',
    startCities: ['proving-camp'],
    sortOrder: 10,
  },
  {
    id: 'ember',
    name: 'Угли',
    region: 'local',
    preset: 'standard',
    visibility: 'public',
    startCities: ['lad', 'kremnev', 'solyar'],
    sortOrder: 20,
  },
] as const;

/** Повторный вызов приводит строки к тому же состоянию; шарды, изменённые администратором, не перезаписываются. */
export async function seedDatabase(db: Pick<Database, 'transaction'>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(platformEnvMetadata)
      .values([...SEED_ROWS])
      .onConflictDoUpdate({
        target: platformEnvMetadata.key,
        set: { value: sql`excluded.value`, description: sql`excluded.description` },
      });
    const now = new Date();
    await tx
      .insert(shards)
      .values(
        SEED_SHARDS.map((s) => ({
          ...s,
          startCities: [...s.startCities],
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(shardEntitySequences)
      .values(SEED_SHARDS.map((s) => ({ shardId: s.id })))
      .onConflictDoNothing();
  });
}
