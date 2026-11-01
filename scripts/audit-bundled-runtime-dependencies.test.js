import { describe, expect, it } from 'vitest';
import { productionPackagesFromTree } from './audit-bundled-runtime-dependencies.mjs';

describe('actual production dependency inventory', () => {
  const manifest = { name: 'synthetic', version: '1.0.0', dependencies: { 'electron-updater': '^6.8.9', exceljs: '^3.4.0' } };
  it('retains nested Node packages for artifact-boundary rejection', () => {
    expect(productionPackagesFromTree({ name: 'synthetic', version: '1.0.0', dependencies: {
      'electron-updater': { version: '6.8.9', dependencies: { semver: { version: '7.7.3' } } },
      exceljs: { version: '3.10.0', dependencies: { glob: { version: '7.2.3' } } }
    } }, manifest)).toEqual([{ name: 'electron-updater', version: '6.8.9' }, { name: 'semver', version: '7.7.3' },
      { name: 'exceljs', version: '3.10.0' }, { name: 'glob', version: '7.2.3' }]);
  });
  it.each([null, [], { dependencies: [] }, { dependencies: { glob: {} } },
    { problems: ['missing'], dependencies: {} }, { dependencies: { glob: { version: '7.2.3', invalid: true } } }
  ])('rejects incomplete production-tree evidence %j', tree => {
    expect(() => productionPackagesFromTree(tree, manifest)).toThrow();
  });
  it.each([
    {}, { name: 'synthetic' }, { name: 'synthetic', version: '1.0.0' },
    { name: 'synthetic', version: '1.0.0', dependencies: {} },
    { name: 'wrong-root', version: '1.0.0', dependencies: {} },
    { name: 'synthetic', version: '2.0.0', dependencies: {} }
  ])('rejects absent, incomplete or mismatched root evidence %j', tree => {
    expect(() => productionPackagesFromTree(tree, manifest)).toThrow();
  });
  it('rejects malformed nested versions instead of treating them as a different safe package', () => {
    const tree = { name: 'synthetic', version: '1.0.0', dependencies: {
      'electron-updater': { version: '6.8.9' }, exceljs: { version: '3.10.0', dependencies: { glob: { version: 'not-a-version' } } }
    } };
    expect(() => productionPackagesFromTree(tree, manifest)).toThrow();
  });
  it.each([
    { 'archive-helper': { name: 'glob', version: '7.2.3' } },
    { '../glob': { version: '7.2.3' } }
  ])('rejects aliased or malformed package identities %j', dependencies => {
    const tree = { name: 'synthetic', version: '1.0.0', dependencies: {
      'electron-updater': { version: '6.8.9' }, exceljs: { version: '3.10.0', dependencies }
    } };
    expect(() => productionPackagesFromTree(tree, manifest)).toThrow();
  });
  it.each([
    { optionalDependencies: { absent: '^1.0.0' } },
    { peerDependencies: { absent: '^1.0.0' }, peerDependenciesMeta: { absent: { optional: true } } }
  ])('recognizes npm long inventory empty optional placeholders %j', metadata => {
    const tree = { name: 'synthetic', version: '1.0.0', dependencies: {
      'electron-updater': { version: '6.8.9' }, exceljs: { version: '3.10.0', ...metadata,
        dependencies: { absent: {}, installed: { version: '1.0.0' } } }
    } };
    expect(productionPackagesFromTree(tree, manifest)).toEqual([
      { name: 'electron-updater', version: '6.8.9' }, { name: 'exceljs', version: '3.10.0' },
      { name: 'installed', version: '1.0.0' }
    ]);
  });
  it.each([
    {}, { optionalDependencies: [] }, { optionalDependencies: { absent: '' } },
    { peerDependenciesMeta: { absent: { optional: true } } },
    { peerDependencies: { absent: '^1.0.0' }, peerDependenciesMeta: { absent: { optional: 'true' } } }
  ])('does not treat an undeclared or malformed optional placeholder as absence %j', metadata => {
    const tree = { name: 'synthetic', version: '1.0.0', dependencies: {
      'electron-updater': { version: '6.8.9' }, exceljs: { version: '3.10.0', ...metadata, dependencies: { absent: {} } }
    } };
    expect(() => productionPackagesFromTree(tree, manifest)).toThrow();
  });
  it('rejects a populated missing node even when declared optional', () => {
    const tree = { name: 'synthetic', version: '1.0.0', dependencies: {
      'electron-updater': { version: '6.8.9' }, exceljs: { version: '3.10.0', optionalDependencies: { absent: '^1.0.0' },
        dependencies: { absent: { missing: true } } }
    } };
    expect(() => productionPackagesFromTree(tree, manifest)).toThrow();
  });
});
