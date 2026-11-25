import { defineConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

export default defineConfig(nodePreset('core'));
