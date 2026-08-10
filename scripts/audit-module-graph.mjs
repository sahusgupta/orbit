import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import ts from 'typescript';

const workspaceRoot = process.cwd();
const sourceRoots = ['src', 'electron', 'apps/api/src', 'player-app/src'];
const sourceExtensions = ['.ts', '.tsx', '.js', '.cjs', '.mjs'];
const configuredEntrypoints = new Set([
  'src/main.tsx',
  'electron/main.cjs',
  'electron/preload.cjs',
  'apps/api/src/server.js',
  'apps/api/src/cleanupStressClubs.js',
  'player-app/src/PlayerApp.tsx',
  'player-app/src/components/MapView.ts',
  'player-app/src/components/MapView.tsx',
  'player-app/src/components/MapView.web.tsx',
  'player-app/src/shims/PerformanceOverlay.js'
]);

const normalizePath = (path) => relative(workspaceRoot, path).replaceAll('\\', '/');
const isProductionSource = (path) =>
  sourceExtensions.includes(extname(path)) &&
  !path.endsWith('.d.ts') &&
  !/\.(test|spec)\.[^.]+$/.test(path);

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : isProductionSource(path) ? [path] : [];
  });
}

const files = sourceRoots.flatMap((root) => listFiles(resolve(workspaceRoot, root)));
const fileSet = new Set(files);
const graph = new Map(files.map((file) => [file, new Set()]));
const incoming = new Map(files.map((file) => [file, new Set()]));
const externalImports = new Map(files.map((file) => [file, new Set()]));
const unresolvedImports = [];

