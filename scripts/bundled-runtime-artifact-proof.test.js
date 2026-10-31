import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserifyInventory, canonicalJson, normalizedSourceSha256, packageImportsFromSource, productionPackageImports, sha256, validateBundledArtifactFacts } from './bundled-runtime-artifact-proof.mjs';

function importsFor(text, filename = 'electron/probe.cjs') {
  const output = path.resolve('out');
  fs.mkdirSync(output, { recursive: true });
  const directory = fs.mkdtempSync(path.join(output, 'audit-guard-review-fixture-'));
  try {
    for (const relative of ['src', 'electron', 'apps/api/src']) fs.mkdirSync(path.join(directory, relative), { recursive: true });
    const target = path.join(directory, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return productionPackageImports(directory);
  } finally {
    if (!directory.startsWith(`${output}${path.sep}`) || !path.basename(directory).startsWith('audit-guard-review-fixture-')) {
      throw new Error('Unexpected source-fixture cleanup path.');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function fixture() {
  const review = { packageName: 'exceljs', version: '3.10.0', manifestRange: '^3.4.0',
    browserEntry: 'dist/exceljs.min.js', browserEntrySha256: 'a'.repeat(64),
    expandedBrowserEntrySha256: 'b'.repeat(64), packageMain: 'electron/main.cjs',
    packagerVersion: '26.15.3', rendererImporter: 'src/lib/profileWorkbookImport.ts',
    reviewedViteConfigSha256: 'c'.repeat(64), buildToolVersions: { vite: '7.3.7', '@vitejs/plugin-react': '5.2.0' },
    reviewedNodeVersions: { 'node_modules/exceljs': '3.10.0', 'node_modules/glob': '7.2.3' } };
  const manifest = { main: 'electron/main.cjs', dependencies: {}, devDependencies: { exceljs: '^3.4.0' },
    build: { asar: true, forceCodeSigning: true, files: ['dist/**/*', 'electron/**/*'] } };
  review.reviewedBuildConfigSha256 = sha256(canonicalJson(manifest.build));
  const facts = { manifest, lock: { packages: { '': { devDependencies: { exceljs: '^3.4.0' } },
    'node_modules/exceljs': { version: '3.10.0', dev: true }, 'node_modules/electron-builder': { version: '26.15.3' },
    'node_modules/vite': { version: '7.3.7' }, 'node_modules/@vitejs/plugin-react': { version: '5.2.0' } } },
  installed: { version: '3.10.0', browser: './dist/exceljs.min.js' },
  viteConfigSha256: review.reviewedViteConfigSha256, buildToolVersions: { ...review.buildToolVersions },
  browserEntrySha256: review.browserEntrySha256, expandedBrowserEntrySha256: review.expandedBrowserEntrySha256,
  sources: { imports: [{ path: 'src/lib/profileWorkbookImport.ts', specifier: 'exceljs' }], computed: [] },
  productionPackages: [{ name: 'electron-updater', version: '6.8.9' }],
  moduleIds: ['/synthetic/node_modules/exceljs/dist/exceljs.min.js', '\0/synthetic/node_modules/exceljs/dist/exceljs.min.js?commonjs-proxy'],
  externalImports: [], inventory: { tableCount: 1, moduleCount: 20, dependencies: ['saxes', 'jszip', 'fast-csv'] } };
  return { review, facts };
}

describe('bundled runtime artifact boundary', () => {
  it('accepts the fully bundled reviewed browser artifact while retaining embedded origins for separate advisory review', () => {
    const { review, facts } = fixture();
    expect(validateBundledArtifactFacts(review, facts)).toEqual({ valid: true, version: '3.10.0',
      browserEntrySha256: review.browserEntrySha256, failures: [] });
  });

  it.each([
    ['Node production declaration', facts => { facts.manifest.dependencies.exceljs = '^3.4.0'; }],
    ['old production lock declaration', facts => { facts.lock.packages[''].dependencies = { exceljs: '^3.4.0' }; }],
    ['lost build declaration', facts => { delete facts.manifest.devDependencies.exceljs; }],
    ['changed version', facts => { facts.installed.version = '4.0.0'; }],
    ['non-development locked node', facts => { facts.lock.packages['node_modules/exceljs'].dev = false; }],
    ['wrong browser entry', facts => { facts.installed.browser = './lib/exceljs.nodejs.js'; }],
    ['changed browser bytes', facts => { facts.browserEntrySha256 = 'c'.repeat(64); }],
    ['changed expanded bytes', facts => { facts.expandedBrowserEntrySha256 = 'c'.repeat(64); }],
    ['changed packaging scope', facts => { facts.manifest.build.files.push('node_modules/exceljs/**/*'); }],
    ['changed packager', facts => { facts.lock.packages['node_modules/electron-builder'].version = '27.0.0'; }],
    ['new Node consumer', facts => { facts.sources.imports.push({ path: 'electron/main.cjs', specifier: 'exceljs' }); }],
    ['case-insensitive Windows Node consumer', facts => { facts.sources.imports.push({ path: 'electron/main.cjs', specifier: 'EXCELJS' }); }],
    ['computed runtime import', facts => { facts.sources.computed.push('electron/main.cjs'); }],
    ['archive package still shipped', facts => { facts.productionPackages.push({ name: 'glob', version: '7.2.3' }); }],
    ['externalized browser dependency', facts => { facts.moduleIds = []; facts.externalImports = ['exceljs']; }],
    ['Node library entry bundled', facts => { facts.moduleIds.push('/synthetic/node_modules/exceljs/lib/exceljs.nodejs.js'); }],
    ['matcher entered renderer graph', facts => { facts.moduleIds.push('/synthetic/node_modules/minimatch/index.js'); }],
    ['matcher embedded in browser table', facts => { facts.inventory.dependencies.push('minimatch'); }],
    ['missing embedded inventory', facts => { facts.inventory = {}; }],
    ['incomplete embedded inventory', facts => { delete facts.inventory.dependencies; }]
  ])('rejects %s', (_label, mutate) => {
    const { review, facts } = fixture();
    mutate(facts);
    expect(validateBundledArtifactFacts(review, facts).valid).toBe(false);
  });

  it('canonicalizes configuration key order without hiding scope changes', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
    expect(canonicalJson({ files: ['a', 'b'] })).not.toBe(canonicalJson({ files: ['b', 'a'] }));
  });

  it.each(['electron/main.cjs', 'apps/api/src/server.js', 'src/other-importer.ts'])('rejects a configured consumer outside the reviewed importer: %s', importer => {
    const { review, facts } = fixture();
    review.rendererImporter = importer;
    facts.sources.imports = [{ path: importer, specifier: 'exceljs' }];
    expect(validateBundledArtifactFacts(review, facts).valid).toBe(false);
  });
  it.each([
    '../node_modules/exceljs', '..\\node_modules\\exceljs',
    '../node_modules/exceljs/lib/exceljs.nodejs.js',
    'C:\\fixture\\node_modules\\EXCELJS\\lib\\exceljs.nodejs.js',
    '/fixture/node_modules/exceljs/lib/exceljs.nodejs.js',
    'file:///fixture/node_modules/%65xceljs/lib/exceljs.nodejs.js',
    '../node_modules/other/../exceljs'
  ])('rejects literal package filesystem consumers: %s', specifier => {
    const { review, facts } = fixture();
    facts.sources.imports.push({ path: 'electron/main.cjs', specifier });
    expect(validateBundledArtifactFacts(review, facts).valid).toBe(false);
  });
});

describe('bundler transform proof', () => {
  it('normalizes only source line endings, preserving every configuration content change', () => {
    expect(normalizedSourceSha256('first\nsecond\n')).toBe(normalizedSourceSha256('first\r\nsecond\r\n'));
    expect(normalizedSourceSha256('first\nsecond\n')).toBe(normalizedSourceSha256('first\rsecond\r'));
    expect(normalizedSourceSha256('first\nsecond\n')).not.toBe(normalizedSourceSha256('first\nchanged\n'));
  });
  it.each([
    ['Vite configuration changed', ({ facts }) => { facts.viteConfigSha256 = 'd'.repeat(64); }],
    ['installed Vite changed', ({ facts }) => { facts.buildToolVersions.vite = '7.3.8'; }],
    ['installed React plugin changed', ({ facts }) => { facts.buildToolVersions['@vitejs/plugin-react'] = '5.2.1'; }],
    ['locked Vite changed', ({ facts }) => { facts.lock.packages['node_modules/vite'].version = '7.3.8'; }],
    ['locked React plugin changed', ({ facts }) => { facts.lock.packages['node_modules/@vitejs/plugin-react'].version = '5.2.1'; }],
    ['missing tool review', ({ review }) => { delete review.buildToolVersions; }]
  ])('rejects %s', (_label, mutate) => {
    const value = fixture(); mutate(value);
    expect(validateBundledArtifactFacts(value.review, value.facts).valid).toBe(false);
  });
});

describe('production source import characterization', () => {
  it('preserves literal CommonJS, dynamic imports and non-type-only TypeScript edges', () => {
    const result = importsFor('import value from "a"; import type { T } from "types"; export { value } from "b"; export type { U } from "types-2"; const c = require("c"); import("d"); import legacy = require("e");', 'src/probe.ts');
    expect(result.imports.map(item => item.specifier)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.computed).toEqual([]);
  });
  it('preserves computed bare loader rejection', () => {
    expect(importsFor('require(name); import(name);').computed).toEqual(['electron/probe.cjs', 'electron/probe.cjs']);
  });
  it('permits harmless require.main and typeof require metadata', () => {
    expect(importsFor('if (typeof require === "function" && require.main === module) {}')).toEqual({ imports: [], computed: [] });
  });
  it('continues parsing JSX source', () => {
    expect(importsFor('import Workbook from "exceljs"; export const View = () => <div />;', 'src/probe.tsx').imports)
      .toEqual([{ path: 'src/probe.tsx', specifier: 'exceljs' }]);
  });
  it('exposes source-only extraction independently of the filesystem prefilter', () => {
    expect(packageImportsFromSource('src/example.ts', 'import React from "react";')).toEqual({
      imports: [{ path: 'src/example.ts', specifier: 'react' }], computed: []
    });
  });
  it('decodes escaped names and specifiers before deciding which files need AST inspection', () => {
    expect(importsFor(String.raw`import Workbook from "\u0065xceljs";`, 'src/probe.ts').imports)
      .toEqual([{ path: 'src/probe.ts', specifier: 'exceljs' }]);
    expect(importsFor(String.raw`const load = r\u0065quire; load("exceljs");`).computed).toContain('electron/probe.cjs');
  });
  it('retains uppercase package consumers in the filesystem scan on case-insensitive platforms', () => {
    expect(importsFor('import Workbook from "EXCELJS";', 'electron/probe.mjs').imports)
      .toEqual([{ path: 'electron/probe.mjs', specifier: 'EXCELJS' }]);
  });
  it('retains literal filesystem and encoded file-URL package consumers in source inspection', () => {
    const specifier = 'file:///fixture/%6eode_modules/%65xceljs/dist/exceljs.min.js';
    expect(importsFor(`import sheet from ${JSON.stringify(specifier)};`, 'electron/probe.mjs').imports)
      .toEqual([{ path: 'electron/probe.mjs', specifier }]);
  });
  it('recognizes computed imports separated by comments and skips harmless type-only imports', () => {
    expect(importsFor('import /* fixture */ (name);').computed).toContain('electron/probe.cjs');
    expect(importsFor('import type { createRequire, Module } from "node:module"; let x: typeof createRequire;', 'src/probe.ts'))
      .toEqual({ imports: [], computed: [] });
  });
  it('retains loader checks after regex and JSX content that can confuse a context-free scanner', () => {
    expect(importsFor(String.raw`const pattern = /["']/; import /* fixture */ (name);`).computed).toContain('electron/probe.cjs');
    expect(importsFor('const View = () => <p>don\'t</p>; import /* fixture */ (name);', 'src/probe.tsx').computed).toContain('src/probe.tsx');
  });
  it('characterizes current production source without opaque loading', () => {
    const result = productionPackageImports(process.cwd());
    expect(result.computed).toEqual([]);
    expect(result.imports.filter(item => item.specifier === 'exceljs')).toEqual([
      { path: 'src/lib/profileWorkbookImport.ts', specifier: 'exceljs' }
    ]);
  });
});

describe('Node module-loader source boundary', () => {
  it.each(['module.require("exceljs");', 'module["require"]("exceljs");', 'module?.require?.("exceljs");'])('records literal module loader: %s', text => {
    expect(importsFor(text).imports).toContainEqual({ path: 'electron/probe.cjs', specifier: 'exceljs' });
  });
  it.each([
    'module.require(name);', 'module["require"](name);', 'module[method]("exceljs");',
    'const load = require; load("exceljs");', 'const load = require.bind(module); load("exceljs");',
    'require.call(module, "exceljs");', 'const load = module.require; load("exceljs");',
    'const main = require.main; main.require("exceljs");',
    'const { createRequire } = require("node:module"); const load = createRequire(__filename); load("exceljs");',
    'const { createRequire: create } = require("module"); const load = create(__filename); load("exceljs");',
    'const { "createRequire": create } = require("module"); const load = create(__filename); load("exceljs");',
    'const { ["createRequire"]: create } = require("module"); const load = create(__filename); load("exceljs");',
    'const { [method]: create } = require("module"); const load = create(__filename); load("exceljs");',
    'const { ...Native } = require("module"); Native.createRequire(__filename)("exceljs");',
    'const Native = require("node:module"); const load = Native.createRequire(__filename); load("exceljs");',
    'const Native = require("node:module"); const make = Native.createRequire; make(__filename)("exceljs");',
    'import { createRequire as make } from "node:module"; make(import.meta.url)("exceljs");',
    'import * as Native from "node:module"; Native.createRequire(import.meta.url)("exceljs");',
    'import Native from "module"; Native._load("exceljs", module);',
    'Module._load("exceljs", module);', 'module.constructor._load("exceljs", module);',
    'require("node:module")._load("exceljs", module);',
    'const Native = await import("node:module"); Native.createRequire(import.meta.url)("exceljs");',
    'process.getBuiltinModule("module").createRequire(__filename)("exceljs");'
  ])('requires review for opaque loader indirection: %s', text => {
    expect(importsFor(text).computed).toContain('electron/probe.cjs');
  });
});

describe('reviewed Browserify dependency inventory', () => {
  it('reads actual module-table dependency edges instead of treating the Vite module as an inventory', () => {
    const result = browserifyInventory('(function(m,c,e){} )({1:[function(require,module,exports){module.exports=require("saxes")},{"saxes":2}],2:[function(require,module,exports){},{}]}, {}, [1]);');
    expect(result).toEqual({ tableCount: 1, moduleCount: 2, dependencies: ['saxes'] });
  });
  it.each(['', 'const module = { exports: {} };', '(function(){})({1:[function(){},{}]}, {}, [2]);'])('rejects missing or invalid module evidence', source => {
    expect(() => browserifyInventory(source)).toThrow();
  });
});
