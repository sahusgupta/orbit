import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { createSalesMapDemoResetPlugin } from './demoResetPlugin';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const demoResetSignalPath = fileURLToPath(
  new URL('../../.orbit/sales-map-demo-reset', import.meta.url)
);

export default defineConfig({
  root: appRoot,
  base: './',
  plugins: [react(), createSalesMapDemoResetPlugin(demoResetSignalPath)],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}']
  }
});
