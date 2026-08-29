import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const packageDirectory = (packageName: string) => dirname(require.resolve(`${packageName}/package.json`));
const dependencyPackageDirectory = (ownerPackage: string, dependencyPackage: string) => {
  const ownerRequire = createRequire(require.resolve(`${ownerPackage}/package.json`));
  return dirname(ownerRequire.resolve(`${dependencyPackage}/package.json`));
};

const localOcrWorkerEntry = `(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const expectedLanguageUrl = new URL('./lang/eng.traineddata.gz', globalThis.location.href).href;
  globalThis.fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith('file:')) return nativeFetch(input, init);
    if (href !== expectedLanguageUrl || init !== undefined) {
      return Promise.reject(new TypeError('Blocked unexpected local OCR asset request.'));
    }
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', href, true);
      request.responseType = 'arraybuffer';
      request.onload = () => {
        const body = request.response;
        if ((request.status === 0 || request.status === 200) && body instanceof ArrayBuffer && body.byteLength > 0) {
          resolve(new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/gzip' }
          }));
          return;
        }
        reject(new TypeError('Unable to load local OCR language data.'));
      };
      request.onerror = () => reject(new TypeError('Unable to load local OCR language data.'));
      request.send();
    });
  };
  importScripts('./worker.min.js');
})();
`;

const localOcrAssets = [
  {
    fileName: 'ocr/worker-entry.js',
    source: localOcrWorkerEntry,
    contentType: 'text/javascript; charset=utf-8'
  },
  {
    fileName: 'ocr/worker.min.js',
    sourcePath: join(packageDirectory('tesseract.js'), 'dist', 'worker.min.js'),
    stripSourceMap: true,
    contentType: 'text/javascript; charset=utf-8'
  },
  {
    fileName: 'ocr/worker.min.js.LICENSE.txt',
    sourcePath: join(packageDirectory('tesseract.js'), 'dist', 'worker.min.js.LICENSE.txt'),
    contentType: 'text/plain; charset=utf-8'
  },
  {
    fileName: 'ocr/licenses/tesseract.js-LICENSE.md',
    sourcePath: join(packageDirectory('tesseract.js'), 'LICENSE.md'),
    contentType: 'text/markdown; charset=utf-8'
  },
  ...[
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js'
  ].map((fileName) => ({
    fileName: `ocr/core/${fileName}`,
    sourcePath: join(dependencyPackageDirectory('tesseract.js', 'tesseract.js-core'), fileName),
    contentType: 'text/javascript; charset=utf-8'
  })),
  {
    fileName: 'ocr/licenses/tesseract.js-core-LICENSE',
    sourcePath: join(dependencyPackageDirectory('tesseract.js', 'tesseract.js-core'), 'LICENSE'),
    contentType: 'text/plain; charset=utf-8'
  },
  {
    fileName: 'ocr/lang/eng.traineddata.gz',
    sourcePath: join(packageDirectory('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'),
    contentType: 'application/gzip'
  },
  {
    fileName: 'ocr/licenses/eng-package.json',
    sourcePath: join(packageDirectory('@tesseract.js-data/eng'), 'package.json'),
    contentType: 'application/json; charset=utf-8'
  },
  {
    fileName: 'ocr/licenses/eng-README.md',
    sourcePath: join(packageDirectory('@tesseract.js-data/eng'), 'README.md'),
    contentType: 'text/markdown; charset=utf-8'
  }
] as const;

const readLocalOcrAsset = (asset: (typeof localOcrAssets)[number]) => {
  const source = 'source' in asset ? asset.source : readFileSync(asset.sourcePath);
  if ('stripSourceMap' in asset && asset.stripSourceMap) {
    return source.toString().replace(/\r?\n\/\/# sourceMappingURL=.*?\s*$/, '\n');
  }
  return source;
};

function bundleLocalOcrAssets(): Plugin {
  return {
    name: 'orbit-local-ocr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = String(request.url || '').split('?', 1)[0].replace(/^\/+/, '');
        const asset = localOcrAssets.find((candidate) => candidate.fileName === requestPath);
        if (!asset) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', asset.contentType);
        response.setHeader('cache-control', 'no-store');
        response.end(readLocalOcrAsset(asset));
      });
    },
    generateBundle() {
      localOcrAssets.forEach((asset) => {
        this.emitFile({
          type: 'asset',
          fileName: asset.fileName,
          source: readLocalOcrAsset(asset)
        });
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), bundleLocalOcrAssets()],
  build: {
    sourcemap: false
  }
});
