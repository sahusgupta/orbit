import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

function excludeInstallerArtifacts() {
  const outputDir = fileURLToPath(new URL('../download-dist', import.meta.url));
  return {
    name: 'exclude-installer-artifacts',
    closeBundle() {
      fs.rmSync(path.join(outputDir, 'downloads'), { recursive: true, force: true });
    }
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  plugins: [excludeInstallerArtifacts()],
  build: {
    outDir: '../download-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        product: fileURLToPath(new URL('./product.html', import.meta.url)),
        support: fileURLToPath(new URL('./support.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
        terms: fileURLToPath(new URL('./terms.html', import.meta.url))
      }
    }
  }
});
