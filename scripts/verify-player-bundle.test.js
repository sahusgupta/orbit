import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPlayerBundle } from './verify-player-bundle.mjs';

const temporaryRoots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-player-bundle-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Orbit Player exported-bundle verification', () => {
  it('accepts inspectable production source while skipping non-executable binary assets', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'index.js'), 'console.log("Orbit Player");');
    fs.writeFileSync(path.join(root, 'icon.png'), Buffer.from([0, 1, 2, 3]));

    expect(() => verifyPlayerBundle(root)).not.toThrow();
  });

  it('rejects prohibited source in an inspectable bundle', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'index.js'), 'const route = "/player/tournament-registrations";');

    expect(() => verifyPlayerBundle(root)).toThrow('removed operational tournament-registration route');
  });

  it('fails closed when executable bytecode hides text behind NUL bytes', () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, 'index.hbc'),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('STRIPE_SECRET_KEY')])
    );

    expect(() => verifyPlayerBundle(root)).toThrow('uninspectable executable bundle artifact');
  });
});
