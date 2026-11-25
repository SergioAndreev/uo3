import { seedDatabase } from '../seed.js';
import { runWithDb } from './run.js';

await runWithDb(seedDatabase, 'Стартовые данные записаны');
