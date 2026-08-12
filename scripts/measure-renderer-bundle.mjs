import { relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const workspaceRoot = process.cwd();
const buildResults = await build({
  logLevel: 'silent',
  build: { write: false }
});
const output = (Array.isArray(buildResults) ? buildResults : [buildResults])
  .flatMap((result) => result.output ?? []);

const normalizeModuleId = (id) => {
  if (id.startsWith('\0')) return id;
  const relativeId = relative(workspaceRoot, id);
  return (relativeId.startsWith('..') ? id : relativeId).replaceAll('\\', '/');
};

const chunks = output
  .filter((item) => item.type === 'chunk')
  .map((chunk) => ({
    fileName: chunk.fileName,
    bytes: Buffer.byteLength(chunk.code),
    gzipBytes: gzipSync(chunk.code).byteLength,
    isEntry: chunk.isEntry,
    isDynamicEntry: chunk.isDynamicEntry,
    imports: chunk.imports,
    dynamicImports: chunk.dynamicImports,
    moduleCount: Object.keys(chunk.modules).length,
    topModules: Object.entries(chunk.modules)
      .map(([id, module]) => ({
        id: normalizeModuleId(id),
        renderedBytes: module.renderedLength
      }))
      .sort((left, right) => right.renderedBytes - left.renderedBytes)
      .slice(0, 20)
  }))
  .sort((left, right) => Number(right.isEntry) - Number(left.isEntry) || right.bytes - left.bytes);

const assets = output
  .filter((item) => item.type === 'asset')
  .map((asset) => {
    const source = Buffer.from(asset.source);
    return {
      fileName: asset.fileName,
      bytes: source.byteLength,
      gzipBytes: gzipSync(source).byteLength
    };
  })
  .sort((left, right) => right.bytes - left.bytes);

const chunksByName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
const initialChunkNames = new Set();
const addStaticImports = (fileName) => {
  if (initialChunkNames.has(fileName)) return;
  const chunk = chunksByName.get(fileName);
  if (!chunk) return;
  initialChunkNames.add(fileName);
  chunk.imports.forEach(addStaticImports);
};
chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => addStaticImports(chunk.fileName));
const initialChunks = Array.from(initialChunkNames, (fileName) => chunksByName.get(fileName)).filter(Boolean);

const report = {
  initialJavaScript: {
    bytes: initialChunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    gzipBytes: initialChunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
    chunks: initialChunks.map((chunk) => chunk.fileName)
  },
  chunks,
  assets
};

console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--check')) {
  const failures = [];
  if (report.initialJavaScript.bytes > 620_000) failures.push(`initial JavaScript ${report.initialJavaScript.bytes} exceeds 620000 bytes`);
  if (report.initialJavaScript.gzipBytes > 190_000) failures.push(`initial gzip JavaScript ${report.initialJavaScript.gzipBytes} exceeds 190000 bytes`);
  if (assets.some((asset) => asset.fileName.endsWith('.map'))) failures.push('production source maps must not be emitted');
  if (failures.length) {
    failures.forEach((failure) => console.error(`BUNDLE_BUDGET: ${failure}`));
    process.exitCode = 1;
  }
}
