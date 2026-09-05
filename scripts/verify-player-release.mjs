import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyPlayerAssets } from './verify-player-assets.mjs';
import { reviewedPlayerCollectedDataTypes } from './player-privacy-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const json = (relativePath) => JSON.parse(read(relativePath));
const require = createRequire(import.meta.url);
const {
  PRODUCTION_ORIGIN,
  validateProductionEnvironment,
  v1DisabledFeatureVariables
} = require('../player-app/release-config.cjs');

const rootPackage = json('package.json');
const playerPackage = json('player-app/package.json');
const apiPackage = json('apps/api/package.json');
const webPackage = json('player-web/package.json');
const app = json('player-app/app.json').expo;
const eas = json('player-app/eas.json');
const failures = [];
const requireMatch = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const [name, manifest] of Object.entries({ root: rootPackage, player: playerPackage, api: apiPackage, web: webPackage })) {
  requireMatch(manifest.packageManager === 'npm@10.9.2', `${name} packageManager must pin npm 10.9.2.`);
  requireMatch(manifest.engines?.node === '22.16.0', `${name} engines.node must pin Node 22.16.0.`);
  requireMatch(manifest.engines?.npm === '10.9.2', `${name} engines.npm must pin npm 10.9.2.`);
  requireMatch(!manifest.dependencies?.table_manager && !manifest.devDependencies?.table_manager, `${name} manifest must not create a circular local table_manager dependency.`);
}
for (const lockPath of ['package-lock.json', 'apps/api/package-lock.json', 'player-app/package-lock.json', 'player-web/package-lock.json']) {
  requireMatch(!read(lockPath).includes('node_modules/table_manager'), `${lockPath} must not contain a circular local table_manager package.`);
}
requireMatch(read('.nvmrc').trim() === '22.16.0', '.nvmrc must pin Node 22.16.0.');
requireMatch(read('.node-version').trim() === '22.16.0', '.node-version must pin Node 22.16.0.');

requireMatch(eas.cli?.version === '23.2.0', 'EAS CLI must be pinned exactly.');
requireMatch(eas.cli?.requireCommit === true, 'EAS builds must require a committed source state.');
requireMatch(eas.cli?.appVersionSource === 'remote', 'EAS build numbers must use the reviewed remote source.');
for (const profileName of ['development', 'preview', 'production']) {
  const profile = eas.build?.[profileName];
  requireMatch(profile?.node === '22.16.0', `${profileName} EAS profile must pin Node 22.16.0.`);
  requireMatch(profile?.npm === '10.9.2', `${profileName} EAS profile must pin npm 10.9.2.`);
  for (const flag of v1DisabledFeatureVariables) {
    requireMatch(profile?.env?.[flag] === 'false', `${profileName} EAS profile must explicitly disable ${flag}.`);
  }
}
try {
  validateProductionEnvironment(eas.build?.production?.env || {});
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}
requireMatch(eas.build?.production?.distribution === 'store', 'Production EAS profile must create a store build.');
requireMatch(eas.build?.production?.ios?.simulator === false, 'Production EAS profile must target physical iOS devices.');
requireMatch(eas.build?.production?.autoIncrement === true, 'Production EAS profile must auto-increment the remote build number.');

requireMatch(app.name === 'Orbit Player', 'Expo app name must be Orbit Player.');
requireMatch(app.version === '1.0.0', 'First-release marketing version must be 1.0.0.');
requireMatch(app.ios?.bundleIdentifier === 'com.orbit.player', 'iOS bundle identifier must be com.orbit.player.');
requireMatch(app.ios?.supportsTablet === false, 'The reviewed first release must remain iPhone-only.');
requireMatch(app.ios?.infoPlist?.ITSAppUsesNonExemptEncryption === false, 'Encryption declaration must remain explicit.');
requireMatch(app.scheme === undefined, 'Unused production URL schemes must remain absent.');
requireMatch(app.splash?.image === './assets/splash-icon-transparent.png', 'Expo must use the transparent splash artwork.');
requireMatch(app.icon === './assets/icon.png', 'Expo must retain the reviewed App Store icon.');
requireMatch(app.ios?.privacyManifests?.NSPrivacyTracking === false, 'The app-owned privacy manifest must explicitly disable tracking.');
requireMatch(
  JSON.stringify(app.ios?.privacyManifests?.NSPrivacyCollectedDataTypes) === JSON.stringify(reviewedPlayerCollectedDataTypes),
  'The app-owned privacy manifest must declare exactly the reviewed linked, non-tracking Player data types and purposes.'
);