function getModuleSpecifiers(file) {
  const source = readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const specifiers = [];
  const recordSpecifier = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      recordSpecifier(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      recordSpecifier(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isRequire || isDynamicImport) recordSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveRelativeImport(importer, specifier) {
  const base = resolve(dirname(importer), specifier);
  const candidates = [base];
  if (!extname(base)) {
    sourceExtensions.forEach((extension) => candidates.push(`${base}${extension}`));
    sourceExtensions.forEach((extension) => candidates.push(resolve(base, `index${extension}`)));
  } else if (extname(base) === '.js') {
    candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  }
  const source = candidates.find((candidate) => fileSet.has(candidate));
  if (source) return source;
  if (candidates.some((candidate) => existsSync(candidate) && statSync(candidate).isFile())) return null;
  return undefined;
}

for (const file of files) {
  for (const specifier of getModuleSpecifiers(file)) {
    if (!specifier.startsWith('.')) {
      externalImports.get(file).add(specifier);
      continue;
    }
    const target = resolveRelativeImport(file, specifier);
    if (target === undefined) {
      unresolvedImports.push({ importer: normalizePath(file), specifier });
      continue;
    }
    if (!target) continue;
    graph.get(file).add(target);
    incoming.get(target).add(file);
  }
}

let nextIndex = 0;
const indexes = new Map();
const lowLinks = new Map();
const stack = [];
const onStack = new Set();
const cycles = [];

function connect(file) {
  indexes.set(file, nextIndex);
  lowLinks.set(file, nextIndex);
  nextIndex += 1;
  stack.push(file);
  onStack.add(file);

  for (const dependency of graph.get(file)) {
    if (!indexes.has(dependency)) {
      connect(dependency);
      lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
    } else if (onStack.has(dependency)) {
      lowLinks.set(file, Math.min(lowLinks.get(file), indexes.get(dependency)));
    }
  }

  if (lowLinks.get(file) !== indexes.get(file)) return;
  const component = [];
  let member;
  do {
    member = stack.pop();
    onStack.delete(member);
    component.push(member);
  } while (member !== file);
  if (component.length > 1 || graph.get(file).has(file)) {
    cycles.push(component.map(normalizePath).sort());
  }
}

files.forEach((file) => {
  if (!indexes.has(file)) connect(file);
});

const dependencyViolations = [];
const addViolation = (file, dependency, rule) => dependencyViolations.push({
  file: normalizePath(file),
  dependency: dependency.startsWith(workspaceRoot) ? normalizePath(dependency) : dependency,
  rule
});
const under = (path, prefix) => normalizePath(path).startsWith(`${prefix}/`);

for (const file of files) {
  for (const dependency of graph.get(file)) {
    const target = normalizePath(dependency);
    if (under(file, 'src/domain') && /^(src\/(app|application|components|features)\/|src\/main\.tsx$)/.test(target)) {
      addViolation(file, dependency, 'management domain must not depend on composition, application, or presentation');
    }
    if (under(file, 'src/application/management') && !under(file, 'src/application/management/sync') && /^(src\/(app|components|features)\/|src\/main\.tsx$)/.test(target)) {
      addViolation(file, dependency, 'management commands must not depend on adapters, composition, or presentation');
    }
    if (under(file, 'src/features') && target === 'src/main.tsx') {
      addViolation(file, dependency, 'management features must not depend on the composition root');
    }
    if (under(file, 'player-app/src/domain') && /^player-app\/src\/(app|application|components|data|features)\//.test(target)) {
      addViolation(file, dependency, 'Player domain must not depend on app, application, data, or presentation');
    }
    if (under(file, 'player-app/src/data') && /^player-app\/src\/(application|features|components)\//.test(target)) {
      addViolation(file, dependency, 'Player data must not depend on application or presentation');
    }
    if (under(file, 'player-app/src/features') && target === 'player-app/src/PlayerApp.tsx') {
      addViolation(file, dependency, 'Player features must not depend on the composition root');
    }
    if ((under(file, 'apps/api/src/db') || under(file, 'apps/api/src/services')) && /^apps\/api\/src\/(app|http|routes|server)\b/.test(target)) {
      addViolation(file, dependency, 'API repositories and providers must not depend on HTTP composition');
    }
    if (under(file, 'electron') && target.startsWith('src/')) {
      addViolation(file, dependency, 'Electron process modules must not import renderer source');
    }
  }

  for (const dependency of externalImports.get(file)) {
    if (under(file, 'player-app/src/domain') && /^(firebase(?:\/|$)|react(?:\/|$)|react-native(?:\/|$)|expo-|@expo\/)/.test(dependency)) {
      addViolation(file, dependency, 'Player domain must remain platform-neutral');
    }
    if (under(file, 'player-app/src/application') && /^(react-native(?:\/|$)|expo-|@expo\/|@react-native\/)/.test(dependency)) {
      addViolation(file, dependency, 'Player application must use the platform port instead of native packages');
    }
    if (under(file, 'src/domain') && /^(firebase(?:\/|$)|electron(?:\/|$)|react(?:\/|$)|react-dom(?:\/|$))/.test(dependency)) {
      addViolation(file, dependency, 'management domain must remain free of runtime frameworks and adapters');
    }
  }
}

const zeroIncoming = files
  .filter((file) => incoming.get(file).size === 0)
  .map(normalizePath)
  .sort();
const configuredZeroIncoming = zeroIncoming.filter((file) => configuredEntrypoints.has(file));
const candidateZeroIncoming = zeroIncoming.filter((file) => !configuredEntrypoints.has(file));
const edgeCount = Array.from(graph.values()).reduce((sum, dependencies) => sum + dependencies.size, 0);

console.log(JSON.stringify({
  summary: {
    files: files.length,
    relativeEdges: edgeCount,
    cycles: cycles.length,
    dependencyViolations: dependencyViolations.length,
    unresolvedRelativeImports: unresolvedImports.length,
    configuredZeroIncoming: configuredZeroIncoming.length,
    candidateZeroIncoming: candidateZeroIncoming.length
  },
  cycles,
  dependencyViolations,
  unresolvedImports,
  zeroIncoming: {
    configured: configuredZeroIncoming,
    candidates: candidateZeroIncoming
  }
}, null, 2));

if (cycles.length || dependencyViolations.length || unresolvedImports.length) process.exitCode = 1;
