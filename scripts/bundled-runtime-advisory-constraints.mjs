const knownOrigin = Object.freeze({
  name: 'minimatch',
  url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
  severity: 'moderate',
  range: '<11.0.1'
});
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const clone = (value) => structuredClone(value);
const validName = (value) => typeof value === 'string' && value.length <= 214
  && /^(?:@[a-z0-9_][a-z0-9._-]*\/)?[a-z0-9_][a-z0-9._-]*$/i.test(value)
  && value !== 'node_modules';
const validVersion = (value) => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
const validNodePath = (value) => typeof value === 'string' && value.startsWith('node_modules/')
  && value.slice('node_modules/'.length).split('/node_modules/').every(validName);
const nameAtPath = (value) => value.slice(value.lastIndexOf('node_modules/') + 'node_modules/'.length);

const numericPart = '(?:0|[1-9]\\d*|[xX*])';
const numericVersion = `v?${numericPart}(?:\\.${numericPart}){0,2}`;
const versionToken = new RegExp(`^${numericVersion}$`);
const comparatorToken = new RegExp(`^(?:<=|>=|<|>|=|~|\\^)?${numericVersion}$`);
const comparatorOperator = /^(?:<=|>=|<|>|=|~|\^)$/;

function isNumericRangeBranch(value) {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length === 3 && tokens[1] === '-') return versionToken.test(tokens[0]) && versionToken.test(tokens[2]);
  // Tokenize first so long whitespace-separated ranges cannot cause ambiguous
  // nested repetition/backtracking in a single range regular expression.
  for (let index = 0; index < tokens.length; index += 1) {
    if (comparatorOperator.test(tokens[index])) {
      if (!versionToken.test(tokens[++index] || '')) return false;
    } else if (!comparatorToken.test(tokens[index])) return false;
  }
  return true;
}

function isRegistrySpec(value) {
  if (typeof value !== 'string' || value.length > 1024) return false;
  const spec = value.trim();
  // Accept the reviewed numeric range/tag grammar, not arbitrary npm package
  // specs. Aliases, hosted Git shorthand, local tarballs and $override references
  // require a new boundary review even though this generated lock is never installed.
  if (!spec || /[:/\\]/.test(spec) || /\.(?:tgz|tar\.gz|tar)$/i.test(spec)) return false;
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(spec) || spec.split('||').every(isNumericRangeBranch);
}

function dependencyEntries(value, label) {
  if (value === undefined) return [];
  if (!isRecord(value)) throw new Error(`${label} must be a dependency record.`);
  return Object.entries(value).map(([name, range]) => {
    if (!validName(name) || !isRegistrySpec(range)) {
      throw new Error(`${label} contains a non-registry or malformed dependency.`);
    }
    return [name, range];
  });
}

function validateOverrides(value) {
  if (!isRecord(value)) throw new Error('The source overrides must be a record.');
  for (const entry of Object.values(value)) {
    if (isRecord(entry)) validateOverrides(entry);
    else if (!isRegistrySpec(entry)) {
      throw new Error('The source overrides contain a non-registry or malformed dependency.');
    }
  }
}

function resolveNode(packages, parent, name) {
  let cursor = parent;
  while (true) {
    const candidate = `${cursor ? `${cursor}/` : ''}node_modules/${name}`;
    if (has(packages, candidate)) return candidate;
    if (!cursor) return null;
    const separator = cursor.lastIndexOf('/node_modules/');
    cursor = separator < 0 ? '' : cursor.slice(0, separator);
  }
}

function validatePackageNode(node, nodePath) {
  if (!validNodePath(nodePath) || !isRecord(node) || node.link === true || !validVersion(node.version)
    || typeof node.resolved !== 'string' || !node.resolved.startsWith('https://registry.npmjs.org/')
    || typeof node.integrity !== 'string' || !/^sha(?:1|256|384|512)-[A-Za-z0-9+/=]+(?:\s+sha(?:1|256|384|512)-[A-Za-z0-9+/=]+)*$/.test(node.integrity)) {
    throw new Error('The bundled audit closure contains an incomplete, linked, or non-registry package node.');
  }
}

