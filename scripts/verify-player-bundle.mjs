import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const forbiddenBundlePatterns = [
  ['server private-key material', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ['server Firebase private-key variable', /FIREBASE_PRIVATE_KEY/],
  ['server Firebase client-email variable', /FIREBASE_CLIENT_EMAIL/],
  ['Stripe secret variable', /STRIPE_SECRET_KEY/],
  ['Twilio server credential variable', /TWILIO_AUTH_TOKEN/],
  ['backend environment path', /apps[\\/]api[\\/]\.env/],
  ['removed Player Premium product', /Player Premium|player_premium|REVENUECAT/i],
  ['removed venue checkout route', /\/player\/membership-checkout/],
  ['removed operational tournament-registration route', /\/player\/tournament-registrations/],
  ['removed private-game implementation', /PrivateGame|privateGames|private-game/i],
  ['obsolete operator identity', /Orbit Technologies LLC/]
];

function filesUnder(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}

const executableTextExtensions = new Set(['.js', '.mjs', '.cjs', '.json', '.map', '.hbc', '.bundle']);

function mustBeInspectable(filePath) {
  return executableTextExtensions.has(path.extname(filePath).toLowerCase());
}

export function verifyPlayerBundle(bundleRoot) {
  assert.ok(fs.existsSync(bundleRoot), `Player export directory does not exist: ${bundleRoot}`);
  const exportedFiles = filesUnder(bundleRoot);
  const failures = [];
  let inspectedFiles = 0;
  let skippedBinaryAssets = 0;
  for (const filePath of exportedFiles) {
    const source = fs.readFileSync(filePath);
    if (source.includes(0)) {
      if (mustBeInspectable(filePath)) {
        failures.push(`${path.relative(bundleRoot, filePath)} is an uninspectable executable bundle artifact`);
      } else {
        skippedBinaryAssets += 1;
      }
      continue;
    }
    inspectedFiles += 1;
    const text = source.toString('utf8');
    for (const [label, pattern] of forbiddenBundlePatterns) {
      if (pattern.test(text)) failures.push(`${path.relative(bundleRoot, filePath)} contains ${label}`);
      pattern.lastIndex = 0;
    }
  }
  if (failures.length) throw new Error(`Orbit Player bundle verification failed:\n- ${failures.join('\n- ')}`);
  assert.ok(inspectedFiles > 0, 'Orbit Player bundle verification did not inspect any text files.');
  console.log(
    `Orbit Player bundle scan passed: ${inspectedFiles} inspectable files checked, ${skippedBinaryAssets} binary assets skipped, ${exportedFiles.length} files total.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPlayerBundle(path.resolve(process.argv[2] || 'player-app/dist-release'));
}
