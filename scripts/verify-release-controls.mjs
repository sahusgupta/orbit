import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');
const updater = read('electron/updateController.cjs');
const preload = read('electron/preload.cjs');
const main = read('electron/main.cjs');
const managementSmoke = read('scripts/run-management-smoke.mjs');
const publicSmoke = read('scripts/run-public-smoke.mjs');
const managementBrowser = read('tests/e2e/management-core-smoke.mjs');
const publicBrowser = read('tests/e2e/public-site-smoke.mjs');
const vite = read('vite.config.ts');
const fixtureBoundary = read('src/lib/e2eFixtureMode.ts');
const dependencyAudit = read('scripts/audit-production-dependencies.mjs');
const dependencyPolicy = JSON.parse(read('config/dependency-audit-policy.json'));
const apiPackage = JSON.parse(read('apps/api/package.json'));
const apiVercel = JSON.parse(read('apps/api/vercel.json'));
const playerWebPackage = JSON.parse(read('player-web/package.json'));

const failures = [];
const requireMatch = (condition, message) => {
  if (!condition) failures.push(message);
};
const includesAll = (source, values) => values.every((value) => source.includes(value));

requireMatch(release.includes('workflow_dispatch:'), 'Desktop releases must be manually dispatched.');
requireMatch(!/^\s*push\s*:/m.test(release), 'A push trigger must never publish or promote a desktop release.');
requireMatch(includesAll(release, [
  'source_sha:', 'release_version:', 'release_reason:', 'rollback_of:', 'release_channel:', 'promote:', 'promotion_confirmation:',
  'environment: production-release',
  'npm run security:dependencies', 'npm run check:release-controls', 'npm run audit:module-graph', 'npm run verify',
  'npm run check:renderer-bundle', 'npm run check:public-site', 'npm run check:brand',
  'npm run e2e:management', 'npm run e2e:public', 'npm run e2e:packaged',
  'CSC_IDENTITY_AUTO_DISCOVERY: "false"',
  'npx --no-install electron-builder --win --publish never --config.forceCodeSigning=false',
  'apps/api/src/stateMigration.test.js', 'apps/api/src/stateArchitecture.test.js', 'electron/accountMigration.test.js',
  'Get-FileHash', 'actions/attest@v4', 'overwrite: false', '--prerelease'
]), 'Release workflow is missing an immutable verification, packaging, canary, promotion, or rollback control.');
requireMatch(includesAll(release, ['group: orbit-desktop-release', 'cancel-in-progress: false']), 'Desktop release runs must be serialized without cancelling in-flight evidence.');
requireMatch(release.includes("promotion_confirmation must be exactly PROMOTE when promote=true."), 'Solo-maintainer promotion must require an explicit typed confirmation.');
requireMatch(includesAll(release, ['INPUT_PROMOTION_CONFIRMATION: ${{ inputs.promotion_confirmation }}', '$env:INPUT_PROMOTION_CONFIRMATION']), 'Release confirmation input must cross the workflow boundary through an environment variable.');
requireMatch(!release.includes('CSC_LINK') && !release.includes('CSC_KEY_PASSWORD'), 'The release workflow must not require signing credentials.');
requireMatch(!release.includes('Get-AuthenticodeSignature'), 'Authenticode verification must not gate the release workflow.');
requireMatch(includesAll(release, ['player-web/package-lock.json', 'npm ci --prefix player-web']), 'The release workflow must install locked Player Web dependencies before aggregate verification.');
requireMatch(packageJson.scripts['release:win:artifact']?.includes('--publish never'), 'The artifact command must never publish directly.');
requireMatch(!packageJson.scripts['dist:win:publish'], 'The legacy direct-publish command must be removed.');
requireMatch(/sourcemap:\s*false/.test(vite), 'Desktop renderer source maps must be explicitly disabled.');
requireMatch(dependencyAudit.includes("{ name: 'web', prefix: 'player-web' }"), 'The production dependency audit must cover Player Web.');
requireMatch(Array.isArray(dependencyPolicy.scopes?.web?.allowed), 'The dependency advisory policy must define a Player Web scope.');
requireMatch(apiPackage.engines?.node === '22.x', 'The production API runtime must stay aligned with CI Node 22.');
requireMatch(apiVercel.git?.deploymentEnabled === false, 'API Git auto-deployments must remain disabled so exact-SHA candidates can be tested before promotion.');
requireMatch(playerWebPackage.engines?.node === '22.x', 'The production Player Web runtime must stay aligned with CI Node 22.');

const downloadedHandler = updater.slice(updater.indexOf("autoUpdater.on('update-downloaded'"), updater.indexOf("nativeAutoUpdater.on('before-quit-for-update'"));
requireMatch(updater.includes('autoUpdater.autoInstallOnAppQuit = false'), 'The updater must not install automatically on app quit.');
requireMatch(downloadedHandler.includes('requiresUserApproval: true'), 'A downloaded update must enter an explicit approval state.');
requireMatch(!downloadedHandler.includes('installDownloadedUpdate()'), 'A download event must not invoke installation.');
requireMatch(includesAll(updater, ['update-install-blocked-state-not-preserved', "sendClientUpdateEvent('update-install-approved'", 'getStatus:']), 'Explicit installation must fail closed on state preservation and expose status.');
requireMatch(includesAll(preload, ["ipcRenderer.invoke('get-update-status')", "ipcRenderer.invoke('install-downloaded-update')", "ipcRenderer.on('update-status'"]), 'The reviewed preload bridge must expose update status and explicit installation.');
requireMatch(includesAll(main, ["ipcMain.handle('get-update-status'", "ipcMain.handle('install-downloaded-update'"]), 'Trusted main-process IPC handlers must own update installation.');

for (const gate of ['security:dependencies', 'check:release-controls', 'audit:module-graph', 'verify', 'check:renderer-bundle', 'check:public-site', 'check:brand', 'e2e:management', 'e2e:public']) {
  requireMatch(ci.includes(`npm run ${gate}`), `CI is missing npm run ${gate}.`);
}
requireMatch(includesAll(managementSmoke, ["'build'", "'preview'"]), 'Management smoke must build and serve the production bundle.');
requireMatch(includesAll(fixtureBoundary, ["apiUrl === 'http://127.0.0.1:4185'", "firebaseSync === 'false'", "hostname === '127.0.0.1'", "hostname === '::1'"]), 'Production-bundle fixture mode must remain bound to disabled sync, isolated API, and loopback runtime origins.');
requireMatch(includesAll(publicSmoke, ["'build'", "'preview'"]), 'Public smoke must build and serve the production bundle.');
for (const [name, browserSource] of [['management', managementBrowser], ['public', publicBrowser]]) {
  requireMatch(includesAll(browserSource, ["page.on('pageerror'", "page.on('console'", "page.on('requestfailed'"]), `${name} production smoke must fail on page, console, and request errors.`);
}
requireMatch(fs.existsSync(path.join(root, 'docs', 'operations', 'RELEASE_AND_ROLLBACK.md')), 'Release and rollback operations must be documented.');

if (failures.length) throw new Error(`Release control verification failed:\n- ${failures.join('\n- ')}`);
console.log('Release controls passed: manual immutable source, serialized solo promotion, staged API deployment, full gates, unsigned packaging, isolated packaged startup, checksums, provenance, rollback metadata, explicit install, and production smokes.');