/** Derive a private audit-only fixture; never install or re-resolve this lock. */
export function createBundledAuditFixture(manifest, lock, packageName) {
  if (!isRecord(manifest) || !isRecord(lock) || !isRecord(lock.packages)
    || ![2, 3].includes(lock.lockfileVersion) || !validName(packageName)) {
    throw new Error('A registry package manifest and package-lock v2/v3 are required.');
  }
  const declared = [...dependencyEntries(manifest.dependencies, 'manifest.dependencies'),
    ...dependencyEntries(manifest.devDependencies, 'manifest.devDependencies')];
  if (!declared.some(([name]) => name === packageName)) throw new Error('The bundled package is not declared in the source manifest.');
  const rootPath = resolveNode(lock.packages, '', packageName);
  if (!rootPath) throw new Error('The bundled package has no locked root resolution.');
  const selected = new Map();
  const pending = [rootPath];
  while (pending.length) {
    const nodePath = pending.pop();
    if (selected.has(nodePath)) continue;
    const node = lock.packages[nodePath];
    validatePackageNode(node, nodePath);
    const copied = clone(node);
    delete copied.dev;
    delete copied.devOptional;
    selected.set(nodePath, copied);
    const required = new Map(dependencyEntries(node.dependencies, `${nodePath}.dependencies`));
    const optional = new Map(dependencyEntries(node.optionalDependencies, `${nodePath}.optionalDependencies`));
    const peers = dependencyEntries(node.peerDependencies, `${nodePath}.peerDependencies`);
    for (const [name, range] of peers) {
      if (!required.has(name) && !optional.has(name)) {
        if (node.peerDependenciesMeta?.[name]?.optional) optional.set(name, range);
        else required.set(name, range);
      }
    }
    for (const name of new Set([...required.keys(), ...optional.keys()])) {
      const resolution = resolveNode(lock.packages, nodePath, name);
      if (!resolution && !optional.has(name)) throw new Error(`Required locked dependency ${name} is missing from the bundled audit closure.`);
      if (resolution) pending.push(resolution);
    }
  }
  const version = selected.get(rootPath).version;
  const fixtureManifest = {
    name: `orbit-bundled-runtime-audit-${packageName.replaceAll(/[@/]/g, '-')}`,
    version: '0.0.0', private: true, dependencies: { [packageName]: version }
  };
  if (manifest.overrides !== undefined) {
    validateOverrides(manifest.overrides);
    fixtureManifest.overrides = clone(manifest.overrides);
  }
  if (manifest.engines !== undefined) fixtureManifest.engines = clone(manifest.engines);
  if (typeof manifest.packageManager === 'string') fixtureManifest.packageManager = manifest.packageManager;
  const rootRecord = { name: fixtureManifest.name, version: fixtureManifest.version,
    dependencies: clone(fixtureManifest.dependencies) };
  if (fixtureManifest.engines) rootRecord.engines = clone(fixtureManifest.engines);
  const nodePaths = [...selected.keys()].sort();
  const fixtureLock = { name: fixtureManifest.name, version: fixtureManifest.version,
    lockfileVersion: lock.lockfileVersion, requires: true,
    packages: Object.fromEntries([['', rootRecord], ...nodePaths.map((nodePath) => [nodePath, selected.get(nodePath)])]) };
  return { manifest: fixtureManifest, lock: fixtureLock, nodePaths };
}

