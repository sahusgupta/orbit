import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adbArguments, assertGuestOffline, createSmokeEnvironment, fixtureInput, nodeMatches, parseHierarchy, qaTarget } from './smoke.mjs';
import { currentConnectedSourceFingerprint } from './connectedPrepare.mjs';
import { measureMatchGestureWindow } from './mapPerformance.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const qaRoot = path.join(repositoryRoot, 'out/player-android-qa');
const apkPath = path.join(qaRoot, 'project/player-app/android/app/build/outputs/apk/release/app-release.apk');
const adbPath = 'C:/Users/herob/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const uiPath = '/data/local/tmp/orbit-player-map-qa-ui.xml';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

// Exact current-source APK reviewed after successful offline build and compiled-boundary checks.
// No environment/CLI option can substitute a different approval policy.
export const mapArtifactPolicy = Object.freeze({
  sourceSha256: '6d4b38106a72fbaaaa95eb6e7d26067b027bca07693100142dc6cc0b56c71342',
  sourceFiles: 128,
  apkSha256: 'fb2a81bc5a4e70926b24d196e06008451541736cdc4d089a2ee6ff69844f741e',
  apkBytes: 45803451
});

export const mapFixtureVenues = Object.freeze([
  Object.freeze({ name: 'Stardust Sandbox Casino', city: 'Las Vegas, NV', games: Object.freeze(['5/10 No Limit Holdem', '4/8 Limit Holdem', 'Stardust Holdem Deep Stack']) }),
  Object.freeze({ name: 'Moonbeam Poker Club', city: 'Chicago, IL', games: Object.freeze(['2/5 No Limit Holdem', '1/2 Pot Limit Omaha', 'Moonlight Omaha Evening']) }),
  Object.freeze({ name: 'Wonderland Card House', city: 'Austin, TX', games: Object.freeze(['2/5 Pot Limit Omaha', 'Pocket Aces Freeroll']) }),
  Object.freeze({ name: 'Cloud Nine Card House', city: 'Denver, CO', games: Object.freeze(['1/3 No Limit Holdem', 'Cloud Nine Mixed Game Meetup']) })
]);

export function assertMapOptions(options) {
  assert(options instanceof Set && [...options].every(value => ['--run', '--install', '--measure-gestures'].includes(value)),
    'Only --run, --install and --measure-gestures are supported; guest data and fixed targets cannot be overridden.');
  assert(options.has('--run') || options.size === 0, 'Optional actions require explicit --run.');
  return true;
}

export function assertMapArtifact(policy, evidence) {
  assert(/^[a-f\d]{64}$/.test(policy.apkSha256 ?? '') && Number.isSafeInteger(policy.apkBytes) && policy.apkBytes > 0,
    'The current offline APK has not yet been reviewed and pinned.');
  assert(evidence.actualSha256 === policy.apkSha256 && evidence.actualBytes === policy.apkBytes
    && evidence.metadata?.sha256 === policy.apkSha256 && evidence.metadata.bytes === policy.apkBytes
    && evidence.metadata.appId === qaTarget.package, 'Only the exact reviewed current offline APK is accepted.');
  for (const source of [evidence.metadata.source, evidence.recordedSource, evidence.currentSource]) {
    assert(source?.sha256 === policy.sourceSha256 && source.files === policy.sourceFiles, 'Recorded and freshly recomputed original source must match the reviewed build.');
  }
  assert(evidence.approvals?.offline === '1' && evidence.approvals.apk === policy.apkSha256
    && evidence.approvals.source === policy.sourceSha256, 'Root must confirm the offline guest and exact source/APK before actions.');
  assert(evidence.ordinaryPath === true && evidence.metadataPathMatches === true, 'Only the ordinary fixed APK path without aliases is accepted.');
  return true;
}

