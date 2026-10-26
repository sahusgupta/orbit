import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertGuestOffline, createSmokeEnvironment, fixtureInput, nodeMatches, parseHierarchy } from './smoke.mjs';
import { connectedBootstrapPhases, connectedFixtureAccounts, connectedFixtureVenue, createConnectedEnvironment, fixedConnectedTarget } from './connectedServer.mjs';
import { createConnectedServerController } from './connectedProof.mjs';

// Separate package and output. Importing this module performs no ADB, SDK, network or server action.
export const connectedNativeTarget = Object.freeze({ package: 'com.orbit.player.qa.connected', activity: 'com.orbit.player.qa.connected/.MainActivity', serial: 'emulator-5580', port: '5039' });
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outputRoot = path.join(repositoryRoot, 'out/player-android-connected-qa');
const baselineRoot = path.join(repositoryRoot, 'out/player-android-qa');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const connectedFrontCardPattern = /^Open (\$1\/\$2 No Limit Holdem|\$2\/\$5 Pot Limit Omaha) at Native QA Card House(?:; [^\r\n]+)?$/;
export function connectedFrontGame(node) {
  const label = node?.['content-desc'];
  if (typeof label !== 'string' || /[\r\n]/.test(label)) return null;
  return connectedFrontCardPattern.exec(label)?.[1] ?? null;
}
export function connectedAdbArguments(args) { return ['-P', connectedNativeTarget.port, '-s', connectedNativeTarget.serial, ...args]; }
export function connectedReverseArguments(port, remove = false) {
  assert([14639, 18085, 19099].includes(port), 'Only the three fixed local emulator/API reverse ports are allowed.');
  return remove ? ['reverse', '--remove', `tcp:${port}`] : ['reverse', `tcp:${port}`, `tcp:${port}`];
}
export function assertConnectedReverses(output, expectedPorts = [14639, 18085, 19099]) {
  const rows = output.trim() ? output.trim().split(/\r?\n/).map(line => line.trim().split(/\s+/)) : [];
  assert(rows.length === expectedPorts.length && rows.every(row => row.length === 3 && /^[A-Za-z0-9_-]+$/.test(row[0])
    && expectedPorts.some(port => row[1] === `tcp:${port}` && row[2] === `tcp:${port}`))
    && new Set(rows.map(row => row[1])).size === rows.length, 'Connected QA requires exactly its owned three loopback reverse mappings and no others.');
  return true;
}
const diagnosticKinds = ['journal-restored', 'journal-durable', 'http-state', 'http-mutation', 'listener-started', 'listener-accepted', 'listener-stopped'];
const operationTypes = ['decide', 'remove', 'undo', 'preferences', 'event'];
const boundedId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function parseConnectedDiagnostics(lines) {
  const records = [];
  for (const line of lines.split(/\r?\n/)) {
    const start = line.indexOf('ORBIT_CONNECTED_QA ');
    if (start < 0) continue;
    let record; try { record = JSON.parse(line.slice(start + 19)); } catch { throw new Error('Malformed sanitized connected QA diagnostic.'); }
    const allowed = ['kind', 'ownerRole', 'revision', 'preferencesRevision', 'savedCount', 'passedCount', 'variants', 'preferredTime', 'pending', 'mutationId', 'operationType', 'listener', 'accepted'];
    assert(record && Object.keys(record).every(key => allowed.includes(key)) && diagnosticKinds.includes(record.kind)
      && ['a', 'b', 'other'].includes(record.ownerRole), 'Unreviewed connected diagnostic fields or owner.');
    for (const key of ['revision', 'preferencesRevision', 'savedCount', 'passedCount', 'listener', 'accepted']) {
      if (record[key] !== undefined) assert(record[key] === null && ['revision', 'preferencesRevision'].includes(key)
        || Number.isSafeInteger(record[key]) && record[key] >= 0, 'Invalid connected diagnostic count.');
    }
    assert(Array.isArray(record.variants) && record.variants.length <= 4 && record.variants.every(value => ['nlh', 'plo', 'limit-holdem', 'mixed'].includes(value))
      && ['any', 'day', 'evening'].includes(record.preferredTime), 'Invalid connected preference diagnostic.');
    if (record.pending !== undefined) assert(Array.isArray(record.pending) && record.pending.length <= 100
      && record.pending.every(value => value && Object.keys(value).length === 2 && boundedId(value.mutationId) && operationTypes.includes(value.type)), 'Invalid connected journal diagnostic.');
    if (record.mutationId !== undefined) assert(boundedId(record.mutationId) && operationTypes.includes(record.operationType), 'Invalid connected operation diagnostic.');
    records.push(record);
  }
  assert(records.length <= 2000, 'Connected diagnostic capture exceeded its bound.');
  return records;
}
export function assertConnectedArtifact(metadata, expectedHash, actualHash, expectedFixtureHash, expectedSourceHash) {
  assert(metadata?.appId === connectedNativeTarget.package && /^[a-f\d]{64}$/.test(expectedHash ?? '')
    && metadata.sha256 === expectedHash && actualHash === expectedHash
    && /^[a-f\d]{64}$/.test(expectedSourceHash ?? '') && metadata.source?.sha256 === expectedSourceHash && metadata.source.files === 128
    && /^[a-f\d]{64}$/.test(expectedFixtureHash ?? '') && metadata.fixture?.sha256 === expectedFixtureHash, 'Connected APK must match the parent-approved isolated artifact, original frozen source and reviewed fixture.');
}
export function assertConnectedApkPath(apk, resolved = fs.realpathSync(apk)) {
  const expected = path.join(repositoryRoot, 'out/c/player-app/android/app/build/outputs/apk/release/app-release.apk');
  assert(path.resolve(apk) === expected && resolved === expected, 'Only the fixed short connected project APK is allowed, without path aliases or escapes.');
  return expected;
}
export function connectedSmokeMode(options, seatRequestApproved) {
  assert(options instanceof Set && [...options].every(value => ['--run', '--install', '--fresh', '--seat-request'].includes(value)), 'Connected target cannot be overridden.');
  if (!options.has('--seat-request')) return 'match';
  assert(options.has('--run') && seatRequestApproved === '1', 'The local seat-request fixture requires separate root approval.');
  return 'seat-request';
}
export function assertSeatInspection(value) {
  const exact = (record, keys) => record && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).length === keys.length && Object.keys(record).every(key => keys.includes(key));
  const count = number => Number.isSafeInteger(number) && number >= 0 && number <= 100;
  const fixtureGame = id => [connectedFixtureVenue.gameId,connectedFixtureVenue.secondGameId].includes(id);
  assert(exact(value,['fixtureMode','venueRevision','waitlistAttemptCount','interestCount','interests','receiptCount','match'])
    && value.fixtureMode === 'seat-request' && count(value.venueRevision) && value.venueRevision >= 1
    && count(value.waitlistAttemptCount)
    && count(value.interestCount) && count(value.receiptCount) && Array.isArray(value.interests) && value.interests.length <= 10
    && value.interestCount === value.interests.length
    && value.interests.every(entry => exact(entry,['id','gameId','tableId','status','attendance','requestedAt'])
      && boundedId(entry.id) && fixtureGame(entry.gameId)
      && entry.tableId === (entry.gameId === connectedFixtureVenue.gameId ? 'native-qa-table-0' : 'native-qa-table-1')
      && entry.status === 'Arrived' && entry.attendance === 'arrived' && typeof entry.requestedAt === 'string' && Number.isFinite(Date.parse(entry.requestedAt)))
    && exact(value.match,['savedCount','waitlistSuccessEvents']) && count(value.match.savedCount)
    && Array.isArray(value.match.waitlistSuccessEvents) && value.match.waitlistSuccessEvents.length <= 10
    && value.match.waitlistSuccessEvents.every(event => exact(event,['eventId','at','ref','saveMutationId'])
      && boundedId(event.eventId) && boundedId(event.saveMutationId) && typeof event.at === 'string' && Number.isFinite(Date.parse(event.at))
      && exact(event.ref,['clubId','gameId','kind']) && event.ref.clubId === connectedFixtureVenue.clubId
      && fixtureGame(event.ref.gameId) && event.ref.kind === 'cash'), 'Seat QA inspection must contain only bounded owned noncontact request and conversion fields.');
  return value;
}
export function assertConnectedBootstrap(message, previous) {
  assert(message && Object.keys(message).length === 3 && Object.keys(message).every(key => ['type','phase','elapsedMs'].includes(key))
    && message.type === 'bootstrap' && connectedBootstrapPhases.includes(message.phase)
    && Number.isSafeInteger(message.elapsedMs) && message.elapsedMs >= 0 && message.elapsedMs <= 3_600_000
    && (!previous || message.elapsedMs >= previous.elapsedMs
      && connectedBootstrapPhases.indexOf(message.phase) > connectedBootstrapPhases.indexOf(previous.phase)), 'Connected bootstrap diagnostics must contain only ordered bounded phase timings.');
  return {phase:message.phase,elapsedMs:message.elapsedMs};
}
export function findSeatSystemUiWait(nodes, width, height) {
  const title = nodes.filter(node => node.package === 'android' && node['resource-id'] === 'android:id/alertTitle' && node.text === "System UI isn't responding");
  const wait = nodes.filter(node => node.package === 'android' && node['resource-id'] === 'android:id/aerr_wait' && node.text === 'Wait');
  assert(title.length === 1 && wait.length === 1 && wait[0].class === 'android.widget.Button'
    && wait[0].enabled === 'true' && wait[0].clickable === 'true' && wait[0].rect?.length === 4
    && wait[0].rect[0] >= 0 && wait[0].rect[1] >= 0 && wait[0].rect[2] <= width && wait[0].rect[3] <= height
    && wait[0].rect[2] > wait[0].rect[0] && wait[0].rect[3] > wait[0].rect[1], 'Only the exact observed Android System UI Wait recovery control is authorized.');
  return wait[0];
}
export async function verifyRejectedSeatUi({ seek, ui, capture }) {
  await seek('Cancel request for $2/$5 Pot Limit Omaha', { press:true });
  assert(!ui().some(node => node.package === connectedNativeTarget.package && nodeMatches(node,'Cancel request for $1/$2 No Limit Holdem')), 'Rejected Holdem request must not remain in the displayed My Games UI.');
  await capture('seat-my-games-after-rejection');
}
function childServer(fixtureMode = 'match') {
  const child = fork(fileURLToPath(new URL('./connectedServer.mjs', import.meta.url)), ['--run', ...(fixtureMode === 'seat-request' ? ['--seat-request'] : [])], {
    cwd: repositoryRoot, env: createConnectedEnvironment(process.env), execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  const controller = createConnectedServerController(child, { fixtureMode });
  const server = { ready: controller.ready, command: controller.request, dispose: controller.dispose, child, bootstrap:[], bootstrapInvalid:false };
  child.on('message', message => {
    if (message?.type !== 'bootstrap') return;
    try {
      assert(server.bootstrap.length < connectedBootstrapPhases.length,'Connected bootstrap exceeds its phase bound.');
      server.bootstrap.push(assertConnectedBootstrap(message,server.bootstrap.at(-1)));
    } catch { server.bootstrapInvalid = true; }
  });
  return server;
}

async function main() {
  const options = new Set(process.argv.slice(2));
  if (!options.has('--run')) { console.log('Prepared only. Requires separate root approval, fixed connected APK and local emulators; importing never runs native actions.'); return; }
  const fixtureMode = connectedSmokeMode(options, process.env.ORBIT_CONNECTED_QA_SEAT_REQUEST_APPROVED);
  assert(process.env.ORBIT_CONNECTED_QA_RUN_APPROVED === '1' && process.env.ORBIT_QA_GUEST_OFFLINE_CONFIRMED === '1', 'Separate root connected-run approval and offline guest confirmation are required.');
  const adbPath = process.env.ORBIT_QA_ADB_PATH || 'C:/Users/herob/AppData/Local/Android/Sdk/platform-tools/adb.exe';
  assert(path.basename(adbPath).toLowerCase() === 'adb.exe' && fs.existsSync(adbPath), 'Reviewed ADB executable required.');
  // Reuse the dedicated baseline ADB server's approved key PATH; do not read or copy keys.
  const environment = createSmokeEnvironment(process.env, baselineRoot);
  const adb = (args, binary = false) => execFileSync(adbPath, connectedAdbArguments(args), { env: environment, windowsHide: true, encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  const shell = (...args) => adb(['shell', ...args]);
  const report = { target: connectedNativeTarget, fixtureMode, localServices: fixedConnectedTarget, startedAt: new Date().toISOString(), checks: [], screenshots: [], diagnostics: [], limitations: [
    'Actual Android emulator Firebase JS SDK Auth, Firestore listeners, Express Match API and SecureStore; explicitly fake accounts and venue.',
    'Local loopback reverse ports only; guest interfaces remain disabled, no production/provider/App Check or pilot proof.',
    'Native app plus an independent host SDK peer; not two physical devices, iOS or screen-reader verification.',
    'Copied-only diagnostics observe after real operations; no production renderer or persistence changes.'
  ] };
  if (fixtureMode === 'seat-request') report.limitations.push('Server-owned fictional provisional age and active membership fixture only; no identity provider, payment, SMS, physical location, App Check or published-outbox proof.');
  const addedReverses = [];
  function preflight() {
    assertGuestOffline({ state: adb(['get-state']), emulator: shell('getprop', 'ro.kernel.qemu'), boot: shell('getprop', 'sys.boot_completed'),
      airplane: shell('settings', 'get', 'global', 'airplane_mode_on'), wifi: shell('settings', 'get', 'global', 'wifi_on'), mobile: shell('settings', 'get', 'global', 'mobile_data'),
      routes: shell('ip', 'route'), routes6: shell('ip', '-6', 'route'), links: shell('ip', 'link'), connectivity: shell('dumpsys', 'connectivity') });
    report.offlinePreflight = { checkedAt: new Date().toISOString(), airplane: 1, wifi: 0, mobile: 0, ipv4Routes: 0, activeDefaultNetwork: 'none' };
    assertConnectedReverses(adb(['reverse','--list']), addedReverses.length ? [14639,18085,19099] : []);
  }
  preflight();
  const metadata = JSON.parse(fs.readFileSync(path.join(outputRoot, 'apk-artifact.json'), 'utf8'));
  const apk = path.resolve(metadata.apk);
  assertConnectedApkPath(apk);
  const digest = createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
  assertConnectedArtifact(metadata, process.env.ORBIT_CONNECTED_QA_APK_SHA256, digest, process.env.ORBIT_CONNECTED_QA_FIXTURE_SHA256, process.env.ORBIT_CONNECTED_QA_SOURCE_SHA256);
  report.artifact = { sha256: digest, sourceSha256: metadata.source.sha256, fixtureSha256: metadata.fixture.sha256, bytes: metadata.bytes };
  const aapt = path.join(outputRoot, 'sdk/build-tools/36.0.0/aapt.exe');
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert(/^package: name='com\.orbit\.player\.qa\.connected'/m.test(badging) && /^launchable-activity: name='com\.orbit\.player\.qa\.connected\.MainActivity'/m.test(badging), 'Only the separate connected QA package may be installed.');
  const reportDirectory = fixtureMode === 'seat-request' ? 'seat-request-smoke' : 'smoke';
  const runRoot = path.join(outputRoot, reportDirectory, new Date().toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(runRoot, { recursive: true });
  report.attemptDirectory = path.relative(repositoryRoot, runRoot).replaceAll('\\', '/');
  let server; let lastXml = ''; let lastNodes = [];
  const display = [...shell('wm', 'size').matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)].at(-1); assert(display, 'QA display size missing.');
  const width = Number(display[1]); const height = Number(display[2]);
  const densityMatch = [...shell('wm','density').matchAll(/(?:Physical|Override) density:\s*(\d+)/g)].at(-1); assert(densityMatch, 'QA display density missing.');
  const density = Number(densityMatch[1]) / 160; report.display = {width,height,density};
  const uiPath = '/data/local/tmp/orbit-player-connected-qa-ui.xml';
  const ui = () => { shell('uiautomator', 'dump', '--compressed', uiPath); lastXml = adb(['exec-out', 'cat', uiPath]); lastNodes = parseHierarchy(lastXml); return lastNodes; };
  const visible = node => node.rect && node.rect[0] >= 0 && node.rect[1] >= 0 && node.rect[2] <= width && node.rect[3] <= height && node.rect[3] > node.rect[1] && node.rect[2] > node.rect[0];
  const find = (nodes, selector, { press = false, field = false, enabled = true } = {}) => nodes.find(node => node.package === connectedNativeTarget.package && visible(node) && nodeMatches(node, selector)
    && (!enabled || node.enabled === 'true') && (!press || node.clickable === 'true' && (node.rect[3] - node.rect[1]) / density >= 40) && (!field || node.class === 'android.widget.EditText'));
  const scroll = async direction => { shell('input', 'swipe', String(Math.round(width * .55)), String(Math.round(height * (direction === 'up' ? .36 : .7))), String(Math.round(width * .55)), String(Math.round(height * (direction === 'up' ? .7 : .36))), '450'); await sleep(150); };
  async function seek(selector, options = {}) { for (let index = 0; index < 9; index++) { const node = find(ui(), selector, options); if (node) return node; await scroll(options.direction ?? 'down'); } throw new Error(`Connected QA selector not found: ${String(selector)}`); }
  async function tap(selector, options = {}) { const node = await seek(selector, { ...options, press: true }); assert(node.package === connectedNativeTarget.package, 'Connected QA cannot tap another package or an OS permission dialog.'); const [x1,y1,x2,y2] = node.rect; shell('input', 'tap', String(Math.round((x1+x2)/2)), String(Math.round((y1+y2)/2))); await sleep(250); }
  async function input(selector, value) { const node = await seek(selector, { field: true }); const [x1,y1,x2,y2] = node.rect; shell('input', 'tap', String(Math.round((x1+x2)/2)), String(Math.round((y1+y2)/2))); shell('input', 'text', fixtureInput(value)); shell('input', 'keyevent', 'KEYCODE_BACK'); await sleep(200); }
  async function until(task, message, timeout = 30_000) { const started = Date.now(); do { const result = await task(); if (result) return result; await sleep(250); } while (Date.now()-started < timeout); throw new Error(message); }
  const waitFor = (selector, options = {}) => until(() => find(ui(), selector, options), `Connected QA selector not visible: ${String(selector)}`);
  async function capture(name) { fs.writeFileSync(path.join(runRoot, `${name}.png`), adb(['exec-out', 'screencap', '-p'], true)); ui(); fs.writeFileSync(path.join(runRoot, `${name}.xml`), lastXml); report.screenshots.push(`${report.attemptDirectory}/${name}.png`); }
  function diagnostics() {
    const pid = shell('pidof', connectedNativeTarget.package).trim(); assert(/^\d+$/.test(pid), 'One exact connected QA PID is required for diagnostic capture.');
    // Filter inside the guest before any log data reaches the host; never capture raw Auth/SDK logs.
    const output = shell(`logcat -d --pid ${pid} -s ReactNativeJS:I | toybox grep 'ORBIT_CONNECTED_QA '`);
    return parseConnectedDiagnostics(output);
  }
  const waitDiagnostic = (predicate, message) => until(() => diagnostics().find(predicate), message);
  const inspect = owner => server.command('inspect', { owner });
  async function check(name, task) { report.stage = name; const start = Date.now(); await task(); report.checks.push({ name, status: 'passed', elapsedMs: Date.now()-start }); delete report.stage; console.log(`PASS ${name}`); }
  async function launch() { preflight(); shell('am','force-stop',connectedNativeTarget.package); const output = shell('am','start','-W','-n',connectedNativeTarget.activity); assert(/Status:\s*ok/.test(output), 'Connected QA activity launch failed.'); await waitFor(/Find your next game|Find games|Profile/); }
  async function guest() {
    await waitFor('Find your next game'); await waitFor('Create account'); await waitFor('Already have an account? Sign in');
  }
  async function signIn(owner) {
    const account = connectedFixtureAccounts[owner]; await tap('Already have an account? Sign in'); await input('Account email address',account.email); await input('Account password or passphrase',account.password); await tap('I confirm that I am 18 or older'); await tap('Sign in');
    if (fixtureMode === 'seat-request') {
      await waitFor('Physical ID review pending'); await waitFor('21+ eligibility confirmed'); await waitFor(account.name); await tap('Continue');
    } else { await waitFor('Not now'); await tap('Not now'); }
    await tap('Profile'); await waitFor(account.name); await waitFor('Account connected');
  }
  async function peerPreferences(preferences) { const current = await inspect('a'); const result = await server.command('peer-operation',{ owner:'a', operation:{ mutationId:randomUUID(), type:'preferences', basePreferencesRevision:current.state.preferencesRevision, preferences } }); assert(result.status === 200, 'Independent SDK peer preference update must be accepted through the actual API.'); return result.body; }
  let initialGame;
  try {
    server = childServer(fixtureMode); const ready = await server.ready; assert(ready.projectId === fixedConnectedTarget.projectId && ready.apiOrigin === 'http://127.0.0.1:14639' && ready.ownerCount === 2, 'Unexpected local connected fixture identity.');
    assert(!server.bootstrapInvalid,'Connected bootstrap diagnostics failed their boundary.');
    const reverseList = adb(['reverse','--list']);
    assert(reverseList.trim() === '', 'Connected fixture refuses any pre-existing reverse mapping; it never removes another owner\'s mappings.');
    for (const port of [19099,18085,14639]) { assert(!new RegExp(`\\btcp:${port}\\b`).test(reverseList), 'Refuse to replace an existing reverse mapping.'); adb(connectedReverseArguments(port)); addedReverses.push(port); }
    assertConnectedReverses(adb(['reverse','--list']));
    if (options.has('--install')) { preflight(); assert(/\bSuccess\b/.test(adb(['install','-r',apk])), 'Connected QA install failed.'); }
    const installedPath = shell('pm','path',connectedNativeTarget.package).trim(); assert(/^package:\/data\/app\/[^\r\n]+\/com\.orbit\.player\.qa\.connected-[^/\r\n]+\/base\.apk$/.test(installedPath), 'Only the installed connected QA base APK may be inspected.');
    assert(createHash('sha256').update(adb(['exec-out','cat',installedPath.slice(8)],true)).digest('hex') === digest, 'Installed connected QA APK hash differs.');
    if (options.has('--fresh')) assert(shell('pm','clear',connectedNativeTarget.package).trim() === 'Success', 'Could not clear the explicitly requested connected QA fixture package.');
    await launch(); await guest();
    if (fixtureMode === 'seat-request') {
      const seatInspect = async owner => assertSeatInspection(await server.command('fixture-seat-inspect',{owner}));
      let currentSaveId;
      await check('native Save and explicit seat draft create no venue request before confirmation',async () => {
        await signIn('a'); await capture('seat-owner-a-profile'); await tap('Games',{direction:'up'}); await tap('Find games'); await waitFor('Orbit Match');
        await waitFor(/^Open \$2\/\$5 Pot Limit Omaha at Native QA Card House(?:; [^\r\n]+)?$/);
        const untouched = await seatInspect('a'); assert(untouched.venueRevision === 1 && untouched.waitlistAttemptCount === 0 && untouched.interestCount === 0 && untouched.receiptCount === 0 && untouched.match.waitlistSuccessEvents.length === 0,'Seat fixture must start without request attempts, owned requests or conversions.');
        await tap('Save $2/$5 Pot Limit Omaha'); await until(async () => (await inspect('a')).summary.savedCount === 1,'Native Save must persist before requesting a seat.');
        const saved = (await inspect('a')).state.decisions.find(record => record.ref.gameId === connectedFixtureVenue.secondGameId && record.decision === 'saved'); assert(saved,'Current saved recommendation missing.'); currentSaveId = saved.mutationId;
        const afterSave = await seatInspect('a'); assert(afterSave.venueRevision === 1 && afterSave.waitlistAttemptCount === 0 && afterSave.interestCount === 0 && afterSave.receiptCount === 0 && afterSave.match.waitlistSuccessEvents.length === 0,'Save must not attempt or create a venue request or conversion.');
        await tap('Saved games, 1',{direction:'up'}); await tap('Details for saved $2/$5 Pot Limit Omaha'); await waitFor('Request a seat');
        const details = await seatInspect('a'); assert(details.waitlistAttemptCount === 0 && details.interestCount === 0,'Opening saved details must not request a seat.');
        await tap('Request a seat'); await waitFor('Request a seat for $2/$5 Pot Limit Omaha'); await waitFor('Tell club I am here');
        const draft = await seatInspect('a'); assert(draft.venueRevision === 1 && draft.waitlistAttemptCount === 0 && draft.interestCount === 0 && draft.receiptCount === 0 && draft.match.waitlistSuccessEvents.length === 0,'Opening the arrival modal must not send a request.');
        await capture('seat-arrival-draft-unconfirmed');
      });
      await check('explicit native arrival confirmation persists and returns My Games with current-save attribution',async () => {
        const confirmedAfter = Date.now(); await tap('Tell club I am here');
        await until(async () => (await seatInspect('a')).interestCount === 1,'Confirmed native seat request did not reach the real venue state.');
        const accepted = await until(async () => { const value = await seatInspect('a'); return value.match.waitlistSuccessEvents.length === 1 ? value : null; },'Accepted request did not record the current saved-game conversion.');
        const interest = accepted.interests[0], event = accepted.match.waitlistSuccessEvents[0];
        assert(accepted.waitlistAttemptCount === 1 && accepted.receiptCount === 1 && interest.gameId === connectedFixtureVenue.secondGameId && interest.tableId === 'native-qa-table-1'
          && Date.parse(interest.requestedAt) >= confirmedAfter && event.ref.gameId === interest.gameId && event.saveMutationId === currentSaveId
          && Date.parse(event.at) >= Date.parse(interest.requestedAt),'Accepted arrival must retain the exact running table, authoritative timestamp and current-save event.');
        await tap('Back to Matches'); await seek('My Games'); await waitFor('Arrived'); await waitFor('Checked in - Core has you marked as arrived.'); await waitFor('Cancel request for $2/$5 Pot Limit Omaha');
        await capture('seat-accepted-my-games'); report.acceptedSeat = accepted;
      });
      await check('same request ID replay creates no second arrival or receipt',async () => {
        const replay = await server.command('peer-seat-replay',{owner:'a'});
        assert(replay.status === 200 && replay.venueUnchanged === true && replay.receiptUnchanged === true && replay.interestCount === 1 && replay.receiptCount === 1,'Actual SDK same-ID replay must preserve one authoritative arrival and receipt.');
        const after = await seatInspect('a'); assert(after.waitlistAttemptCount === 2 && after.interestCount === 1 && after.receiptCount === 1 && after.match.waitlistSuccessEvents.length === 1,'Replay must not invent an additional native conversion.'); report.requestReplay = replay;
      });
      await check('membership expiry after a native draft rejects the request and rolls back local optimism',async () => {
        await tap('Discover games',{direction:'up'}); await tap('Save $1/$2 No Limit Holdem'); await until(async () => (await inspect('a')).summary.savedCount === 2,'Second genuine Save did not persist.');
        await tap('Saved games, 2',{direction:'up'}); await tap('Details for saved $1/$2 No Limit Holdem'); await tap('Request a seat'); await waitFor('Tell club I am here');
        const before = await seatInspect('a'); assert(before.waitlistAttemptCount === 2 && before.interestCount === 1 && before.receiptCount === 1 && before.match.waitlistSuccessEvents.length === 1,'Second draft must remain unsubmitted.');
        const revoked = await server.command('fixture-seat-update',{update:{kind:'expire-membership',expectedRevision:before.venueRevision}});
        assert(revoked.fixtureMode === 'seat-request' && revoked.stage === 'expire-membership' && revoked.venueRevision === before.venueRevision + 1 && revoked.gameId === connectedFixtureVenue.gameId && revoked.publicationDrained === false,'Only the owned fixture membership may expire.');
        await tap('Tell club I am here'); await waitFor('Seat request was not sent. An active, unexpired membership is required to join this game list.');
        const rejected = await seatInspect('a'); assert(rejected.waitlistAttemptCount === 3 && rejected.venueRevision === revoked.venueRevision && rejected.interestCount === 1 && rejected.receiptCount === 1
          && rejected.interests[0].gameId === connectedFixtureVenue.secondGameId && rejected.match.waitlistSuccessEvents.length === 1,'Rejected request must leave no venue interest, receipt or success conversion.');
        report.rejectedSeat = rejected;
        await capture('seat-expired-request-rejected'); shell('input','keyevent','KEYCODE_BACK'); await sleep(200); await tap('Back to Matches');
        await verifyRejectedSeatUi({ seek, ui, capture });
      });
      await check('native owner B sees no inherited request and actual SDK spoof or foreign cancellation is denied',async () => {
        await tap('Profile'); await until(() => diagnostics().filter(record => record.ownerRole === 'a' && record.kind === 'journal-durable').at(-1)?.pending?.length === 0,'Owner A Match journal must settle before the owner switch.');
        const retainedA = await seatInspect('a'); await tap('Sign out'); await guest(); await signIn('b'); await tap('Games',{direction:'up'}); await tap('Find games'); await waitFor('Saved games, 0');
        const own = await seatInspect('b'); assert(own.interestCount === 0 && own.receiptCount === 0 && own.match.savedCount === 0 && own.match.waitlistSuccessEvents.length === 0,'Owner B must not inherit owner A request or saved attribution.');
        const discovery = await server.command('peer-discovery',{owner:'b'}); const venue = discovery.body?.clubs?.find(club => club.club.id === connectedFixtureVenue.clubId);
        assert(discovery.status === 200 && venue && venue.waitlists.length === 0 && venue.memberships.length === 0,'The actual authenticated owner B API snapshot must exclude owner A arrival and membership.');
        assert(!ui().some(node => node.package === connectedNativeTarget.package && nodeMatches(node,/^Cancel request for /)),'Owner B must not display owner A cancellation controls.');
        const denied = await server.command('peer-seat-owner-denial',{owner:'b'});
        assert(denied.spoofStatus === 403 && denied.cancelStatus === 404 && denied.venueUnchanged === true && denied.receiptUnchanged === true,'Actual authenticated owner B must not spoof or cancel owner A arrival.');
        const afterA = await seatInspect('a'); assert(afterA.waitlistAttemptCount === 5 && JSON.stringify({...afterA,waitlistAttemptCount:retainedA.waitlistAttemptCount}) === JSON.stringify(retainedA),'Owner B negative requests must preserve owner A authoritative state and attribution.');
        await capture('seat-owner-b-isolated'); report.ownerDenials = denied; report.ownerB = own; report.ownerBSnapshot = {waitlistCount:venue.waitlists.length,membershipCount:venue.memberships.length};
      });
    } else {
    await check('actual native SDK sign-in resolves owner A profile and published discovery',async () => {
      await signIn('a'); await capture('owner-a-profile'); await tap('Games',{direction:'up'}); await tap('Find games'); await waitFor('Orbit Match'); await waitFor('Discover games');
      const front = await waitFor(connectedFrontCardPattern);
      initialGame = connectedFrontGame(front);
      assert(['$1/$2 No Limit Holdem','$2/$5 Pot Limit Omaha'].includes(initialGame),'Only the actual front candidate from this fixed local venue may be decided.');
      report.firstCandidate = initialGame === '$1/$2 No Limit Holdem' ? connectedFixtureVenue.gameId : connectedFixtureVenue.secondGameId;
      await waitFor('Time rate not published'); await waitDiagnostic(record => record.kind === 'http-state' && record.ownerRole === 'a','Actual owner A HTTP restoration was not observed.'); await capture('owner-a-match');
    });
    await check('native Save and Undo reach the actual Match API and server state',async () => {
      await server.command('peer-listener-start',{owner:'a'});
      await tap(`Save ${initialGame}`); await until(async () => (await inspect('a')).summary.savedCount === 1,'Owner A Save did not reach Firestore.'); await waitDiagnostic(record => record.kind === 'http-mutation' && record.ownerRole === 'a' && record.operationType === 'decide','Actual decision HTTP result missing.');
      await until(async () => { const listener = await server.command('peer-listener-status',{owner:'a'}); return listener.active && listener.accepted > 0 && listener.errors === 0 && listener.latest?.savedCount === 1; },'Independent real SDK onSnapshot did not receive the native Save.');
      await tap('Undo last swipe',{direction:'up'}); await until(async () => (await inspect('a')).summary.savedCount === 0,'Undo did not remove the actual server Save.'); await waitFor('Saved games, 0');
    });
    await check('native preferences persist and remote onSnapshot prevents stale draft overwrite',async () => {
      await tap('Profile',{direction:'up'}); await tap('Match preferences'); await tap('Match games preferences'); await tap('No Limit Holdem'); await tap('Save Match preferences'); await until(async () => (await inspect('a')).state.preferences.variants.includes('nlh'),'Native preferences were not persisted.');
      await tap('Profile',{direction:'up'}); await tap('Match preferences'); await tap('Match games preferences'); const base = await inspect('a'); await tap('Pot Limit Omaha');
      await peerPreferences({...base.state.preferences,variants:['plo']}); const remote = await inspect('a');
      await waitDiagnostic(record => record.kind === 'listener-accepted' && record.ownerRole === 'a' && record.preferencesRevision === remote.state.preferencesRevision,'Real native Firestore listener did not accept the independent peer update.');
      await seek(/Current preferences changed/,{direction:'up'}); await tap('Reload current Match preferences',{direction:'up'});
      await until(() => { const nodes = ui(); return find(nodes,'Pot Limit Omaha')?.selected === 'true' && find(nodes,'No Limit Holdem')?.selected === 'false'; },'Reload must use the actual remote preference selection.'); await capture('owner-a-peer-preferences'); await tap('Save Match preferences');
      await until(async () => (await inspect('a')).state.preferencesRevision > remote.state.preferencesRevision,'Reloaded preferences have not reached the actual API.');
      assert((await inspect('a')).state.preferences.variants.join(',') === 'plo','Stale draft must not overwrite the accepted peer preferences.');
    });
    let pendingId;
    await check('API outage preserves a real durable pending journal through native cold relaunch',async () => {
      assert((await server.command('pause-api')).apiListening === false,'Local API did not pause.');
      const earlierDecisions = new Set(diagnostics().flatMap(record => record.pending?.filter(op => op.type === 'decide').map(op => op.mutationId) ?? []));
      await tap('Save $2/$5 Pot Limit Omaha'); const durable = await waitDiagnostic(record => record.ownerRole === 'a' && record.kind === 'journal-durable' && record.pending?.some(op => op.type === 'decide' && !earlierDecisions.has(op.mutationId)),'Real SecureStore durable pending decision not observed.');
      pendingId = durable.pending.find(op => op.type === 'decide' && !earlierDecisions.has(op.mutationId)).mutationId; assert((await inspect('a')).summary.savedCount === 0,'Paused API must not persist the native pending decision remotely.');
      await waitFor('Could not connect to Match. Try again shortly.');
      assert(!ui().some(node => node.package === connectedNativeTarget.package && /java\.(?:io|net)|127\.0\.0\.1|localhost|unexpected end of stream|CLEARTEXT/i.test(`${node.text ?? ''} ${node['content-desc'] ?? ''}`)), 'Native outage presentation must not expose raw Java or loopback transport details.');
      await tap('Saved games, 1',{direction:'up'});
      await capture('owner-a-offline-pending'); await launch(); await tap('Profile'); await waitFor(connectedFixtureAccounts.a.name); await tap('Match preferences');
      await waitDiagnostic(record => record.kind === 'journal-restored' && record.ownerRole === 'a' && record.pending?.some(op => op.mutationId === pendingId),'Cold native restoration lost the actual pending mutation ID.');
      await waitFor('Could not connect to Match. Try again shortly.');
      await waitFor('Could not connect to published games. Try again shortly.');
      assert(!ui().some(node => node.package === connectedNativeTarget.package && /java\.(?:io|net)|127\.0\.0\.1|localhost|unexpected end of stream|CLEARTEXT/i.test(`${node.text ?? ''} ${node['content-desc'] ?? ''}`)), 'Restored native outage presentation must keep raw transport details out of user copy.');
      await capture('owner-a-offline-restored');
    });
    await check('restored pending mutation retries once and independent peer reads the accepted Save',async () => {
      assert((await server.command('resume-api')).apiListening === true,'Local API did not resume.'); await tap('Retry Match',{direction:'up'});
      await until(async () => (await inspect('a')).summary.savedCount === 1,'Pending Save did not reach the resumed API.');
      await waitDiagnostic(record => record.kind === 'http-mutation' && record.ownerRole === 'a' && record.mutationId === pendingId,'Restored pending mutation was not acknowledged through the actual API.');
      const peer = await server.command('peer-read',{owner:'a'}); assert(peer.status === 200 && peer.body.state.decisions.some(record => record.mutationId === pendingId && record.decision === 'saved'),'Independent authenticated SDK peer cannot read the accepted native Save.');
      const before = await inspect('a'); const saved = before.state.decisions.find(record => record.mutationId === pendingId);
      const repeated = await server.command('peer-operation',{owner:'a',operation:{type:'decide',mutationId:pendingId,ref:saved.ref,summary:saved.summary,decision:saved.decision}});
      const after = await inspect('a'); assert(repeated.status === 200 && after.summary.savedCount === 1 && after.receiptCount === before.receiptCount,'Replay must preserve decision count and receipt idempotency.');
      await tap('Saved games, 1',{direction:'up'}); await capture('owner-a-saved-synced');
      report.hostPeerListener = await server.command('peer-listener-status',{owner:'a'});
    });
    await check('actual sign-out and owner B sign-in keep profiles, journals and Match state isolated',async () => {
      await tap('Profile');
      await until(() => diagnostics().filter(record => record.ownerRole === 'a' && record.kind === 'journal-durable').at(-1)?.pending?.length === 0,'Owner A journal must be fully acknowledged before freezing its state.');
      const retainedA = await inspect('a'); await tap('Sign out'); await guest(); await signIn('b');
      await tap('Games',{direction:'up'}); await tap('Find games'); await waitFor('Saved games, 0');
      await waitDiagnostic(record => record.ownerRole === 'b' && record.kind === 'http-state' && record.savedCount === 0,'Actual owner B restoration is missing.');
      const front = await waitFor(connectedFrontCardPattern);
      const frontGame = connectedFrontGame(front);
      assert(frontGame, 'Only a fixed connected fixture game may be decided.');
      if (frontGame === '$2/$5 Pot Limit Omaha') {
        await tap('Pass $2/$5 Pot Limit Omaha'); await until(async () => (await inspect('b')).summary.passedCount === 1,'Owner B native Pass must be acknowledged before saving the next actual candidate.');
        report.ownerBPassedFirstCandidate = connectedFixtureVenue.secondGameId;
      }
      await tap('Save $1/$2 No Limit Holdem'); await until(async () => (await inspect('b')).summary.savedCount === 1,'Owner B Save was not persisted.');
      const currentA = await inspect('a'); assert(JSON.stringify(currentA.state) === JSON.stringify(retainedA.state) && currentA.receiptCount === retainedA.receiptCount,'Owner B interaction changed owner A state.');
      const currentB = await inspect('b'); assert(!currentB.state.recentMutationIds.includes(pendingId),'Owner A journal mutation leaked to B.');
      const isolation = await server.command('peer-isolation',{owner:'b'}); assert(Object.values(isolation).every(value => value === true),'Real owner isolation rules were not enforced.');
      await capture('owner-b-isolated-match'); report.ownerSummary = {a:currentA.summary,b:currentB.summary};
    });
    await check('authoritative local venue API polling updates Saved availability and ended details stay read-only',async () => {
      const retainedA = await inspect('a'); await tap('Saved games, 1',{direction:'up'});
      await waitFor('3 seats open \u00b7 1 waiting');
      const availability = await server.command('fixture-venue-update',{update:{kind:'availability',expectedRevision:1}});
      assert(availability.venueRevision === 2 && availability.publicationDrained === false,'Bounded fixture availability CAS did not preserve publication boundary.');
      // Real subscription polls every60s. Do not inject a refresh, shorten the production timer or alter UI inventory.
      await until(() => find(ui(),'1 seat open \u00b7 7 waiting'),'Actual native API polling did not update Saved availability.',90_000);
      await capture('owner-b-saved-availability'); await tap('Details for saved $1/$2 No Limit Holdem'); await waitFor('1 seat open \u00b7 7 waiting');
      const ended = await server.command('fixture-venue-update',{update:{kind:'ended',expectedRevision:2}});
      assert(ended.venueRevision === 3 && ended.publicationDrained === false,'Bounded fixture end CAS did not preserve publication boundary.');
      await until(() => find(ui(),'This listing is no longer available'),'Actual native API polling did not invalidate the ended open detail.',90_000);
      assert(!ui().some(node => node.package === connectedNativeTarget.package && node.clickable === 'true' && nodeMatches(node,/^(?:Directions to |Request a seat$|Send interest$|Request access$)/)),'Ended details must have no operational direction or request controls.');
      await capture('owner-b-ended-details'); await tap('Back to Matches'); await waitFor('Saved games, 1'); await waitFor('This game has no active published table or upcoming event.');
      const details = await waitFor('Details for saved $1/$2 No Limit Holdem',{enabled:false}); assert(details.enabled === 'false','Ended Saved row must remain with details disabled.'); await capture('owner-b-ended-saved-retained');
      const discovery = await server.command('peer-discovery',{owner:'b'}); const venue = discovery.body.clubs.find(record => record.club.id === connectedFixtureVenue.clubId);
      const plo = venue?.games.find(game => game.id === connectedFixtureVenue.secondGameId);
      assert(discovery.status === 200 && plo?.availableSeats === 2 && plo.openTables.length === 1 && plo.openTables[0].status === 'Running','Owned fixture update changed the unrelated PLO game.');
      const currentA = await inspect('a'); assert(JSON.stringify(currentA.state) === JSON.stringify(retainedA.state) && currentA.receiptCount === retainedA.receiptCount,'Venue-only fixture controls changed owner A private state.');
      report.venuePolling = {availabilityRevision:2,endedRevision:3,publicationDrained:false,savedRowRetained:true,endedDetailsReadOnly:true,unrelatedGamePreserved:true};
    });
    }
    report.diagnostics = diagnostics(); preflight(); report.status = 'passed';
  } catch(error) {
    report.status = 'failed'; report.failure = error instanceof Error ? error.message : 'Connected QA failed.';
    try { await capture('failure'); report.diagnostics = diagnostics(); } catch { report.failureCaptureUnavailable = true; }
    throw error;
  } finally {
    try { shell('am','force-stop',connectedNativeTarget.package); } catch { report.appStopFailed = true; }
    try { if (server) assert((await server.command('stop')).stopped === true,'Bounded fixture stop was not acknowledged.'); report.serverStopped = true; }
    catch { report.serverStopped = false; server?.child.kill('SIGTERM'); }
    server?.dispose();
    report.bootstrap = server?.bootstrap ?? [];
    if (server?.bootstrapInvalid) { report.status = 'failed'; report.failure ||= 'Connected bootstrap diagnostics failed their boundary.'; process.exitCode = 1; }
    for (const port of addedReverses.reverse()) { try { adb(connectedReverseArguments(port,true)); } catch { report.reverseCleanupFailed = true; } }
    report.removedOnlyOwnedReverses = !report.reverseCleanupFailed; report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(runRoot,'results.json'),`${JSON.stringify(report,null,2)}\n`); fs.writeFileSync(path.join(outputRoot,reportDirectory,'results.json'),`${JSON.stringify(report,null,2)}\n`);
    console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length,report:`out/player-android-connected-qa/${reportDirectory}/results.json`}));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