/** Keep every current/future browser advisory visible; only one proven Node-only origin is excluded. */
export function reviewBundledRuntimeAdvisories(report, fixtureLock, review, proof) {
  const failures = [];
  const dispositions = [];
  const fail = (message) => failures.push(message);
  const packages = fixtureLock?.packages;
  const reviewedNodes = review?.reviewedNodeVersions;
  const artifactValid = isRecord(review) && review.packageName === 'exceljs' && validVersion(review.version)
    && /^[a-f0-9]{64}$/.test(review.browserEntrySha256 || '')
    && isRecord(proof) && proof.valid === true && proof.version === review.version
    && proof.browserEntrySha256 === review.browserEntrySha256;
  if (!artifactValid) fail('Bundled ExcelJS artifact proof is missing or differs from its reviewed version/hash.');
  if (!isRecord(packages) || !isRecord(packages['']) || !isRecord(reviewedNodes)
    || packages[''].dependencies?.[review?.packageName] !== review?.version
    || packages['node_modules/exceljs']?.version !== review?.version) {
    fail('The derived audit fixture does not match the reviewed bundled package.');
  }
  const reviewedOrigins = review?.reviewedNodeOrigins;
  if (!Array.isArray(reviewedOrigins) || reviewedOrigins.length !== 1
    || Object.entries(knownOrigin).some(([key, value]) => reviewedOrigins[0]?.[key] !== value)) {
    fail('Only the exact reviewed moderate minimatch Node-only origin is supported.');
  }
  if (isRecord(reviewedNodes)) {
    for (const [nodePath, version] of Object.entries(reviewedNodes)) {
      if (!validNodePath(nodePath) || !validVersion(version) || packages?.[nodePath]?.version !== version) {
        fail('A reviewed Node-only package resolution differs from the derived fixture.');
      }
    }
  }
  if (isRecord(packages)) {
    for (const [nodePath, node] of Object.entries(packages)) {
      if (!nodePath) continue;
      try { validatePackageNode(node, nodePath); }
      catch { fail('The derived audit fixture contains an incomplete or non-registry package node.'); }
    }
  }
  if (!isRecord(report) || report.error !== undefined || report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)
    || !isRecord(report.metadata?.vulnerabilities)) {
    fail('The bundled runtime npm audit report is malformed or unavailable.');
    return { failures: [...new Set(failures)], dispositions };
  }
  const entries = report.vulnerabilities;
  if (Object.keys(entries).length > Object.keys(packages || {}).length - 1) {
    fail('The audit report exceeds the derived package closure.');
    return { failures: [...new Set(failures)], dispositions };
  }
  const observedCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  const validEntries = new Map();
  for (const [name, entry] of Object.entries(entries)) {
    if (!validName(name) || !isRecord(entry) || entry.name !== name || !severities.includes(entry.severity)
      || typeof entry.range !== 'string' || !entry.range.trim() || !Array.isArray(entry.nodes) || !entry.nodes.length
      || !Array.isArray(entry.via) || !entry.via.length) {
      fail('The bundled runtime report contains incomplete vulnerability evidence.');
      continue;
    }
    observedCounts[entry.severity] += 1;
    let validNodes = true;
    for (const nodePath of entry.nodes) {
      const node = packages?.[nodePath];
      if (!validNodePath(nodePath) || !isRecord(node) || !validVersion(node.version)
        || (node.name || nameAtPath(nodePath)) !== name || reviewedNodes?.[nodePath] !== node.version) {
        fail(`${name} has an unreviewed or unresolved locked vulnerability node.`);
        validNodes = false;
      }
    }
    if (new Set(entry.nodes).size !== entry.nodes.length) {
      fail(`${name} has duplicate locked vulnerability nodes.`);
      validNodes = false;
    }
    if (entry.severity === 'critical') fail(`${name} has a critical bundled runtime advisory.`);
    validEntries.set(name, { entry, validNodes });
  }
  const counts = report.metadata.vulnerabilities;
  const total = Object.values(observedCounts).reduce((sum, count) => sum + count, 0);
  if (severities.some((severity) => !Number.isInteger(counts[severity]) || counts[severity] !== observedCounts[severity])
    || counts.total !== total || total !== Object.keys(entries).length) {
    fail('The bundled runtime audit summary does not match its vulnerability records.');
  }

  let traversalSteps = 0;
  function originsFor(name, path) {
    traversalSteps += 1;
    if (traversalSteps > 4096) { fail('The bundled runtime advisory graph exceeds the traversal bound.'); return null; }
    if (path.length > 256) { fail('The bundled runtime advisory graph exceeds the review depth bound.'); return null; }
    if (path.includes(name)) { fail('The bundled runtime advisory dependency graph contains a cycle.'); return null; }
    const item = validEntries.get(name);
    if (!item) { fail('The bundled runtime advisory graph has an unresolved dependency reference.'); return null; }
    const result = [];
    for (const origin of item.entry.via) {
      if (typeof origin === 'string') {
        if (!validName(origin)) { fail('The bundled runtime advisory dependency reference is malformed.'); return null; }
        const referenced = originsFor(origin, [...path, name]);
        if (!referenced) return null;
        result.push(...referenced.map((leaf) => ({ ...leaf, path: [name, ...leaf.path] })));
      } else if (isRecord(origin) && validName(origin.name) && origin.dependency === origin.name
        && Number.isInteger(origin.source) && origin.source > 0 && typeof origin.url === 'string' && origin.url.trim()
        && typeof origin.range === 'string' && origin.range.trim() && severities.includes(origin.severity)) {
        result.push({ origin, path: [name] });
      } else { fail('The bundled runtime originating advisory is incomplete.'); return null; }
    }
    if (result.length > 1024) { fail('The bundled runtime advisory graph exceeds the path bound.'); return null; }
    return result;
  }

  for (const [name, { entry, validNodes }] of validEntries) {
    const leaves = originsFor(name, []);
    const known = leaves?.length && leaves.every(({ origin }) =>
      Object.entries(knownOrigin).every(([key, value]) => origin[key] === value));
    const leafNodes = validEntries.get('minimatch')?.entry.nodes || [];
    const legacyChain = leafNodes.length > 0 && leafNodes.every((nodePath) => packages?.[nodePath]?.version === '3.1.5'
      && Object.entries(packages || {}).some(([parentPath, parent]) => parent?.version === '7.2.3'
        && nameAtPath(parentPath) === 'glob' && parent.dependencies?.minimatch
        && resolveNode(packages, parentPath, 'minimatch') === nodePath));
    if (name === 'exceljs' && leaves?.some(({ origin }) => origin.name === 'exceljs')) {
      fail('A direct ExcelJS advisory affects the shipped browser component.');
    }
    if (!known || !legacyChain || entry.severity !== knownOrigin.severity) {
      fail(`${name} has a direct, mixed, or unreviewed bundled runtime advisory origin.`);
      continue;
    }
    if (artifactValid && validNodes && failures.length === 0) {
      dispositions.push({ name, disposition: 'excluded-node-only',
        nodes: entry.nodes.map((nodePath) => ({ path: nodePath, version: packages[nodePath].version })),
        origins: leaves.map(({ origin, path }) => ({ name: origin.name, url: origin.url,
          severity: origin.severity, range: origin.range, path })),
        reason: 'Exact reviewed Node-only matcher origin absent from the proven browser artifact and packaged Node runtime.' });
    }
  }
  return { failures: [...new Set(failures)], dispositions: failures.length ? [] : dispositions };
}
