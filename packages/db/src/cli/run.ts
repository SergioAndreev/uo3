import { fileURLToPath } from 'node:url';
import { DbEnvSchema, loadServerConfigOrExit } from '@duskmarch/config/env/server';
import { createDbClient, type Database } from '../client.js';

const WORKSPACE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

export async function runWithDb(task: (db: Database) => Promise<void>, done: string) {
  const config = loadServerConfigOrExit(DbEnvSchema, { cwd: WORKSPACE_ROOT });
  const client = createDbClient(config.DATABASE_URL);
  try {
    await task(client.db);
    console.log(done);
  } finally {
    await client.close();
  }
}