export function assertMapGuest(snapshot) {
  assertGuestOffline(snapshot);
  assert(/^orbit_match_qa\nOK$/.test(snapshot.avd.replaceAll('\r', '').trim()), 'Only the dedicated orbit_match_qa guest is permitted.');
  assert(snapshot.reverses.trim() === '', 'Offline Map QA cannot use any ADB reverse mappings.');
  for (const name of ['eth0', 'wlan0']) {
    assert(snapshot.links.split(/\r?\n/).some(line => new RegExp(`\\b${name}(?:@[^:]+)?:`).test(line) && /\bstate DOWN\b/.test(line)), 'Both guest network interfaces must be explicitly present and DOWN.');
  }
  return true;
}

export function usableMapNode(node, display, { press = false, minHeightDp = 0, enabled = true, field = false, selected } = {}) {
  const rect = node?.rect;
  return node?.package === qaTarget.package && (!enabled || node.enabled === 'true') && (!field || node.class === 'android.widget.EditText')
    && (selected === undefined || node.selected === selected) && Array.isArray(rect) && rect.length === 4
    && rect.every(Number.isInteger) && rect[0] >= 0 && rect[1] >= 0 && rect[2] > rect[0] && rect[3] > rect[1]
    && rect[2] <= display.width && rect[3] <= display.height && (!press || node.clickable === 'true')
    && (rect[3] - rect[1]) / display.density >= minHeightDp;
}

export function selectMapNode(nodes, display, selector, extra = {}) {
  const matching = nodes.filter(node => usableMapNode(node, display, extra) && nodeMatches(node, selector));
  // Prefer the named close button to a same-label full-screen modal backdrop.
  if (extra.press) matching.sort((a, b) => (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]) - (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]));
  return matching[0];
}

export function fixtureFrontCard(nodes, display) {
  const fronts = [];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const venue of mapFixtureVenues) for (const game of venue.games) {
    const pattern = new RegExp(`^Open (${escape(game)}) at (${escape(venue.name)})(?:; [^\\r\\n]+)?$`);
    const front = nodes.find(node => usableMapNode(node, display, { press: true }) && nodeMatches(node, pattern));
    if (front) {
      const label = front['content-desc'] ?? '';
      const match = !/[\r\n]/.test(label) && pattern.exec(label);
      assert(match, 'The front card must expose its exact fictional game and venue in its accessible name.');
      fronts.push({ game: match[1], venue: match[2], label });
    }
  }
  assert(fronts.length === 1, 'Exactly one accessible front card from the eligible fictional inventory is required.');
  return fronts[0];
}

export function assertVenueDeck(venueName, observed, saved) {
  const venue = mapFixtureVenues.find(item => item.name === venueName);
  assert(venue && Array.isArray(observed), 'A fixed fictional target venue is required.');
  const expected = venue.games.filter(game => saved?.venue !== venueName || saved.game !== game).sort();
  assert(observed.every(item => item.venue === venueName), 'Map handoff exposed a different venue.');
  assert.deepEqual(observed.map(item => item.game).sort(), expected, 'Every eligible unsaved target game/event must appear exactly once.');
  return expected;
}

export function installedMapApkPath(output) {
  assert(/^package:\/data\/app\/[^\r\n]+\/com\.orbit\.player\.qa-[^/\r\n]+\/base\.apk$/.test(output.trim())
    && !output.includes('..'), 'Only the installed fixed QA base APK may be inspected.');
  return output.trim().slice('package:'.length);
}

export function isRestorableMapDisplaySettings(settings) {
  return /^Night mode: (yes|no|auto)$/.test(settings.night)
    && ['font', 'window', 'transition', 'animator'].every(key => settings[key] === 'null' || /^\d+(?:\.\d+)?$/.test(settings[key]));
}

export function isEmptyMapField(node, display, expectedHint, nodes = []) {
  if (!['Games, clubs, or stakes', 'Stakes'].includes(expectedHint)
    || !usableMapNode(node, display, { field: true }) || node.hint !== expectedHint) return false;
  if (expectedHint === 'Stakes' && node['content-desc'] !== 'Stakes') return false;
  if (expectedHint === 'Games, clubs, or stakes'
    && nodes.some(item => item.package === qaTarget.package && nodeMatches(item, 'Clear game search'))) return false;
  return node.text === '' || node.text === expectedHint;
}

