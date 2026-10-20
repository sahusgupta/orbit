import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentConnectedSourceFingerprint } from './connectedPrepare.mjs';

export const qaTarget = Object.freeze({ package: 'com.orbit.player.qa', serial: 'emulator-5580', port: '5039', activity: 'com.orbit.player.qa/.MainActivity' });
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const qaRoot = path.join(repositoryRoot, 'out/player-android-qa');
const artifactRoot = path.join(qaRoot, 'smoke');
const defaultAdb = 'C:/Users/herob/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const defaultApk = path.join(qaRoot, 'project/player-app/android/app/build/outputs/apk/release/app-release.apk');
const uiPath = '/data/local/tmp/orbit-player-qa-ui.xml';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function adbArguments(args) { return ['-P', qaTarget.port, '-s', qaTarget.serial, ...args]; }
export function createSmokeEnvironment(host = process.env, root = qaRoot) {
  const environment = {};
  for (const key of ['Path', 'PATH', 'SystemRoot', 'SystemDrive', 'ComSpec', 'PATHEXT', 'OS', 'WINDIR', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    if (typeof host[key] === 'string') environment[key] = host[key];
  }
  const androidHome = path.join(root, 'android-user');
  return Object.assign(environment, {
    ANDROID_USER_HOME: androidHome, ADB_SERVER_SOCKET: 'tcp:127.0.0.1:5039', ANDROID_ADB_SERVER_PORT: '5039',
    ADB_VENDOR_KEYS: path.join(androidHome, 'adbkey'),
    USERPROFILE: path.join(root, 'user-home'), APPDATA: path.join(root, 'user-home/AppData/Roaming'),
    LOCALAPPDATA: path.join(root, 'user-home/AppData/Local'), TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'),
  });
}
export function assertGuestOffline(snapshot) {
  if (snapshot.state.trim() !== 'device' || snapshot.emulator.trim() !== '1' || snapshot.boot.trim() !== '1') throw new Error('The exact QA target must be a booted Android emulator.');
  if (snapshot.airplane.trim() !== '1' || snapshot.wifi.trim() !== '0' || snapshot.mobile.trim() !== '0') throw new Error('Guest airplane mode must be enabled and Wi-Fi/mobile data disabled before any app action.');
  if (snapshot.routes.trim()) throw new Error('Guest IPv4 routing must be empty before any app action.');
  if (/\bdefault\b/.test(snapshot.routes6)) throw new Error('Guest IPv6 default routing must be absent.');
  for (const name of ['eth0', 'wlan0']) {
    const line = snapshot.links.split(/\r?\n/).find(value => new RegExp(`\\b${name}(?:@[^:]+)?:`).test(value));
    if (line && !/\bstate DOWN\b/.test(line)) throw new Error(`Guest ${name} must remain DOWN.`);
  }
  if (!/Active default network:\s*(?:none|null)\b/i.test(snapshot.connectivity)) throw new Error('Guest connectivity must report no active default network.');
  return true;
}
function xmlValue(value) {
  return value.replace(/&#x([\da-f]+);|&#(\d+);|&(quot|apos|lt|gt|amp);/gi, (_match, hex, decimal, named) => hex ? String.fromCodePoint(parseInt(hex, 16)) : decimal ? String.fromCodePoint(Number(decimal)) : ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' })[named.toLowerCase()]);
}
export function parseHierarchy(xml) {
  if (!xml.includes('<hierarchy')) throw new Error('UI Automator did not return a hierarchy.');
  const nodes = [];
  const parents = [];
  for (const match of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (match[0] === '</node>') { parents.pop(); continue; }
    const attributes = {};
    for (const attribute of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) attributes[attribute[1]] = xmlValue(attribute[2]);
    const bounds = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attributes.bounds ?? '');
    const node = { ...attributes, parent: parents.at(-1) ?? null, rect: bounds ? bounds.slice(1).map(Number) : null };
    nodes.push(node);
    if (!match[2]) parents.push(node);
  }
  return nodes;
}
export function nodeMatches(node, selector) {
  // Native implicit button labels can include the Ionicons private-use glyph before the visible text.
  const labels = [node['content-desc'] ?? '', node.text ?? ''].map(value => value.replace(/[\uE000-\uF8FF]/g, '').trim().replace(/^,\s*|\s*,\s*$/g, ''));
  return typeof selector === 'string' ? labels.includes(selector) : labels.some(label => { selector.lastIndex = 0; return selector.test(label); });
}
export function fixtureInput(value) {
  if (!/^[a-zA-Z0-9 @._+-]+$/.test(value)) throw new Error('Only bounded synthetic ASCII fixture input is allowed.');
  if (value.length > 100) throw new Error('Fixture input is too long.');
  return value.replaceAll(' ', '%s');
}
export function isAllowedPermissionDenial(node, hierarchy) {
  const controller = 'com.google.android.permissioncontroller';
  const denialResources = ['com.google.android.permissioncontroller:id/permission_deny_button', 'com.android.permissioncontroller:id/permission_deny_button'];
  return node.package === controller && denialResources.includes(node['resource-id'])
    && node.clickable === 'true' && node.enabled === 'true' && ["Don't allow", 'Don\u2019t allow'].some(label => nodeMatches(node, label))
    && hierarchy.some(item => item.package === controller && /Orbit Player QA/.test(`${item.text ?? ''} ${item['content-desc'] ?? ''}`)
      && /location/i.test(`${item.text ?? ''} ${item['content-desc'] ?? ''}`));
}
const finalApkSha256 = '918109df71ec8cf83d54d32561493888c509c31aabfc1d42c414e61ca73ccc78';
// Local-guest creation/restoration below belongs to these historical artifacts.
// Current first-use onboarding requires Firebase auth; do not relax the artifact
// gates or add an offline auth bypass to execute those legacy scenarios.
const finalSourceSha256 = 'fbd9caea8f7f0786c4c0ba9b85f1ddbfcb427edec673fe2493f1bf59976c83f5';
const demoSanityApkSha256 = 'edaae05de85f38a891e0f25d28df3ff07ad1ee0235be1cc8d8c52d29af631295';
const demoSanitySourceSha256 = '82f64bce7402e3a5f5886b258d4c87ba851011e02ccbd170dd0523bffdf53060';
export function assertDemoSanityOptions(options) {
  assert(options.has('--demo-sanity') && options.has('--run') && !options.has('--fresh') && !options.has('--resume-last-two'), 'Demo sanity preserves the existing guest and cannot clear data or resume historical cases.');
  return true;
}
export function assertDemoSanityArtifact(apkSha256, source) {
  assert(apkSha256 === demoSanityApkSha256 && source?.sha256 === demoSanitySourceSha256 && source.files === 128, 'Demo sanity requires the exact reviewed rebuilt baseline APK and current original source.');
  return true;
}
export function assertResumeEvidence(previous) {
  assert(previous?.status === 'failed' && previous.settingsRestored === true
    && previous.apkSha256 === finalApkSha256 && previous.sourceFingerprint?.sha256 === finalSourceSha256
    && previous.sourceFingerprint.files === 128 && previous.checks?.length === 16
    && previous.checks.every(check => check.status === 'passed')
    && previous.checks[15].name === 'local Match preferences and manual origin persist across native cold relaunch'
    && previous.failure === 'Expected the exact Android QA location permission denial button; no other OS action is allowed.'
    && previous.target?.package === qaTarget.package && previous.target.serial === qaTarget.serial && previous.target.port === qaTarget.port,
  'Resume requires the preserved sixteen passing cases on the exact final artifact, restored settings, and only the observed permission-resource mismatch.');
  return true;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Artifact must be strictly inside the isolated QA output.');
  return target;
}

async function main() {
  const options = new Set(process.argv.slice(2));
  if (!options.has('--run')) { console.log('Prepared only. Run with --run after the parent confirms the QA APK and offline guest. Optional --install --fresh affect only com.orbit.player.qa.'); return; }
  assert([...options].every(option => ['--run', '--install', '--fresh', '--resume-last-two', '--demo-sanity'].includes(option)), 'Unknown option; target package, emulator and port cannot be overridden.');
  const resume = options.has('--resume-last-two');
  const demoSanity = options.has('--demo-sanity');
  if (demoSanity) assertDemoSanityOptions(options);
  assert(!resume || (!options.has('--install') && !options.has('--fresh')), 'Resume cannot install or clear the preserved QA profile.');
  const previousReportPath = path.join(artifactRoot, '2026-10-13T03-59-37-822Z/results.json');
  const previousReport = resume ? JSON.parse(fs.readFileSync(previousReportPath, 'utf8')) : null;
  if (resume) assertResumeEvidence(previousReport);
  assert(process.env.ORBIT_QA_GUEST_OFFLINE_CONFIRMED === '1', 'Parent guest-network confirmation is required before this manual engineering run.');
  const adbPath = process.env.ORBIT_QA_ADB_PATH || defaultAdb;
  assert(path.basename(adbPath).toLowerCase() === 'adb.exe' && fs.existsSync(adbPath), 'An approved local adb.exe is required.');
  const environment = createSmokeEnvironment();
  const report = { target: qaTarget, startedAt: new Date().toISOString(), checks: [], screenshots: [], launches: [], limitations: [
    'Android emulator only; no physical-device, iOS, screen-reader or pilot claims.',
    'Actual bundled PlayerApp and native components; synthetic invalid Firebase/Maps settings and unreachable loopback API.',
    'Demo saves and manual locations are in-memory. Local guest profile and preferences use actual device storage; no authenticated account sync proof.',
    'Offline preconditions and guarded UI outcomes do not prove connected authorization or hosted map tiles.',
    'Startup/gfxinfo are emulator observations, not physical-device 60fps acceptance.',
  ] };
  let preflightPassed = false;
  const adb = (args, binary = false, timeout = 30_000) => execFileSync(adbPath, adbArguments(args), { env: environment, windowsHide: true, encoding: binary ? undefined : 'utf8', timeout, maxBuffer: (binary ? 64 : 25) * 1024 * 1024 });
  const shell = (...args) => adb(['shell', ...args]);
  function preflight() {
    const snapshot = {
      state: adb(['get-state']), emulator: shell('getprop', 'ro.kernel.qemu'), boot: shell('getprop', 'sys.boot_completed'),
      airplane: shell('settings', 'get', 'global', 'airplane_mode_on'), wifi: shell('settings', 'get', 'global', 'wifi_on'),
      mobile: shell('settings', 'get', 'global', 'mobile_data'), routes: shell('ip', 'route'), routes6: shell('ip', '-6', 'route'),
      links: shell('ip', 'link'), connectivity: shell('dumpsys', 'connectivity'),
    };
    assertGuestOffline(snapshot);
    report.offline = { checkedAt: new Date().toISOString(), airplane: 1, wifi: 0, mobile: 0, ipv4RouteCount: 0, ipv6DefaultRoute: false, activeDefaultNetwork: 'none', interfaces: snapshot.links.split(/\r?\n/).filter(line => /\b(?:eth0|wlan0)(?:@[^:]+)?:/.test(line)).map(line => ({ name: line.match(/\b(eth0|wlan0)(?:@[^:]+)?:/)[1], state: 'DOWN' })) };
    preflightPassed = true;
    if (demoSanity) assert(adb(['reverse', '--list']).trim() === '', 'Current demo sanity requires no ADB reverse mappings.');
  }
  preflight();
  fs.mkdirSync(artifactRoot, { recursive: true });
  const runRoot = inside(artifactRoot, path.join(artifactRoot, new Date().toISOString().replace(/[:.]/g, '-')));
  fs.mkdirSync(runRoot);
  report.attemptDirectory = path.relative(repositoryRoot, runRoot).replaceAll('\\', '/');
  const fingerprintFile = path.join(qaRoot, 'source-fingerprint.json');
  if (fs.existsSync(fingerprintFile)) report.sourceFingerprint = JSON.parse(fs.readFileSync(fingerprintFile, 'utf8'));
  if (options.has('--install') || resume || demoSanity) {
    const apkPath = inside(qaRoot, path.resolve(process.env.ORBIT_QA_APK_PATH || defaultApk));
    if (demoSanity) assert(apkPath === defaultApk && fs.realpathSync(apkPath) === defaultApk, 'Demo sanity pins the ordinary baseline artifact path without aliases.');
    assert(fs.existsSync(apkPath), 'Standalone QA APK is not ready.');
    const digest = createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
    assert(/^[a-f\d]{64}$/i.test(process.env.ORBIT_QA_APK_SHA256 ?? '') && digest === process.env.ORBIT_QA_APK_SHA256.toLowerCase(), 'The parent-approved QA APK SHA-256 must match before install.');
    if (demoSanity) {
      const currentSource = currentConnectedSourceFingerprint();
      assertDemoSanityArtifact(digest, report.sourceFingerprint); assertDemoSanityArtifact(digest, currentSource);
      assert(process.env.ORBIT_QA_SOURCE_SHA256 === currentSource.sha256, 'Parent approval must include the freshly recomputed current original source.');
      report.recomputedSourceFingerprint = currentSource;
    }
    const aapt = path.join(qaRoot, 'sdk/build-tools/36.0.0/aapt.exe');
    assert(fs.existsSync(aapt), 'The isolated SDK aapt is required to validate the APK package.');
    const badging = execFileSync(aapt, ['dump', 'badging', apkPath], { env: environment, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
    assert(/^package: name='com\.orbit\.player\.qa'/m.test(badging) && /^launchable-activity: name='com\.orbit\.player\.qa\.MainActivity'/m.test(badging), 'APK must contain exactly the QA package and launch activity.');
    preflight();
    if (options.has('--install')) {
      const installed = adb(['install', '-r', apkPath], false, 60_000);
      assert(/\bSuccess\b/.test(installed), 'QA APK installation failed.');
    }
    report.apkSha256 = digest;
  }
  assert(/^package:\/data\/app\//m.test(shell('pm', 'path', qaTarget.package)), 'Only the standalone QA package may be started; it is not installed.');
  const activity = shell('cmd', 'package', 'resolve-activity', '--brief', qaTarget.package).trim().split(/\r?\n/).at(-1);
  assert(activity === qaTarget.activity || activity === `${qaTarget.package}/${qaTarget.package}.MainActivity`, 'Installed QA launcher must match MainActivity.');
  if (resume || demoSanity) {
    if (resume) assert(report.apkSha256 === finalApkSha256 && report.sourceFingerprint?.sha256 === finalSourceSha256, 'Resume source and artifact must remain unchanged.');
    const installedPath = shell('pm', 'path', qaTarget.package).trim();
    assert(/^package:\/data\/app\/[^\r\n]+\/com\.orbit\.player\.qa-[^/\r\n]+\/base\.apk$/.test(installedPath), 'Resume must inspect only the installed QA base APK.');
    assert(createHash('sha256').update(adb(['exec-out', 'cat', installedPath.slice(8)], true)).digest('hex') === report.apkSha256, 'Installed QA artifact differs from the approved final APK.');
    if (resume) report.resumeEvidence = { report: path.relative(repositoryRoot, previousReportPath).replaceAll('\\', '/'), priorPassedChecks: 16, apkSha256: finalApkSha256, sourceSha256: finalSourceSha256 };
    else report.demoSanity = { currentSource: true, preservedGuest: true, historicalCasesRepeated: false };
  }
  if (options.has('--fresh')) {
    preflight();
    assert(shell('pm', 'clear', qaTarget.package).trim() === 'Success', 'Could not clear the explicitly requested synthetic QA package.');
  }
  const settings = { night: shell('cmd', 'uimode', 'night').trim(), font: shell('settings', 'get', 'system', 'font_scale').trim(),
    window: shell('settings', 'get', 'global', 'window_animation_scale').trim(), transition: shell('settings', 'get', 'global', 'transition_animation_scale').trim(), animator: shell('settings', 'get', 'global', 'animator_duration_scale').trim() };
  const display = shell('wm', 'size').trim();
  const dimensions = [...display.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)].at(-1);
  assert(dimensions, 'QA display dimensions are unavailable.');
  const width = Number(dimensions[1]); const height = Number(dimensions[2]);
  const densities = [...shell('wm', 'density').matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  assert(densities.length, 'QA display density is unavailable.');
  const density = Number(densities.at(-1)[1]) / 160;
  report.display = { width, height, density };
  let lastHierarchyXml = '';
  const ui = () => { shell('uiautomator', 'dump', '--compressed', uiPath); lastHierarchyXml = adb(['exec-out', 'cat', uiPath]); return parseHierarchy(lastHierarchyXml); };
  const visible = node => node.rect && node.rect[2] > node.rect[0] && node.rect[3] > node.rect[1] && node.rect[0] >= 0 && node.rect[1] >= 0 && node.rect[2] <= width && node.rect[3] <= height;
  const find = (nodes, selector, { enabled = true, field = false, press = false, minHeightDp = 0 } = {}) => nodes.find(node => node.package === qaTarget.package && visible(node) && nodeMatches(node, selector) && (!enabled || node.enabled === 'true') && (!field || node.class === 'android.widget.EditText') && (!press || node.clickable === 'true') && (node.rect[3] - node.rect[1]) / density >= minHeightDp);
  let lastNodes = [];
  async function waitFor(selector, timeout = 15_000, options = {}) {
    const start = Date.now();
    do { lastNodes = ui(); const found = find(lastNodes, selector, options); if (found) return found; await sleep(200); } while (Date.now() - start < timeout);
    throw new Error(`UI selector not visible: ${String(selector)}`);
  }
  const tapNode = async node => {
    assert(node.package === qaTarget.package || isAllowedPermissionDenial(node, lastNodes), 'Only QA app nodes or the exact QA location permission denial may be tapped.');
    const [x1, y1, x2, y2] = node.rect; shell('input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))); await sleep(250);
  };
  const scroll = async (direction = 'down') => { const start = Math.round(height * (direction === 'down' ? .7 : .36)); const end = Math.round(height * (direction === 'down' ? .36 : .7)); shell('input', 'swipe', String(Math.round(width * .55)), String(start), String(Math.round(width * .55)), String(end), '450'); await sleep(200); };
  async function seek(selector, options = {}) {
    for (let index = 0; index < (options.scrolls ?? 7); index += 1) {
      lastNodes = ui(); const node = find(lastNodes, selector, options); if (node) return node;
      await scroll(options.direction ?? 'down');
    }
    throw new Error(`UI selector not found after bounded scrolling: ${String(selector)}`);
  }
  // UI Automator can expose a clipped strip of a button above the fixed navigation; reveal a usable target first.
  const tap = async (selector, options = {}) => tapNode(await seek(selector, { minHeightDp: 40, ...options, press: true }));
  async function input(selector, value) { await tapNode(await seek(selector, { field: true })); shell('input', 'text', fixtureInput(value)); shell('input', 'keyevent', 'KEYCODE_BACK'); await sleep(250); }
  async function capture(name, reuseHierarchy = false) {
    const destination = inside(runRoot, path.join(runRoot, `${name}.png`));
    fs.writeFileSync(destination, adb(['exec-out', 'screencap', '-p'], true));
    if (!reuseHierarchy) lastNodes = ui();
    fs.writeFileSync(destination.replace(/\.png$/, '.xml'), lastHierarchyXml);
    report.screenshots.push(path.relative(repositoryRoot, destination).replaceAll('\\', '/'));
  }
  async function check(name, task) { const start = Date.now(); await task(); report.checks.push({ name, status: 'passed', elapsedMs: Date.now() - start }); console.log(`PASS ${name}`); }
  async function launch(name) {
    preflight(); shell('am', 'force-stop', qaTarget.package);
    const start = Date.now(); const output = shell('am', 'start', '-W', '-n', qaTarget.activity);
    assert(!/Error:|Exception/.test(output) && /Status:\s*ok/.test(output), 'QA activity launch failed.');
    const observation = { name, wallMs: Date.now() - start, reported: Object.fromEntries([...output.matchAll(/^(ThisTime|TotalTime|WaitTime):\s*(\d+)$/gm)].map(match => [match[1], Number(match[2])])) };
    report.launches.push(observation);
    await waitFor(/Set up your profile|Hi, Android|Hi, Demo|Profile/);
    observation.uiObservedAfterStartMs = Date.now() - start; // Includes UI Automator polling; an observed upper bound, not a frame timestamp.
  }
  async function configure(scheme, font, reduced) {
    shell('cmd', 'uimode', 'night', scheme === 'dark' ? 'yes' : 'no');
    shell('settings', 'put', 'system', 'font_scale', String(font));
    for (const key of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) shell('settings', 'put', 'global', key, reduced ? '0' : '1');
    await sleep(400);
  }
  async function enterDemo() {
    await tap('Try demo account'); await waitFor('Hi, Demo'); await waitFor('Find games');
    const notification = find(ui(), 'Dismiss notification'); if (notification) await tapNode(notification);
  }
  async function findGames() { await tap('Find games'); await waitFor('Orbit Match'); await waitFor('Saved games, 0'); }
  async function swipeCard(direction, distance = .36, duration = 350) {
    const card = await seek(/^Open .+ at Demo /); const [x1, y1, x2, y2] = card.rect;
    const centerX = Math.round((x1 + x2) / 2); const y = Math.round((y1 + y2) / 2);
    const delta = Math.round(width * distance) * (direction === 'right' ? 1 : -1);
    shell('input', 'swipe', String(centerX - Math.round(delta / 2)), String(y), String(centerX + Math.round(delta / 2)), String(y), String(duration));
    await sleep(650); return card['content-desc'];
  }
  try {
    if (demoSanity) {
      await launch('current-source-demo-sanity');
      await check('current source: retained guest enters loaded fictional Match and saves a game', async () => {
        await tap('Profile'); await waitFor('Android QA Fixture'); await capture('current-guest-before-demo');
        await enterDemo(); await findGames();
        const first = await waitFor(/^Open .+ at Demo /);
        await tap(/^Save /); await waitFor('Saved games, 1');
        const next = await waitFor(/^Open .+ at Demo /); assert(next['content-desc'] !== first['content-desc'], 'Current demo must promote a different published game after Save.');
        await capture('current-demo-loaded-saved');
      });
      await check('current source: demo map keeps four fictional venue locations', async () => {
        await tap('Map');
        for (const [venue, city] of [['Demo Desert Casino','Las Vegas, NV'],['Demo Lakeside Poker Club','Chicago, IL'],['Demo River Card House','Austin, TX'],['Demo Summit Card House','Denver, CO']]) {
          await seek(new RegExp(`^Fictional demo location, ${city} - `)); await seek(`View games at ${venue}`);
        }
        await capture('current-demo-four-location-rows');
      });
      await check('current source: demo reset reloads games and exit preserves the guest', async () => {
        await tap('Profile', { direction: 'up' }); await tap('Reset demo games'); await waitFor('Hi, Demo'); await findGames(); await waitFor('Saved games, 0'); await capture('current-demo-reset');
        await tap('Profile', { direction: 'up' }); await tap('Exit demo'); await tap('Profile'); await waitFor('Android QA Fixture'); await capture('current-guest-after-demo');
      });
    } else {
    if (!resume) {
    for (const scheme of ['light', 'dark']) {
      await configure(scheme, 1, false); await launch(`${scheme}-cold-onboarding`);
      await check(`${scheme}: native onboarding enters fictional catalog`, async () => {
        await waitFor('Set up your profile'); await capture(`${scheme}-onboarding`); await enterDemo(); await capture(`${scheme}-home`); await findGames();
        await capture(`${scheme}-match-first-view`);
        await tap('Cancel request for 1/2 No Limit Holdem'); await waitFor(/These venues and games are fictional/);
        await capture(`${scheme}-scrolled-cancel-feedback`);
        await tap('Dismiss demo notice', { direction: 'up' });
        await tap('Discover games', { direction: 'up' });
      });
      await check(`${scheme}: short and vertical gestures retain the card; buttons have native 44dp height`, async () => {
        const before = await swipeCard('right', .025, 800); const retained = await seek(/^Open .+ at Demo /);
        assert(retained['content-desc'] === before, 'A short slow native gesture must not decide the game.');
        const [x1, y1, x2, y2] = retained.rect; const x = Math.round((x1 + x2) / 2); const y = Math.round((y1 + y2) / 2);
        shell('input', 'swipe', String(x), String(y), String(x + 5), String(Math.max(Math.round(height * .25), y - 150)), '500'); await sleep(250);
        const undoButton = await seek('Undo last swipe', { enabled: false, direction: 'up' });
        assert(undoButton.enabled === 'false', 'A native vertical scroll must not create a decision to undo.');
        assert((await seek(/^Open .+ at Demo /))['content-desc'] === before, 'Vertical scrolling must retain the game.');
        const save = await seek(/^Save /, { minHeightDp: 43.5 }); assert((save.rect[3] - save.rect[1]) / density >= 43.5, 'Fully revealed Save button must retain a 44dp native target.');
      });
      await check(`${scheme}: native pass gesture and undo`, async () => { const before = await swipeCard('left'); await tap('Undo last swipe', { direction: 'up' }); const returned = await seek(/^Open .+ at Demo /); assert(returned['content-desc'] === before, 'Undo must restore the same game after a native left swipe.'); await capture(`${scheme}-undo`); });
      await check(`${scheme}: native save gesture, real Saved and details back mode`, async () => {
        await swipeCard('right'); await tap('Saved games, 1', { direction: 'up' }); await tap(/^Details for saved /); await waitFor('Back to Matches');
        await capture(`${scheme}-saved-details`);
        await tap('Request a seat'); await waitFor(/These venues and games are fictional/); await tap('Dismiss demo notice', { direction: 'up' });
        await tap(/^Directions to Demo /); await waitFor(/These venues and games are fictional/); await tap('Dismiss demo notice', { direction: 'up' });
        await tap('Back to Matches', { direction: 'up' }); await waitFor(/^Remove saved /); await capture(`${scheme}-saved`);
        await tap(/^Remove saved /); await waitFor('No saved games yet');
      });
      await check(`${scheme}: optional manual origin, invalid coordinate and demo GPS suppression`, async () => {
        await tap('Profile', { direction: 'up' }); await tap('Match preferences'); await tap('Match travel preferences'); await tap('Choose discovery location');
        await waitFor('Demo uses manual sample search points. Device location stays off.');
        assert(!find(ui(), 'Use my device location', { enabled: false }), 'Demo must not offer the device GPS action.');
        await input('Search latitude', '91'); await input('Search longitude', '-97.7431'); await tap('Use selected search point');
        await waitFor('Latitude must be -90 to 90 and longitude -180 to 180.');
        // Reset field with bounded select-all/delete keys, only the currently focused QA input.
        await tap('Search latitude', { field: true, direction: 'up' }); shell('input', 'keycombination', '113', '29'); shell('input', 'keyevent', 'KEYCODE_DEL'); shell('input', 'text', '30.2672'); shell('input', 'keyevent', 'KEYCODE_BACK');
        await tap('Use selected search point'); await waitFor('Selected map location'); await capture(`${scheme}-manual-location`);
        await tap('Clear discovery location'); await waitFor('No location selected. Choose an area to use a travel radius.');
      });
      await check(`${scheme}: reset, native large font and OS scheme switch`, async () => {
        await tap('Discover games', { direction: 'up' }); await tap(/^Save /); await tap('Profile', { direction: 'up' }); await tap('Reset demo games');
        await waitFor('Hi, Demo'); await findGames();
        await tap('Profile', { direction: 'up' }); await tap('Exit demo');
        // Android may recreate the activity for fontScale; establish enlarged text before entering the in-memory preview.
        await configure(scheme, 1.5, true); await launch(`${scheme}-large-font-cold`); await enterDemo(); await findGames(); await capture(`${scheme}-match-first-view-large`); await seek(/^Save /); await capture(`${scheme}-match-large-reduced`);
        await tap('Profile', { direction: 'up' }); await tap('Match preferences'); await seek('Match games preferences'); await capture(`${scheme}-preferences-large`);
        await seek('Save Match preferences', { minHeightDp: 43.5 }); await capture(`${scheme}-preferences-controls-large`);
        await configure(scheme === 'dark' ? 'light' : 'dark', 1.5, true); await waitFor('Save Match preferences', 15_000, { minHeightDp: 43.5 }); await capture(`${scheme}-live-scheme-switch`);
        await tap('Profile', { direction: 'up' }); await tap('Exit demo'); await waitFor('Set up your profile'); await configure(scheme, 1, false);
      });
      await check(`${scheme}: demo history stays ephemeral after native cold relaunch`, async () => {
        await enterDemo(); await findGames(); await tap(/^Save /); await waitFor('Saved games, 1'); await launch(`${scheme}-demo-cold-relaunch`);
        await waitFor('Set up your profile'); await enterDemo(); await findGames(); await waitFor('Saved games, 0');
        await tap('Profile', { direction: 'up' }); await tap('Exit demo'); await waitFor('Set up your profile');
      });
    }
    await configure('light', 1, true);
    await check('native local guest profile age gate and restoration; no sign-in action', async () => {
      await input('Name', 'Android QA Fixture'); await tap('Continue'); await input('Email', 'android.qa@example.invalid'); await tap('Continue');
      await waitFor('Phone Number'); await tap('Continue'); await waitFor('Home Area');
      const gated = await seek('Start exploring', { enabled: false }); assert(gated.enabled === 'false', 'Adult declaration must gate completion.');
      await tap('I confirm that I am 18 or older'); await tap('Start exploring'); await waitFor('Hi, Android'); await tap('Profile');
      await waitFor('Android QA Fixture'); await capture('local-guest-profile'); await launch('local-profile-cold-relaunch');
      await tap('Profile'); await waitFor('Android QA Fixture');
      assert(!find(ui(), 'Account connected'), 'Synthetic offline profile must remain a local guest.');
    });
    await check('local Match preferences and manual origin persist across native cold relaunch', async () => {
      await tap('Match preferences'); await waitFor('Orbit Match'); await tap('Match availability preferences'); await tap('Require open seats now');
      await tap('Save Match preferences'); await waitFor('Discover games'); await tap('Profile', { direction: 'up' }); await tap('Match preferences');
      await tap('Match travel preferences'); await tap('Choose discovery location'); await input('Search latitude', '30.2672'); await input('Search longitude', '-97.7431'); await tap('Use selected search point');
      await launch('local-preferences-cold-relaunch'); await tap('Profile'); await tap('Match preferences'); await tap('Match travel preferences'); await waitFor('Selected map location');
      await tap('Match availability preferences'); const seats = await seek('Require open seats now'); assert(seats.checked === 'true', 'Guest preference must remain selected after native cold launch.'); await capture('local-preferences-restored');
    });
    } else {
      await configure('light', 1, true); await launch('resume-final-two-local-guest');
      await tap('Profile'); await waitFor('Android QA Fixture');
      await tap('Match preferences'); await tap('Match travel preferences'); await waitFor('Selected map location');
      await tap('Match travel preferences'); // Restore the closed disclosure expected at case 17's original entry.
    }
    await check('native OS location denial preserves manual origin and offers manual fallback', async () => {
      await tap('Match travel preferences', { direction: 'up' }); await tap('Choose discovery location'); await waitFor('Current: Selected map location');
      await tap('Use my device location');
      let denial = null;
      const started = Date.now();
      do { lastNodes = ui(); denial = lastNodes.find(node => visible(node) && isAllowedPermissionDenial(node, lastNodes)); if (denial) break; await sleep(150); } while (Date.now() - started < 8_000);
      assert(denial, 'Expected the exact Android QA location permission denial button; no other OS action is allowed.');
      assert(Date.now() - started < 10_000, 'Permission-dialog instrumentation exceeded its safe denial budget; no permission action was taken.');
      // Reuse the immediately preceding hierarchy so screenshot instrumentation does not consume the one-fix timeout.
      await capture('local-guest-location-permission', true); await tapNode(denial);
      await waitFor('Location permission was not granted. Choose a point manually instead.'); await waitFor('Current: Selected map location');
      await capture('local-guest-location-denied-manual-retained'); await tap('Apply search location');
      await waitFor('Selected map location');
      report.locationPermission = { requestedBy: qaTarget.package, action: 'denied', controller: denial.package, resourceId: denial['resource-id'], physicalCoordinatesRead: false, manualOriginRetained: true };
    });
    await check('demo reset and exit preserve restored local guest profile', async () => {
      await tap('Profile', { direction: 'up' }); await tap('Try demo account'); await waitFor('Hi, Demo'); await tap('Profile'); await waitFor('Demo profile');
      await capture('demo-profile'); await tap('Clubs');
      for (const venue of ['Demo Lakeside Poker Club', 'Demo River Card House']) {
        await tap(`${venue}, Active`, { direction: 'up' });
        const selected = await waitFor(`${venue}, Active`); assert(selected.selected === 'true', 'Club selection must expose its actual accessibility selection state.');
      }
      await seek(/Demo membership only\. Venue check-in is unavailable/); await capture('demo-clubs');
      const allLabels = ui().map(node => `${node['content-desc'] ?? ''} ${node.text ?? ''}`).join('\n');
      assert(!/Membership check-in QR|Generate membership check-in code|Refresh membership check-in code/.test(allLabels), 'Demo must suppress a scannable membership credential.');
      await tap('Map');
      for (const venue of ['Demo Desert Casino', 'Demo Lakeside Poker Club', 'Demo River Card House', 'Demo Summit Card House']) await seek(`View games at ${venue}`);
      await capture('demo-map-venue-list');
      await tap('Profile', { direction: 'up' }); await tap('Exit demo'); await tap('Profile'); await waitFor('Android QA Fixture');
    });
    }
    preflight();
    fs.writeFileSync(path.join(runRoot, 'gfxinfo.txt'), shell('dumpsys', 'gfxinfo', qaTarget.package));
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error instanceof Error ? error.message : String(error);
    try { await capture('failure'); } catch (captureError) { report.captureFailure = String(captureError); }
    throw error;
  } finally {
    if (preflightPassed) {
      try {
        const previousNight = /Night mode:\s*(\w+)/i.exec(settings.night)?.[1];
        if (previousNight && ['yes', 'no', 'auto', 'custom'].includes(previousNight)) shell('cmd', 'uimode', 'night', previousNight);
        const restore = (scope, key, value) => value === 'null' ? shell('settings', 'delete', scope, key) : shell('settings', 'put', scope, key, value);
        restore('system', 'font_scale', settings.font);
        restore('global', 'window_animation_scale', settings.window); restore('global', 'transition_animation_scale', settings.transition); restore('global', 'animator_duration_scale', settings.animator);
        report.settingsRestored = true;
      } catch (restoreError) { report.settingsRestored = false; report.restoreError = String(restoreError); }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(runRoot, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(artifactRoot, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, settingsRestored: report.settingsRestored, report: 'out/player-android-qa/smoke/results.json' }));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
