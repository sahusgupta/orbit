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

console.log(JSON.stringify({
  initialJavaScript: {
    bytes: initialChunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    gzipBytes: initialChunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
    chunks: initialChunks.map((chunk) => chunk.fileName)
  },
  chunks,
  assets
}, null, 2));