export function mapDisplayRestorationCommands(settings) {
  assert(isRestorableMapDisplaySettings(settings), 'Only reviewed QA display values may be restored.');
  return [['cmd', 'uimode', 'night', settings.night.split(': ').at(-1)],
    ...[['system', 'font_scale', settings.font], ['global', 'window_animation_scale', settings.window],
      ['global', 'transition_animation_scale', settings.transition], ['global', 'animator_duration_scale', settings.animator]]
      .map(([namespace, key, value]) => value === 'null' ? ['settings', 'delete', namespace, key] : ['settings', 'put', namespace, key, value])];
}

async function main() {
  const options = new Set(process.argv.slice(2));
  assertMapOptions(options);
  if (!options.has('--run')) {
    console.log('Prepared only. No device or services contacted. Reviewed --run [--install] [--measure-gestures] requires exact source/APK and offline-guest approval.');
    return;
  }
  const runRoot = path.join(qaRoot, 'map-handoff-smoke', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(runRoot, { recursive: true });
  const report = { target: qaTarget, startedAt: new Date().toISOString(), checks: [], screenshots: [], settingsTouched: false, settingsRestored: null,
    limitations: ['Android emulator and fictional in-memory demo only; no iPhone, physical-device, authentication or provider proof.',
      'Offline native venue list and Map-to-Match handoffs; hosted tiles and Apple Maps navigation are not exercised.',
      'No API/Firebase services or ADB reverse mappings are used. Local guest storage is preserved.',
      'Gesture frame samples, if requested, are bounded emulator observations; no FPS or touch-latency acceptance.'] };
  const environment = createSmokeEnvironment();
  const adb = (args, binary = false, timeout = 30_000) => execFileSync(adbPath, adbArguments(args), { env: environment, windowsHide: true,
    encoding: binary ? undefined : 'utf8', timeout, maxBuffer: (binary ? 64 : 8) * 1024 * 1024 });
  const shell = (...args) => adb(['shell', ...args]);
  let preflightPassed = false, settingsTouched = false, oldSettings = null, display, lastNodes = [], lastXml = '';
  function preflight() {
    const snapshot = { state: adb(['get-state']), emulator: shell('getprop', 'ro.kernel.qemu'), boot: shell('getprop', 'sys.boot_completed'),
      avd: adb(['emu', 'avd', 'name']), airplane: shell('settings', 'get', 'global', 'airplane_mode_on'),
      wifi: shell('settings', 'get', 'global', 'wifi_on'), mobile: shell('settings', 'get', 'global', 'mobile_data'),
      routes: shell('ip', 'route'), routes6: shell('ip', '-6', 'route'), links: shell('ip', 'link'),
      connectivity: shell('dumpsys', 'connectivity'), reverses: adb(['reverse', '--list']) };
    assertMapGuest(snapshot); preflightPassed = true;
    report.offlineCheckedAt = new Date().toISOString();
  }
  const ui = () => { shell('uiautomator', 'dump', '--compressed', uiPath); lastXml = adb(['exec-out', 'cat', uiPath]); lastNodes = parseHierarchy(lastXml); return lastNodes; };
  const find = (nodes, selector, extra = {}) => selectMapNode(nodes, display, selector, extra);
  const scroll = async (direction = 'down') => {
    const ys = direction === 'down' ? [.70, .36] : [.36, .70];
    shell('input', 'swipe', String(Math.round(display.width * .55)), String(Math.round(display.height * ys[0])),
      String(Math.round(display.width * .55)), String(Math.round(display.height * ys[1])), '450'); await sleep(200);
  };
  async function seek(selector, extra = {}) {
    for (let index = 0; index < 9; index++) {
      const node = find(ui(), selector, extra); if (node) return node;
      await scroll(extra.direction ?? 'down');
    }
    throw new Error(`QA selector not fully visible after bounded scrolling: ${String(selector)}`);
  }
  async function waitFor(selector, extra = {}, timeout = 15_000) {
    const started = Date.now();
    do { const node = find(ui(), selector, extra); if (node) return node; await sleep(200); } while (Date.now() - started < timeout);
    throw new Error(`QA selector did not settle: ${String(selector)}`);
  }
  async function tapNode(node) {
    assert(usableMapNode(node, display, { press: true, minHeightDp: 40 }), 'Only a fully visible enabled QA app control may be tapped; no OS dialogs.');
    const [left, top, right, bottom] = node.rect;
    shell('input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))); await sleep(250);
  }
  const tap = async (selector, extra = {}) => tapNode(await seek(selector, { ...extra, press: true, minHeightDp: 40 }));
  async function capture(name) {
    fs.writeFileSync(path.join(runRoot, `${name}.png`), adb(['exec-out', 'screencap', '-p'], true)); ui();
    fs.writeFileSync(path.join(runRoot, `${name}.xml`), lastXml); report.screenshots.push(`${name}.png`);
  }
  async function check(name, task) {
    const started = Date.now(); await task(); report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - started });
    fs.writeFileSync(path.join(runRoot, 'progress.json'), JSON.stringify(report, null, 2)); console.log(`PASS ${name}`);
  }
  async function frontCard() {
    await seek(/^Open /, { direction: 'up', press: true }); return fixtureFrontCard(ui(), display);
  }
  async function changedFront(previous) {
    const started = Date.now();
    do {
      let next = null;
      try { next = fixtureFrontCard(ui(), display); } catch { /* A committing card may temporarily be disabled. */ }
      if (next && next.label !== previous.label) return next;
      await sleep(200);
    } while (Date.now() - started < 15_000);
    throw new Error('The swipe did not promote a different eligible card within the unchanged UI deadline.');
  }
  async function assertSaved(saved, captureName) {
    await tap('Saved games, 1', { direction: 'up' });
    await seek(`Remove saved ${saved.game}`, { press: true }); await seek(saved.venue, { direction: 'up' });
    await seek(`Details for saved ${saved.game}`, { press: true });
    if (captureName) await capture(captureName);
    await tap('Discover games', { direction: 'up' });
  }
  async function resetDemo() {
    await tap('Profile', { direction: 'up' }); await tap('Reset sample games'); await waitFor('Find games');
    await tap('Find games'); await waitFor('Orbit Match'); await waitFor('Saved games, 0');
  }
  function uniqueField() {
    const fields = ui().filter(node => usableMapNode(node, display) && node.class === 'android.widget.EditText');
    assert(fields.length === 1, 'The game search modal must expose exactly one QA input.'); return fields[0];
  }
  async function setConflictingFilters() {
    await tap('Search games', { direction: 'up' }); const field = uniqueField();
    assert(isEmptyMapField(field, display, 'Games, clubs, or stakes', lastNodes), 'Search starts empty before a new conflicting filter scenario.');
    await tapNode(field); shell('input', 'text', fixtureInput('MAP_QA_NO_MATCH')); shell('input', 'keyevent', 'KEYCODE_BACK');
    assert(uniqueField().text === 'MAP_QA_NO_MATCH' && lastNodes.some(node => node.package === qaTarget.package && nodeMatches(node, 'Clear game search')), 'The conflicting search must actually be entered.');
    await tap('Apply game search'); await tap('Show game filters', { direction: 'up' });
    for (const selector of ['All houses', 'All casinos']) {
      let node = await seek(selector, { press: true });
      if (node.selected !== 'true') { await tapNode(node); node = await waitFor(selector, { press: true, selected: 'true' }); }
      assert(node.selected === 'true', 'All-venue chip must become selected before explicitly clearing it.');
      await tapNode(node); await waitFor(selector, { press: true, selected: 'false' });
    }
    const favorites = await seek('Favorites', { press: true }); if (favorites.selected !== 'true') await tapNode(favorites);
    await waitFor('Favorites', { press: true, selected: 'true' });
    const stakes = await seek('Stakes', { field: true }); assert(isEmptyMapField(stakes, display, 'Stakes'), 'Only the empty labeled Stakes field may receive synthetic input.');
    await tapNode(stakes); shell('input', 'text', fixtureInput('999')); shell('input', 'keyevent', 'KEYCODE_BACK');
    assert((await seek('Stakes', { field: true })).text === '999', 'The conflicting stakes must actually be entered.');
    await tap('Apply game filters'); await waitFor('No more matching games');
  }
  async function assertClearedTransientFilters() {
    await tap('Search games', { direction: 'up' }); assert(isEmptyMapField(uniqueField(), display, 'Games, clubs, or stakes', lastNodes), 'Map handoff must clear the prior game query.');
    await tap('Close game search'); await tap('Show game filters', { direction: 'up' });
    assert((await seek('All', { press: true })).selected === 'true', 'Map handoff must restore All game types.');
    const stakes = await seek('Stakes', { field: true }); assert(isEmptyMapField(stakes, display, 'Stakes'), 'Map handoff must clear the conflicting stakes.');
    assert((await seek('Favorites', { press: true })).selected === 'false', 'Map handoff must clear the conflicting Favorites filter.');
    assert((await seek('All houses', { direction: 'up', press: true })).selected === 'false'
      && (await seek('All casinos', { press: true })).selected === 'false', 'A single selected venue must replace both all-venue selections.');
    await tap('Apply game filters');
  }
  async function mapVenue(venue) {
    await tap('Map');
    await seek('Venue map', { direction: 'up' });
    await seek(new RegExp(`^Fictional venue, ${venue.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: -|$)`));
    await tap(`View games at ${venue.name}`); await waitFor('Orbit Match');
  }
  async function exhaustVenue(venue, saved) {
    const observed = [], expectedCount = venue.games.filter(game => saved.venue !== venue.name || saved.game !== game).length;
    for (let index = 0; index < expectedCount; index++) {
      const card = await frontCard(); assert(card.venue === venue.name, 'Only selected-venue cards may be passed.'); observed.push(card);
      await tap(`Pass ${card.game}`); await sleep(450);
    }
    await waitFor('No more matching games'); assertVenueDeck(venue.name, observed, saved);
    return observed.map(({ game, venue: name }) => ({ game, venue: name }));
  }
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(qaRoot, 'apk-artifact.json'), 'utf8'));
    const buffer = fs.readFileSync(apkPath), currentSource = currentConnectedSourceFingerprint();
    assertMapArtifact(mapArtifactPolicy, { actualSha256: sha256(buffer), actualBytes: buffer.length, metadata,
      recordedSource: JSON.parse(fs.readFileSync(path.join(qaRoot, 'source-fingerprint.json'), 'utf8')), currentSource,
      approvals: { offline: process.env.ORBIT_QA_GUEST_OFFLINE_CONFIRMED, apk: process.env.ORBIT_MAP_QA_APK_SHA256, source: process.env.ORBIT_MAP_QA_SOURCE_SHA256 },
      ordinaryPath: fs.realpathSync(apkPath) === apkPath, metadataPathMatches: path.resolve(metadata.apk) === apkPath });
    report.apkSha256 = sha256(buffer); report.sourceFingerprint = currentSource;
    const badging = execFileSync(path.join(qaRoot, 'sdk/build-tools/36.0.0/aapt.exe'), ['dump', 'badging', apkPath], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert(/^package: name='com\.orbit\.player\.qa'/m.test(badging) && /^launchable-activity: name='com\.orbit\.player\.qa\.MainActivity'/m.test(badging));
    preflight();
    if (options.has('--install')) assert(/\bSuccess\b/.test(adb(['install', '-r', apkPath], false, 60_000)), 'QA installation failed.');
    const installed = installedMapApkPath(shell('pm', 'path', qaTarget.package));
    assert(sha256(adb(['exec-out', 'cat', installed], true)) === mapArtifactPolicy.apkSha256, 'Installed QA APK differs from the reviewed artifact.');
    const activity = shell('cmd', 'package', 'resolve-activity', '--brief', qaTarget.package).trim().split(/\r?\n/).at(-1);
    assert([qaTarget.activity, `${qaTarget.package}/${qaTarget.package}.MainActivity`].includes(activity));
    const dimensions = [...shell('wm', 'size').matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)].at(-1);
    const densityMatch = [...shell('wm', 'density').matchAll(/(?:Physical|Override) density:\s*(\d+)/g)].at(-1);
    assert(dimensions && densityMatch); display = { width: Number(dimensions[1]), height: Number(dimensions[2]), density: Number(densityMatch[1]) / 160 };
    oldSettings = { night: shell('cmd', 'uimode', 'night').trim(), font: shell('settings', 'get', 'system', 'font_scale').trim(),
      window: shell('settings', 'get', 'global', 'window_animation_scale').trim(), transition: shell('settings', 'get', 'global', 'transition_animation_scale').trim(), animator: shell('settings', 'get', 'global', 'animator_duration_scale').trim() };
    assert(isRestorableMapDisplaySettings(oldSettings), 'Only bounded existing QA display settings may be restored.');
    preflight(); settingsTouched = true; report.settingsTouched = true;
    shell('cmd', 'uimode', 'night', 'no'); shell('settings', 'put', 'system', 'font_scale', '1');
    for (const key of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) shell('settings', 'put', 'global', key, '1');
    shell('am', 'force-stop', qaTarget.package);
    const launched = shell('am', 'start', '-W', '-n', qaTarget.activity); assert(/Status:\s*ok/.test(launched) && !/Error:|Exception/.test(launched));
    report.startup = Object.fromEntries([...launched.matchAll(/^(ThisTime|TotalTime|WaitTime):\s*(\d+)$/gm)].map(match => [match[1], Number(match[2])]));
    await waitFor(/Find your next game|Set up your profile|Find games|Profile/);
    const entryNodes = ui();
    if (!find(entryNodes, 'Try sample account', { press: true }) && !find(entryNodes, 'Set up your profile')) await tap('Profile');
    await tap('Try sample account'); await waitFor('Find games');
    if (find(ui(), 'Dismiss notification', { press: true })) await tap('Dismiss notification');
    await resetDemo();
    if (options.has('--measure-gestures')) {
      const baseline = await frontCard();
      report.gesturePrewarm = [];
      for (const direction of ['save', 'pass']) {
        const current = find(ui(), baseline.label, { press: true }); assert(current, 'The full front card must be visible for deliberate swipe prewarm.');
        const [left, top, right, bottom] = current.rect, x = Math.round((left + right) / 2), y = Math.round((top + bottom) / 2);
        const distance = Math.min(Math.round(display.width * .36), Math.floor(right - left - 16 * display.density)), half = Math.floor(distance / 2);
        assert(distance >= 120 * display.density, 'Prewarm swipe must cross the same deliberate threshold as the measured window.');
        const command = ['input', 'swipe', String(direction === 'save' ? x - half : x + half), String(y), String(direction === 'save' ? x + half : x - half), String(y), '350'];
        const observed = { direction, baseline: baseline.label, rect: current.rect, display, command, injectedAt: new Date().toISOString(), verified: false };
        report.gesturePrewarm.push(observed);
        const injectionStarted = Date.now(); shell(...command); observed.commandElapsedMs = Date.now() - injectionStarted;
        // Match the existing native driver's quiet interval before starting an
        // accessibility hierarchy dump. This is outside the measured window.
        await sleep(650);
        await waitFor(`Saved games, ${direction === 'save' ? 1 : 0}`);
        await changedFront(baseline);
        await tap('Undo last swipe', { direction: 'up' }); await waitFor('Saved games, 0');
        assert((await frontCard()).label === baseline.label, 'Prewarm Undo must restore the original card.');
        observed.verified = true;
      }
      const cardNode = find(ui(), baseline.label, { press: true });
      const cachedUndo = find(lastNodes, 'Undo last swipe', { enabled: false, minHeightDp: 40 });
      assert(cardNode && cachedUndo, 'Card and Undo geometry must share the same fully visible pre-window hierarchy.');
      report.measurementEnvironment = { display, night: 'no', fontScale: 1, animationScales: 1,
        host: { platform: os.platform(), architecture: os.arch(), release: os.release(), logicalCpuCount: os.cpus().length,
          totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() },
        guest: { api: shell('getprop', 'ro.build.version.sdk').trim(), abi: shell('getprop', 'ro.product.cpu.abi').trim() },
        refreshModes: shell('dumpsys', 'display').split(/\r?\n/).filter(line => /mActiveModeId=|mDefaultModeId=|mSupportedModes=/.test(line)).slice(0, 5).map(line => line.trim().slice(0, 500)),
        appPid: shell('pidof', qaTarget.package).trim() };
      let rawFrames = null;
      report.gestureMeasurement = await measureMatchGestureWindow({ geometry: { ...display, card: cardNode.rect, undo: cachedUndo.rect },
        shell: (args, timeout = 30_000) => { const output = adb(['shell', ...args], false, timeout); if (args.at(-1) === 'framestats') rawFrames = output; return output; } });
      if (rawFrames) fs.writeFileSync(path.join(runRoot, 'gesture-framestats.txt'), rawFrames);
      await waitFor('Saved games, 0');
      assert((await frontCard()).label === baseline.label, 'Measured Save/Pass Undo cycles must restore the top card.');
      await tap('Saved games, 0', { direction: 'up' }); await waitFor('No saved games yet'); await tap('Discover games', { direction: 'up' });
      report.gestureMeasurement.postStateRestored = true; await capture('gesture-post-state');
    }
    let saved;
    await check('demo inventory has four fictional venue/city rows and retains a real Saved record', async () => {
      saved = await frontCard(); await tap(`Save ${saved.game}`); await waitFor('Saved games, 1'); await assertSaved(saved, 'saved-before-map');
      report.savedRecord = { game: saved.game, venue: saved.venue }; await tap('Map');
      await seek('Venue map', { direction: 'up' });
      for (const venue of mapFixtureVenues) {
        await seek(new RegExp(`^Fictional venue, ${venue.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: -|$)`));
        await seek(`View games at ${venue.name}`, { press: true }); await capture(`map-${venue.city.split(',')[0].toLowerCase().replaceAll(' ', '-')}`);
      }
      report.locations = mapFixtureVenues.map(({ name, city }) => ({ name, city }));
      await tap('Games'); await tap('Find games'); await waitFor('Orbit Match'); await assertSaved(saved);
    });
    for (const [name, venue] of [['house', mapFixtureVenues[2]], ['casino', mapFixtureVenues[0]]]) {
      await check(`Map ${name} action clears conflicting transient filters and shows only its eligible games while preserving Saved`, async () => {
        await setConflictingFilters(); await capture(`${name}-conflicting-filters`); await mapVenue(venue);
        await assertClearedTransientFilters(); await capture(`${name}-handoff-first-card`);
        const observed = await exhaustVenue(venue, saved); await assertSaved(saved, `${name}-saved-retained`); await capture(`${name}-exhausted`);
        report[`${name}Handoff`] = { venue: venue.name, observed, queryCleared: true, stakesCleared: true, gameType: 'all', savedRetained: true };
      });
    }
    preflight(); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error instanceof Error ? error.message : 'Unknown local QA failure';
    if (preflightPassed && display) { try { await capture('failure'); } catch { report.failureCaptureUnavailable = true; } }
    process.exitCode = 1;
  } finally {
    if (oldSettings && settingsTouched && preflightPassed) {
      try {
        for (const command of mapDisplayRestorationCommands(oldSettings)) shell(...command);
        report.settingsRestored = shell('cmd', 'uimode', 'night').trim() === oldSettings.night && shell('settings', 'get', 'system', 'font_scale').trim() === oldSettings.font
          && [['window_animation_scale', oldSettings.window], ['transition_animation_scale', oldSettings.transition], ['animator_duration_scale', oldSettings.animator]].every(([key, value]) => shell('settings', 'get', 'global', key).trim() === value);
        assert(report.settingsRestored, 'QA display settings restoration failed.');
      } catch { report.settingsRestored = false; report.cleanupFailure = 'Could not restore exact prior QA display settings.'; report.status = 'failed'; process.exitCode = 1; }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, passed: report.checks.length, expected: 3, settingsRestored: report.settingsRestored,
      report: path.relative(repositoryRoot, path.join(runRoot, 'results.json')).replaceAll('\\', '/'), failure: report.failure ?? null }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Local Map QA setup failed before device actions.'); process.exitCode = 1; });
}
