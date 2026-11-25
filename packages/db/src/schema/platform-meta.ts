import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const platformEnvMetadata = pgTable('platform_env_metadata', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
