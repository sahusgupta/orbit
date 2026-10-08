import { availableParallelism } from 'node:os';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // Bound concurrent jsdom/source-contract workers; keep test deadlines intact.
    maxWorkers: Math.min(8, availableParallelism()),
    // Ignored release/diagnostic copies are generated artifacts, not source tests.
    exclude: [...configDefaults.exclude, 'out/**']
  }
}));
