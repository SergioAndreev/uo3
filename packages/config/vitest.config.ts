import { defineConfig } from 'vitest/config';
import { nodePreset } from './src/vitest/node.js';

export default defineConfig(nodePreset('core'));
