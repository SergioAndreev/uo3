import { migrateDatabase } from '../migrate.js';
import { runWithDb } from './run.js';

await runWithDb(migrateDatabase, 'Миграции применены');
