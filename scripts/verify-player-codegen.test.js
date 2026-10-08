import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPlayerCodegen } from './verify-player-codegen.mjs';

const temporaryRoots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-codegen-layout-test-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'ReactCodegen'));
  fs.mkdirSync(path.join(root, 'ReactAppDependencyProvider'));
  for (const file of ['ReactCodegen/ReactCodegen.podspec', 'ReactCodegen/RCTModuleProviders.mm', 'ReactAppDependencyProvider/RCTAppDependencyProvider.mm']) {
    fs.writeFileSync(path.join(root, file), 'generated fixture');
  }
  return root;
}
afterEach(() => { for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('React Native 0.86 generated provider layout', () => {
  it('accepts the actual separated codegen and app dependency provider outputs', () => {
    expect(() => verifyPlayerCodegen(fixture())).not.toThrow();
  });
  it('rejects a missing module provider even when an obsolete flat file exists', () => {
    const root = fixture();
    fs.unlinkSync(path.join(root, 'ReactCodegen/RCTModuleProviders.mm'));
    fs.writeFileSync(path.join(root, 'RCTModuleProviders.mm'), 'obsolete flat artifact');
    expect(() => verifyPlayerCodegen(root)).toThrow();
  });
  it('rejects an empty generated app dependency provider', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'ReactAppDependencyProvider/RCTAppDependencyProvider.mm'), '');
    expect(() => verifyPlayerCodegen(root)).toThrow('Missing generated native artifact');
  });
});
