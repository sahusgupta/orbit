import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export function verifyPlayerCodegen(generatedRoot) {
  for (const relative of [
    'ReactCodegen/ReactCodegen.podspec',
    'ReactAppDependencyProvider/RCTAppDependencyProvider.mm',
    'ReactCodegen/RCTModuleProviders.mm'
  ]) {
    assert.ok(fs.statSync(path.join(generatedRoot, relative)).size > 0, `Missing generated native artifact: ${relative}`);
  }
}
