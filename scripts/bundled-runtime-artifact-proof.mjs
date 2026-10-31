import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const normalized = value => value.replaceAll('\\', '/');
const packageAtNode = value => value.slice(value.lastIndexOf('node_modules/') + 'node_modules/'.length);
export const canonicalJson = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const normalizedSourceSha256 = value => sha256(value.replace(/\r\n?/g, '\n'));
const reviewedBuildTools = ['vite', '@vitejs/plugin-react'];
const validBuildToolReview = review => review.buildToolVersions && typeof review.buildToolVersions === 'object'
  && !Array.isArray(review.buildToolVersions) && Object.keys(review.buildToolVersions).length === reviewedBuildTools.length
  && reviewedBuildTools.every(name => typeof review.buildToolVersions[name] === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(review.buildToolVersions[name]));

function isExceljsSpecifier(value) {
  // Literal filesystem and file-URL imports can reach the same Node package on
  // Windows. Classify them without resolving or reading any requested path.
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Retain the literal form when URI decoding is invalid. */ }
  const matches = candidate => candidate === 'exceljs' || candidate.startsWith('exceljs/')
    || /(?:^|\/)node_modules\/exceljs(?:\/|$)/.test(candidate);
  return [value, decoded].some(item => {
    const candidate = normalized(item).toLowerCase();
    return [candidate, candidate.split(/[?#]/, 1)[0]].some(item => matches(item) || matches(path.posix.normalize(item)));
  });
}

function hasRelevantImportSyntax(text) {
  // Scan decoded tokens, not raw text: escaped identifiers/specifiers and
  // comments between import and '(' must retain the same boundary checks.
  // A context-free scanner can misread regex/template/JSX contents. These
  // conservative triggers retain all known loader syntax before token scanning;
  // false positives only cause a full parse, never an artifact exemption.
  if (/\b(?:require|module|Module|createRequire|_load|_resolveFilename|register|registerHooks|getBuiltinModule)\b|\\[ux]|\bimport\s*(?:\(|\/[/*])/.test(text)
    || /exceljs/i.test(text)) return true;
  const markers = new Set(['require', 'module', 'node:module', 'Module', 'createRequire', '_load',
    '_resolveFilename', 'register', 'registerHooks', 'getBuiltinModule']);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  let previous = ts.SyntaxKind.Unknown;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (previous === ts.SyntaxKind.ImportKeyword && token === ts.SyntaxKind.OpenParenToken) return true;
    if (token === ts.SyntaxKind.Identifier || token >= ts.SyntaxKind.FirstKeyword && token <= ts.SyntaxKind.LastKeyword
      || token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      const value = scanner.getTokenValue() || scanner.getTokenText();
      if (markers.has(value) || isExceljsSpecifier(value)) return true;
    }
    previous = token;
  }
  return false;
}

export function packageImportsFromSource(filename, text) {
  const imports = [];
  const computed = [];
  const relative = normalized(filename);
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Cannot verify runtime imports in ${relative}.`);
  const namespaces = new Set();
  const factories = new Set(['createRequire']);
  const opaqueLoaders = new Set();
  const opaqueBindings = new Set();
  const marked = new Set();
  const unwrap = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  };
  const members = new WeakMap();
  const member = node => {
    if (!node) return null;
    if (members.has(node)) return members.get(node);
    const result = ts.isPropertyAccessExpression(node)
      ? { object: unwrap(node.expression), name: node.name.text }
      : ts.isElementAccessExpression(node)
        ? { object: unwrap(node.expression), name: node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null }
        : null;
    members.set(node, result);
    return result;
  };
  const bareRequire = node => ts.isIdentifier(unwrap(node)) && unwrap(node).text === 'require';
  const moduleSpecifier = node => node && ts.isStringLiteralLike(node) && ['module', 'node:module'].includes(node.text);
  const nativeModuleLoad = node => {
    node = unwrap(node);
    if (!node || !ts.isCallExpression(node)) return false;
    const target = unwrap(node.expression);
    const property = member(target);
    return moduleSpecifier(node.arguments[0]) && (bareRequire(target) || target.kind === ts.SyntaxKind.ImportKeyword
      || (property?.name === 'getBuiltinModule' && ts.isIdentifier(property.object) && property.object.text === 'process'));
  };
  const bind = (imported, local) => {
    if (imported === 'createRequire') factories.add(local);
    else if (['_load', '_resolveFilename', 'register', 'registerHooks'].includes(imported)) opaqueLoaders.add(local);
    else if (imported === 'Module' || imported === 'default' || imported === '*') namespaces.add(local);
  };
  const collect = node => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && moduleSpecifier(node.moduleSpecifier)) {
      if (node.importClause?.name) namespaces.add(node.importClause.name.text);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (!item.isTypeOnly) bind(item.propertyName?.text || item.name.text, item.name.text);
      }
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)
      && moduleSpecifier(node.moduleReference.expression)) namespaces.add(node.name.text);
    else if (ts.isVariableDeclaration(node) && nativeModuleLoad(node.initializer)) {
      if (ts.isIdentifier(node.name)) namespaces.add(node.name.text);
      else if (ts.isObjectBindingPattern(node.name)) for (const item of node.name.elements) {
        if (item.dotDotDotToken || !ts.isIdentifier(item.name)) { opaqueBindings.add(node); continue; }
        let imported = item.name.text;
        if (item.propertyName) {
          const computedProperty = ts.isComputedPropertyName(item.propertyName);
          const property = computedProperty ? unwrap(item.propertyName.expression) : item.propertyName;
          if (computedProperty && !ts.isStringLiteralLike(property)) { opaqueBindings.add(node); continue; }
          if (!ts.isIdentifier(property) && !ts.isStringLiteralLike(property)) { opaqueBindings.add(node); continue; }
          imported = property.text;
        }
        bind(imported, item.name.text);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const moduleObjects = new WeakMap();
  const nodeModuleObject = input => {
    const node = unwrap(input);
    if (!node) return false;
    if (moduleObjects.has(node)) return moduleObjects.get(node);
    let result = false;
    if (ts.isIdentifier(node)) result = node.text === 'module' || node.text === 'Module' || namespaces.has(node.text);
    else if (nativeModuleLoad(node)) result = true;
    else {
      const property = member(node);
      result = !!property && (property.name === 'main' && bareRequire(property.object)
        || ['constructor', 'parent', 'prototype', 'Module', 'default'].includes(property.name) && nodeModuleObject(property.object));
    }
    moduleObjects.set(node, result);
    return result;
  };
  const loaderKind = node => {
    const property = member(unwrap(node));
    if (!property) return null;
    if (property.name === 'resolve' && bareRequire(property.object)) return 'literal';
    if (!nodeModuleObject(property.object)) return null;
    if (property.name === 'require') return 'literal';
    if (property.name === null || ['createRequire', '_load', '_resolveFilename', 'register', 'registerHooks'].includes(property.name)) return 'opaque';
    return null;
  };
  const outerUse = node => {
    while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAwaitExpression(node.parent)
      || ts.isAsExpression(node.parent) || ts.isTypeAssertionExpression(node.parent)
      || ts.isNonNullExpression(node.parent) || ts.isSatisfiesExpression(node.parent))) node = node.parent;
    return node;
  };
  const typeContexts = new WeakMap();
  const typePosition = node => {
    if (typeContexts.has(node)) return typeContexts.get(node);
    const parent = node.parent;
    const result = !!parent && !ts.isStatement(parent) && (ts.isTypeNode(parent) || typePosition(parent));
    typeContexts.set(node, result);
    return result;
  };
  const declarationName = node => {
    const parent = node.parent;
    return parent && ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isImportClause(parent)
      || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)) && parent.name === node
      || (ts.isImportSpecifier(parent) || ts.isBindingElement(parent)) && (parent.name === node || parent.propertyName === node)
      || (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node
      || ts.isPropertyAccessExpression(parent) && parent.name === node);
  };
  const isCallTarget = node => ts.isCallExpression(outerUse(node).parent) && unwrap(outerUse(node).parent.expression) === unwrap(node);
  const harmlessObjectUse = node => {
    node = outerUse(node);
    const parent = node.parent;
    const property = member(parent);
    return !parent || declarationName(node) || ts.isTypeOfExpression(parent)
      || property?.object === unwrap(node)
      || ts.isExpressionStatement(parent)
      || ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)
      || (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) && parent.expression === node
      || ts.isConditionalExpression(parent) && parent.condition === node
      || ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken
      || ts.isVariableDeclaration(parent) && unwrap(parent.initializer) === unwrap(node) && nativeModuleLoad(node);
  };
  const mark = node => { if (!marked.has(node)) { marked.add(node); computed.push(relative); } };
  const record = (argument, site) => {
    if (argument && ts.isStringLiteralLike(argument)) imports.push({ path: relative, specifier: argument.text });
    else mark(site);
  };
  const visit = node => {
    if (opaqueBindings.has(node)) mark(node);
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) record(node.moduleSpecifier, node);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) record(node.moduleSpecifier, node);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly) record(node.moduleReference.expression, node);
    else if (ts.isCallExpression(node)) {
      const target = unwrap(node.expression);
      const kind = loaderKind(target);
      const property = member(target);
      if (target.kind === ts.SyntaxKind.ImportKeyword || bareRequire(target) || kind === 'literal'
        || property?.name === 'getBuiltinModule' && ts.isIdentifier(property.object) && property.object.text === 'process') record(node.arguments[0], node);
      else if (kind === 'opaque' || ts.isIdentifier(target) && (factories.has(target.text) || opaqueLoaders.has(target.text))
        || nodeModuleObject(target)) mark(node);
    }
    if ((ts.isIdentifier(node) || ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)
      || ts.isElementAccessExpression(node)) && !typePosition(node)) {
      if (member(node) && loaderKind(node) && !isCallTarget(node) && !ts.isTypeOfExpression(outerUse(node).parent)) mark(node);
      if (ts.isIdentifier(node) && !declarationName(node)) {
        const use = outerUse(node);
        const property = member(use.parent);
        if (node.text === 'require' && !isCallTarget(node) && !ts.isTypeOfExpression(use.parent)
          && !(property?.object === node && ['main', 'resolve'].includes(property.name))) mark(node);
        if ((factories.has(node.text) || opaqueLoaders.has(node.text)) && !ts.isTypeOfExpression(use.parent)) mark(node);
      }
      if ((ts.isIdentifier(node) || ts.isCallExpression(node) || member(node)) && nodeModuleObject(node)
        && !(ts.isIdentifier(node) && node.text === 'Module' && !namespaces.has('Module'))
        && !harmlessObjectUse(node)) mark(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, computed };
}

export function productionPackageImports(root) {
  const imports = [];
  const computed = [];
  function inspect(filename) {
    if (!/\.(?:[cm]?js|jsx|tsx?)$/.test(filename) || /\.(?:test|spec)\.[^.]+$|\.d\.ts$/.test(filename)) return;
    const relative = normalized(path.relative(root, filename));
    const text = fs.readFileSync(filename, 'utf8');
    // This is a targeted ExcelJS/Node-loader boundary, not a complete module
    // inventory. Vite/compiler verification owns unrelated static imports.
    if (!hasRelevantImportSyntax(text)) return;
    const found = packageImportsFromSource(relative, text);
    imports.push(...found.imports);
    computed.push(...found.computed);
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Runtime-source symlinks require a boundary review.');
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile()) inspect(filename);
    }
  }
  for (const directory of ['src', 'electron', 'apps/api/src']) walk(path.join(root, directory));
  return { imports, computed };
}

export function browserifyInventory(source) {
  const parsed = ts.createSourceFile('reviewed-browser-artifact.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new Error('Cannot inspect the reviewed browser artifact.');
  const tables = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.arguments.length >= 3
      && ts.isObjectLiteralExpression(node.arguments[0]) && ts.isArrayLiteralExpression(node.arguments[2])) {
      const entries = node.arguments[0].properties;
      if (entries.length && entries.every(entry => ts.isPropertyAssignment(entry)
        && ts.isArrayLiteralExpression(entry.initializer) && entry.initializer.elements.length === 2
        && ts.isFunctionExpression(entry.initializer.elements[0]) && ts.isObjectLiteralExpression(entry.initializer.elements[1]))) {
        const names = entries.map(entry => entry.name.getText(parsed).replace(/^['"]|['"]$/g, ''));
        const dependencies = entries.flatMap(entry => entry.initializer.elements[1].properties.map(item => {
          if (!ts.isPropertyAssignment(item)) throw new Error('Unknown browser dependency-table shape.');
          return item.name.getText(parsed).replace(/^['"]|['"]$/g, '');
        }));
        const entrypoints = node.arguments[2].elements.map(item => item.getText(parsed).replace(/^['"]|['"]$/g, ''));
        if (!entrypoints.every(entry => names.includes(entry))) throw new Error('Unknown browser entry module.');
        tables.push({ modules: names.length, dependencies, entrypoints });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!tables.length) throw new Error('Reviewed browser module tables are missing.');
  return { tableCount: tables.length, moduleCount: tables.reduce((sum, table) => sum + table.modules, 0),
    dependencies: [...new Set(tables.flatMap(table => table.dependencies))].sort() };
}

export function validateBundledArtifactFacts(review, facts) {
  const failures = [];
  const name = review.packageName;
  const fail = reason => failures.push(`${name}: ${reason}`);
  if (facts.manifest.dependencies?.[name] !== undefined) fail('still declared as a Node production dependency.');
  if (facts.lock.packages?.['']?.dependencies?.[name] !== undefined) fail('still declared as a Node production dependency in the lock root.');
  if (facts.manifest.devDependencies?.[name] !== review.manifestRange
    || facts.lock.packages?.['']?.devDependencies?.[name] !== review.manifestRange) fail('build dependency declaration changed.');
  const locked = facts.lock.packages?.[`node_modules/${name}`];
  if (locked?.version !== review.version || locked.dev !== true || facts.installed.version !== review.version) fail('reviewed build-only version changed.');
  if (facts.installed.browser?.replace(/^\.\//, '') !== review.browserEntry) fail('browser entry changed.');
  if (facts.browserEntrySha256 !== review.browserEntrySha256
    || facts.expandedBrowserEntrySha256 !== review.expandedBrowserEntrySha256) fail('reviewed browser bytes changed.');
  if (facts.manifest.main !== review.packageMain || facts.manifest.build?.asar !== true
    || sha256(canonicalJson(facts.manifest.build)) !== review.reviewedBuildConfigSha256) fail('reviewed packaging configuration changed.');
  if (facts.lock.packages?.['node_modules/electron-builder']?.version !== review.packagerVersion) fail('reviewed packager changed.');
  if (!validBuildToolReview(review) || !/^[a-f0-9]{64}$/.test(review.reviewedViteConfigSha256 || '')
    || facts.viteConfigSha256 !== review.reviewedViteConfigSha256) fail('reviewed bundler configuration changed.');
  if (reviewedBuildTools.some(tool => facts.lock.packages?.[`node_modules/${tool}`]?.version !== review.buildToolVersions?.[tool]
    || facts.buildToolVersions?.[tool] !== review.buildToolVersions?.[tool])) fail('reviewed bundler toolchain changed.');
  const imports = facts.sources.imports.filter(item => isExceljsSpecifier(item.specifier));
  if (review.rendererImporter !== 'src/lib/profileWorkbookImport.ts') fail('reviewed renderer importer changed.');
  if (imports.some(item => /^(?:electron|apps\/api)\//i.test(normalized(item.path)))) fail('Node runtime consumer is not permitted for the reviewed browser-only component.');
  if (imports.length !== 1 || imports[0].path !== review.rendererImporter || imports[0].specifier !== name) fail('runtime consumer boundary changed.');
  if (facts.sources.computed.length) fail('computed production imports require boundary review.');
  const reviewedNames = new Map(Object.entries(review.reviewedNodeVersions).map(([node, version]) => [packageAtNode(node), version]));
  for (const item of facts.productionPackages) {
    if (item.name.toLowerCase() === name.toLowerCase() || reviewedNames.get(item.name.toLowerCase()) === item.version) fail(`reviewed Node-only package remains in the production tree: ${item.name}.`);
  }
  const browserPath = normalized(`node_modules/${name}/${review.browserEntry}`);
  const observed = facts.moduleIds.map(id => normalized(id).replace(/^\0/, '').split('?')[0]);
  const libraryModules = observed.filter(id => id.includes(`/node_modules/${name}/`) || id.startsWith(`node_modules/${name}/`));
  if (!libraryModules.length || libraryModules.some(id => !id.endsWith(browserPath))) fail('browser entry is not fully bundled through the reviewed module.');
  const nodeOnly = /(?:^|\/)node_modules\/(?:archiver|archiver-utils|glob|minimatch|rimraf|zip-stream)(?:\/|$)/;
  if (observed.some(id => nodeOnly.test(id))) fail('Node archive/matcher code entered the renderer graph.');
  if (facts.externalImports.length) fail('renderer output contains external imports.');
  if (!facts.inventory?.tableCount || !facts.inventory.moduleCount || !Array.isArray(facts.inventory.dependencies)
    || facts.inventory.dependencies.some(item => typeof item !== 'string')) fail('reviewed browser inventory is missing.');
  const unshipped = new Set(['archiver', 'archiver-utils', 'glob', 'minimatch', 'rimraf', 'zip-stream']);
  if (facts.inventory?.dependencies?.some(specifier => [...unshipped].some(item => specifier === item || specifier.startsWith(`${item}/`)))) fail('Node archive/matcher code entered the browser dependency tables.');
  return { valid: failures.length === 0, version: facts.installed.version,
    browserEntrySha256: facts.browserEntrySha256, failures };
}

export async function inspectBundledRuntimeArtifact(root, review, productionPackages, generatedDirectory) {
  if (review.packageName !== 'exceljs' || review.browserEntry !== 'dist/exceljs.min.js'
    || review.expandedBrowserEntry !== 'dist/exceljs.js') throw new Error('Unreviewed bundled runtime package/entry.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (!validBuildToolReview(review) || !/^[a-f0-9]{64}$/.test(review.reviewedViteConfigSha256 || '')) {
    throw new Error('Unreviewed bundler configuration or toolchain.');
  }
  const viteConfigPath = path.join(root, 'vite.config.ts');
  const viteConfigSha256 = normalizedSourceSha256(fs.readFileSync(viteConfigPath, 'utf8'));
  const buildToolVersions = Object.fromEntries(reviewedBuildTools.map(tool => [tool,
    JSON.parse(fs.readFileSync(path.join(root, 'node_modules', tool, 'package.json'), 'utf8')).version]));
  if (viteConfigSha256 !== review.reviewedViteConfigSha256 || reviewedBuildTools.some(tool =>
    buildToolVersions[tool] !== review.buildToolVersions[tool]
    || lock.packages?.[`node_modules/${tool}`]?.version !== review.buildToolVersions[tool])) {
    throw new Error('Reviewed bundler configuration or toolchain changed.');
  }
  const packageDirectory = path.join(root, 'node_modules', review.packageName);
  const installed = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  if (fs.statSync(path.join(packageDirectory, review.browserEntry)).size !== review.browserEntryBytes
    || fs.statSync(path.join(packageDirectory, review.expandedBrowserEntry)).size !== review.expandedBrowserEntryBytes) {
    throw new Error('Reviewed browser artifact size changed.');
  }
  const browser = fs.readFileSync(path.join(packageDirectory, review.browserEntry));
  const expanded = fs.readFileSync(path.join(packageDirectory, review.expandedBrowserEntry));
  if (sha256(browser) !== review.browserEntrySha256 || sha256(expanded) !== review.expandedBrowserEntrySha256) {
    throw new Error('Reviewed browser artifact hash changed.');
  }
  const inventory = browserifyInventory(expanded.toString('utf8'));
  const { build } = await import('vite');
  const built = await build({ root, logLevel: 'silent', envDir: generatedDirectory,
    cacheDir: path.join(generatedDirectory, 'vite-cache'), build: { write: false } });
  if (normalizedSourceSha256(fs.readFileSync(viteConfigPath, 'utf8')) !== viteConfigSha256
    || sha256(fs.readFileSync(path.join(packageDirectory, review.browserEntry))) !== review.browserEntrySha256
    || sha256(fs.readFileSync(path.join(packageDirectory, review.expandedBrowserEntry))) !== review.expandedBrowserEntrySha256) {
    throw new Error('Reviewed bundler inputs changed during artifact inspection.');
  }
  const output = (Array.isArray(built) ? built : [built]).flatMap(item => item.output || []);
  const files = new Set(output.map(item => item.fileName));
  const chunks = output.filter(item => item.type === 'chunk');
  const moduleIds = [...new Set(chunks.flatMap(chunk => Object.keys(chunk.modules)))];
  const externalImports = chunks.flatMap(chunk => [...chunk.imports, ...chunk.dynamicImports])
    .filter(specifier => !files.has(specifier));
  const facts = { manifest, lock, installed, browserEntrySha256: sha256(browser),
    expandedBrowserEntrySha256: sha256(expanded), viteConfigSha256, buildToolVersions, sources: productionPackageImports(root),
    productionPackages, moduleIds, externalImports, inventory };
  return { ...validateBundledArtifactFacts(review, facts), inventory,
    moduleCount: moduleIds.length, dependencyModules: moduleIds.filter(id => id.includes(`/node_modules/${review.packageName}/`)) };
}
