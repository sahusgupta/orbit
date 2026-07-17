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
    emptyOutDir: true
  }
});