for (const dependency of ['expo-auth-session', 'expo-dev-client', 'expo-web-browser', 'react-native-purchases']) {
  requireMatch(!playerPackage.dependencies?.[dependency], `Production Player dependency ${dependency} must be absent.`);
}
requireMatch(playerPackage.dependencies?.expo === '54.0.37', 'Expo CLI/runtime must be pinned exactly for this release.');
requireMatch(playerPackage.dependencies?.['expo-constants'] === '18.0.14', 'Expo Constants must be pinned to the SDK-compatible release.');
requireMatch(
  JSON.stringify(playerPackage.expo?.autolinking?.searchPaths) === JSON.stringify(['./node_modules']),
  'Expo autolinking must be constrained to the standalone Player dependency tree.'
);
requireMatch(playerPackage.dependencies?.['expo-splash-screen'] === '31.0.13', 'Expo splash plugin must use the SDK 54-compatible pinned version.');
requireMatch(playerPackage.dependencies?.['expo-crypto'] === '~15.0.9', 'Expo Crypto must remain an SDK-compatible direct dependency for native request identifiers.');
requireMatch(rootPackage.devDependencies?.['eas-cli'] === '23.2.0', 'Repository EAS CLI dependency must be pinned exactly outside the Expo project.');
requireMatch(!playerPackage.devDependencies?.['eas-cli'], 'Expo Doctor requires EAS CLI to remain outside the Player project dependencies.');
requireMatch(playerPackage.devDependencies?.['expo-doctor'] === '1.20.4', 'Expo Doctor must be pinned exactly.');
requireMatch(rootPackage.devDependencies?.['firebase-tools'] === '15.29.0', 'Firebase CLI must be pinned exactly.');
requireMatch(rootPackage.devDependencies?.['@firebase/rules-unit-testing'] === '5.0.2', 'Firebase rules test SDK must be pinned exactly.');
requireMatch(!playerPackage.scripts?.['submit:testflight']?.includes('--latest'), 'TestFlight submission must never select the latest build implicitly.');
requireMatch(playerPackage.scripts?.['submit:testflight'] === 'node scripts/submit-testflight.cjs', 'TestFlight submission must use the exact-build guard.');
const testFlightSubmissionGuard = read('player-app/scripts/submit-testflight.cjs');
requireMatch(testFlightSubmissionGuard.includes("require.resolve('eas-cli/bin/run'"), 'TestFlight submission must resolve the repository-locked EAS CLI.');
requireMatch(!/spawn(?:Sync)?\(\s*['\"]eas(?:\.cmd)?['\"]/.test(testFlightSubmissionGuard), 'TestFlight submission must not execute an ambient EAS CLI from PATH.');

const appConfig = read('player-app/app.config.js');
requireMatch(!/apps[\\/]api|readFileSync|require\(['"]fs['"]\)|dotenv/.test(appConfig), 'Expo app config must never load backend or dotenv files.');
requireMatch(appConfig.includes("require('./release-config.cjs')"), 'Expo app config must delegate to the reviewed allowlist validator.');
const iosReleasePluginPath = path.join(root, 'player-app', 'plugins', 'with-no-ios-url-schemes.cjs');
requireMatch(fs.existsSync(iosReleasePluginPath), 'Expo iOS release-policy plugin is missing.');
requireMatch(read('player-app/release-config.cjs').includes('./plugins/with-no-ios-url-schemes.cjs'), 'Expo config must apply the reviewed iOS release policy.');
const iosReleasePlugin = fs.readFileSync(iosReleasePluginPath, 'utf8');
requireMatch(
  iosReleasePlugin.includes('withInfoPlist') && iosReleasePlugin.includes('CFBundleURLTypes'),
  'Expo config must remove the default iOS bundle-identifier URL scheme.'
);
requireMatch(!iosReleasePlugin.includes('withXcodeProject'), 'The iOS URL-scheme plugin must not rewrite the reviewed privacy manifest.');
const firestoreIndexes = read('player-app/firestore.indexes.json');
requireMatch(!/privateGames/i.test(firestoreIndexes), 'Production Firestore indexes must not retain a private-games collection group.');

const nativeProductionFiles = filesUnder(path.join(root, 'player-app', 'src'))
  .filter((filePath) => /\.(?:ts|tsx)$/.test(filePath) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath));
const sourceContracts = nativeProductionFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
for (const [label, pattern] of [
  ['Player Premium', /Player Premium|usePlayerPremium|applePurchases|react-native-purchases/i],
  ['private-game client behavior', /PrivateGame|privateGames|private-game/i],
  ['venue checkout', /membership-checkout|createClubMembershipCheckout|connectedCheckout/i],
  ['operational tournament registration route', /\/player\/tournament-registrations/],
  ['unused social authentication', /expo-auth-session|googleWebClientId|googleIosClientId|googleAndroidClientId/i]
]) {
  requireMatch(!pattern.test(sourceContracts), `Production native source still contains ${label}.`);
}
requireMatch(sourceContracts.includes('/player/tournament-interests'), 'Production native source must use the nonbinding tournament-interest route.');
requireMatch(!sourceContracts.includes('Math.random'), 'Production native source must not use predictable randomness.');
const nativeSecureIdentifier = read('player-app/src/security/secureIdentifier.native.ts');
requireMatch(nativeSecureIdentifier.includes("from 'expo-crypto'"), 'Native request identifiers must use Expo Crypto.');
requireMatch(nativeSecureIdentifier.includes('validateSecureUuid'), 'Native secure UUID output must be validated before use.');
const authCleanupStorage = read('player-app/src/data/storage/playerStorageCore.ts');
requireMatch(authCleanupStorage.includes('pendingPlayerAuthCleanupStorageKey'), 'Accepted-deletion secure sign-out cleanup must remain durable across restart.');
requireMatch(!/const allPlayerStorageKeys = \[[^\]]*pendingPlayerAuthCleanupStorageKey/.test(authCleanupStorage), 'Profile clearing must preserve the accepted-deletion cleanup marker until secure sign-out finishes.');

const webProductionFiles = [
  ...filesUnder(path.join(root, 'player-web', 'app')),
  ...filesUnder(path.join(root, 'player-web', 'src'))
].filter((filePath) => /\.(?:ts|tsx)$/.test(filePath) && !/\.test\./.test(filePath));
const webProduction = webProductionFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')).join('\n');
for (const [label, pattern] of [
  ['operational tournament registration route', /\/player\/tournament-registrations/],
  ['registration CTA', /Register free|Registration confirmed|Confirm registration|Reserve your entry|Your entry is free/i],
  ['private-game marketing fixture', /Private Game ·|player-hosted game/i],
  ['removed Premium or checkout', /Player Premium|RevenueCat|membership-checkout|card-house checkout/i],
  ['unsupported player-origin marketing', /near you|near me|match your distance|distance sorting|updated \d+ seconds/i],
  ['unsupported distance-filter control', /<SelectField\s+label=["']Distance["']/i],
  ['invented game or venue fallback', /Club schedule|Location available from the club|Club location available|as scheduled inventory|\?\?\s*['"]Orbit (?:club|event)['"]/i],
  ['invented identity or preference default', /email\?\.split\(['"]@['"]\)|searchRadiusMiles:\s*20/i],
  ['raw-identity mutation identifier', /mutationId\s*=\s*`[^`]*(?:user\.uid|tournament\.id)/i],
  ['inferred day membership plan', /membership\?\.plan\s*===\s*['"]day['"]/i],
  ['fabricated account preview', /The Commerce Club|Hollywood Park Casino|West LA Poker Club|Annual membership|Day membership/i],
  ['fabricated game or queue preview', /You(?:'|’)re #3|Room notified|Seat Requested|\$\d+\s*\/\s*\$\d+|reaches the room operator immediately/i],
  ['unsupported seat-alert promise', /Notified the moment a seat opens/i]
]) {
  requireMatch(!pattern.test(webProduction), `Player Web production source still contains ${label}.`);
}
requireMatch(!webProduction.includes('https://schema.org/EventScheduled'), 'Player Web must not invent a tournament lifecycle status absent from the Player projection.');
requireMatch(webProduction.includes('getTournamentInterestState'), 'Player Web must enforce the venue-published tournament interest window.');

const controlledLegalFiles = [
  'apps/api/public/privacy.html',
  'apps/api/public/support.html',
  'apps/api/public/terms.html',
  'download-site/privacy.html',
  'download-site/support.html',
  'download-site/terms.html',
  'scripts/import-legal-documents.cjs',
  'player-web/app/privacy/page.tsx'
];
const controlledLegal = controlledLegalFiles.map(read).join('\n');
requireMatch(!controlledLegal.includes('Orbit Technologies LLC'), 'Repository-controlled legal material must not name the obsolete entity.');
requireMatch(controlledLegal.includes('Caminus Labs, LLC'), 'Repository-controlled legal material must identify Caminus Labs, LLC.');
requireMatch(!/OpenAI Codex|AI-development disclosure|AI-assisted development/.test(controlledLegal), 'Customer legal material must describe runtime data handling, not repository-development tools.');
for (const vendor of ['RevenueCat']) {
  requireMatch(!controlledLegal.includes(vendor), `Current v1 legal material must not name unused provider ${vendor}.`);
}

const playerReleaseMarkdownFiles = fs.readdirSync(path.join(root, 'player-app'))
  .filter((fileName) => fileName.endsWith('.md'))
  .map((fileName) => path.join(root, 'player-app', fileName));
const releaseDocumentation = [
  ...playerReleaseMarkdownFiles.map((filePath) => fs.readFileSync(filePath, 'utf8')),
  read('apps/api/README.md')
].join('\n');
requireMatch(!fs.existsSync(path.join(root, 'player-app', 'STORE_LISTING_DRAFT.md')), 'Superseded store-listing draft must remain removed.');
requireMatch(!fs.existsSync(path.join(root, 'player-app', 'PRIVACY_POLICY_DRAFT.md')), 'Superseded privacy-policy draft must remain removed.');
for (const [claim, pattern] of [
  ['active Player Premium/IAP setup', /(?:Player Premium|Apple In-App Purchase) (?:uses|is wired)|Create (?:an|the) App Store (?:Connect )?subscription/i],
  ['player-hosted feature marketing', /unlocks?[^.\n]*player-hosted|browse[^.\n]*private games?/i],
  ['implicit latest-build submission', /submit[^.\n]*latest successful|submit\s+--latest/i],
  ['operational legacy registration documentation', /tournament-registrations`?:\s*apply/i],
  ['active v1 checkout documentation', /membership-checkout`?:\s*create/i]
]) {
  requireMatch(!pattern.test(releaseDocumentation), `Release documentation still contains ${claim}.`);
}
requireMatch(controlledLegal.includes('Stripe Identity'), 'Current legal material must disclose the conditional hosted Stripe Identity flow.');
requireMatch(/Stripe[^<\n]*(?:not payment|does not use Stripe for payments)/i.test(controlledLegal), 'Legal material must distinguish Stripe Identity from disabled iOS payment and checkout behavior.');
for (const exactDisclosure of [
  'name, email address, optional phone number',
  'Firebase-verified email address',
  'optional expected-arrival time',
  'short-lived QR token itself contains no personal information',
  'capture method/time',
  'optional venue-published plan classification'
]) {
  requireMatch(controlledLegal.includes(exactDisclosure), `Current legal material is missing exact data disclosure: ${exactDisclosure}.`);
}
for (const negativeDisclosure of [
  'no paid premium subscription',
  'no player-hosted/private game feature',
  'no venue checkout',
  'no push notifications'
]) {
  requireMatch(controlledLegal.toLowerCase().includes(negativeDisclosure), `Current v1 legal material must truthfully disclose ${negativeDisclosure}.`);
}

const storePackagePath = path.join(root, 'player-app', 'APP_STORE_SUBMISSION.md');
requireMatch(fs.existsSync(storePackagePath), 'Machine-checkable App Store submission package is missing.');
if (fs.existsSync(storePackagePath)) {
  const storePackage = fs.readFileSync(storePackagePath, 'utf8');
  const subtitle = storePackage.match(/^Subtitle:\s*(.+)$/m)?.[1]?.trim() || '';
  requireMatch(subtitle.length > 0 && subtitle.length <= 30, 'App Store subtitle must contain 1-30 characters.');
  requireMatch(storePackage.includes('https://developer.apple.com/app-store/app-privacy-details/'), 'App Store package must link Apple’s current App Privacy details source.');
  requireMatch(!storePackage.includes('/help/app-store-connect/reference/app-information/app-privacy'), 'App Store package must not retain the invalid App Privacy reference URL.');
  for (const heading of [
    '## Listing metadata', '## App Review notes', '## Reviewer flow', '## App Privacy worksheet',
    '## Age-rating worksheet', '## Territory and legal review', '## Encryption and export compliance',
    '## Screenshot capture matrix', '## Permission inventory', '## TestFlight acceptance',
    '## Rollback plan', '## External launch gates'
  ]) {
    requireMatch(storePackage.includes(heading), `App Store package is missing ${heading}.`);
  }
  for (const statement of [
    'does not accept wagers, stakes, deposits, entry fees, or prize funds',
    'does not register the player or reserve a seat',
    'No private-game listings, Premium subscription, or venue checkout exist in this build'
  ]) {
    requireMatch(storePackage.includes(statement), `App Review notes are missing: ${statement}`);
  }
  for (const inventoryStatement of [
    '### Venue-directed payload inventory',
    'Firebase-verified email when the token provides one',
    'The short-lived QR token contains no personal information',
    'capture method/time',
    'Shared production rate limit'
  ]) {
    requireMatch(storePackage.includes(inventoryStatement), `App Store package is missing release evidence: ${inventoryStatement}.`);
  }
}

const apiReadme = read('apps/api/README.md');
for (const operationalGate of [
  'ORBIT_PLAYER_APP_CHECK_APP_IDS',
  'ORBIT_REQUIRE_PLAYER_APP_CHECK=true',
  'x-firebase-appcheck',
  '503 APP_CHECK_NOT_CONFIGURED',
  'process-local `Map`',
  'shared durable limiter'
]) {
  requireMatch(apiReadme.includes(operationalGate), `API operations documentation is missing: ${operationalGate}.`);
}
requireMatch(apiReadme.includes('operational Player Web'), 'App Check activation gate must cover the operational Player Web client.');
requireMatch(apiReadme.includes('every active client'), 'App Check activation gate must cover every active protected client.');
const apiEnvironmentExample = read('apps/api/.env.example');
for (const requiredVariable of [
  'ORBIT_MEMBERSHIP_QR_SECRET=',
  'ORBIT_MEMBERSHIP_QR_TTL_MS=120000',
  'ORBIT_LOG_HASH_SECRET=',
  'ORBIT_PLAYER_APP_CHECK_APP_IDS=',
  'ORBIT_REQUIRE_PLAYER_APP_CHECK=false'
]) {
  requireMatch(apiEnvironmentExample.includes(requiredVariable), `API environment catalog is missing: ${requiredVariable}.`);
}
requireMatch(apiReadme.includes('at least 32 characters'), 'QR secret documentation must state its minimum length.');
requireMatch(read('player-app/APP_STORE_SUBMISSION.md').includes('ORBIT_MEMBERSHIP_QR_SECRET'), 'App Store external gates must name the QR signing-secret deployment action.');
requireMatch(apiReadme.includes('process-ephemeral fallback'), 'Log-hash documentation must distinguish local fallback from hosted configuration.');
requireMatch(read('player-app/APP_STORE_SUBMISSION.md').includes('ORBIT_LOG_HASH_SECRET'), 'App Store external gates must name the log-hash secret deployment action.');
requireMatch(!apiEnvironmentExample.includes('orbitplayer://') && !apiReadme.includes('orbitplayer://'), 'Hosted identity callback examples must not restore the removed native URL scheme.');
requireMatch(apiEnvironmentExample.includes('ORBIT_IDENTITY_RETURN_URL=https://orbitapp-one.vercel.app/me/profile'), 'Hosted identity callback example must use the reviewed HTTPS Player Web route.');

const webProfileSource = read('player-web/src/data/player-profile.ts');
for (const requiredProfileBoundary of [
  'adultDeclarationVersion',
  'Confirm that you are 18 or older',
  "email: verifiedEmail",
  'updatedAt: serverTimestamp()'
]) {
  requireMatch(webProfileSource.includes(requiredProfileBoundary), `Player Web profile boundary is missing: ${requiredProfileBoundary}.`);
}
requireMatch(webProfileSource.includes('deleteField()'), 'Player Web profile writes must explicitly clear omitted optional fields.');
requireMatch(!/isTransientPlayerProfileReadError\(error\)\)\s*return fallbackPlayerProfile/.test(webProfileSource), 'Player Web must surface transient profile reads instead of treating them as new profiles.');
requireMatch(!read('download-site/public-config.mjs').includes('purchases'), 'Public support metadata must not advertise removed purchases.');

requireMatch(PRODUCTION_ORIGIN === 'https://orbitapp-one.vercel.app', 'Reviewed production origin changed without release-policy review.');

try {
  verifyPlayerAssets();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

if (failures.length) throw new Error(`Orbit Player release verification failed:\n- ${failures.join('\n- ')}`);
console.log('Orbit Player repository release contract passed: pinned tools, fail-closed config, conservative v1 surface, legal identity, store package, and artwork.');

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(target) : [target];
  });
}
