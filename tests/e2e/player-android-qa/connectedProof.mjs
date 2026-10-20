import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConnectedTarget, assertConnectedUrl, connectedFixtureVenue, createConnectedEnvironment, fixedConnectedTarget } from './connectedServer.mjs';

const proofRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../out/player-android-connected-qa');
const apiOrigin = `http://${fixedConnectedTarget.api.host}:${fixedConnectedTarget.api.port}`;
const commands = new Set(['inspect', 'peer-read', 'peer-operation', 'peer-discovery', 'peer-isolation', 'peer-listener-start', 'peer-listener-status', 'peer-listener-stop', 'pause-api', 'resume-api', 'fixture-venue-update', 'stop']);
const seatCommands = new Set(['fixture-seat-inspect', 'peer-seat-replay', 'peer-seat-owner-denial', 'fixture-seat-update']);
function assert(condition, message) { if (!condition) throw new Error(message); }

export function assertConnectedReady(message, fixtureMode = 'match') {
  assert(['match', 'seat-request'].includes(fixtureMode), 'Connected proof refuses an unexpected fixture mode.');
  assert(message?.type === 'ready' && message.projectId === fixedConnectedTarget.projectId
    && message.apiOrigin === apiOrigin && message.ownerCount === 2
    && message.clubId === connectedFixtureVenue.clubId
    && JSON.stringify(message.gameIds) === JSON.stringify([connectedFixtureVenue.gameId, connectedFixtureVenue.secondGameId])
    && message.venueRevision === 1 && message.publicationDrained === false
    && (message.fixtureMode ?? 'match') === fixtureMode, 'Connected proof refuses an unexpected server fixture.');
}
export function createConnectedServerController(child, { timeoutMs = 30_000, fixtureMode = 'match' } = {}) {
  assert(child instanceof EventEmitter && typeof child.send === 'function', 'Connected proof requires its own IPC child.');
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 60_000, 'Invalid connected proof deadline.');
  assert(['match', 'seat-request'].includes(fixtureMode), 'Connected proof refuses an unexpected fixture mode.');
  let sequence = 0, settled = false, unavailable = false;
  const pending = new Map();
  let acceptReady, rejectReady;
  const ready = new Promise((resolve, reject) => { acceptReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => { settled = true; rejectReady(new Error('Connected proof server readiness timed out.')); }, timeoutMs);
  const fail = () => {
    unavailable = true;
    if (!settled) { settled = true; clearTimeout(readyTimer); rejectReady(new Error('Connected proof server exited before readiness.')); }
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Connected proof IPC child is unavailable.')); }
    pending.clear();
  };
  const onMessage = message => {
    if (message?.type === 'ready' && !settled) {
      settled = true; clearTimeout(readyTimer);
      try { assertConnectedReady(message, fixtureMode); acceptReady(message); } catch (error) { rejectReady(error); }
      return;
    }
    const entry = pending.get(message?.requestId); if (!entry) return;
    if (!['result', 'error', 'stopped'].includes(message.type)) return;
    pending.delete(message.requestId); clearTimeout(entry.timer);
    if (message.type === 'error') entry.reject(new Error('Connected proof local command failed; raw details withheld.'));
    else entry.resolve(message.type === 'stopped' ? { stopped: true } : message.result);
  };
  child.on('message', onMessage); child.on('exit', fail); child.on('error', fail);
  return {
    ready,
    request: (type, body = {}) => {
      if (unavailable) return Promise.reject(new Error('Connected proof IPC child is unavailable.'));
      if (!(commands.has(type) || fixtureMode === 'seat-request' && seatCommands.has(type)) || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['owner', 'operation', 'update'].includes(key))
        || body.owner !== undefined && !['a', 'b'].includes(body.owner)) return Promise.reject(new Error('Connected proof rejected an unsupported IPC command.'));
      if (seatCommands.has(type) && (Object.keys(body).some(key => !['owner', 'update'].includes(key))
        || type === 'fixture-seat-update' && (Object.keys(body).length !== 1 || !body.update
          || Object.keys(body.update).length !== 2 || !['expire-membership', 'end-game'].includes(body.update.kind)
          || !Number.isSafeInteger(body.update.expectedRevision) || body.update.expectedRevision < 1 || body.update.expectedRevision > 20)
        || type !== 'fixture-seat-update' && (Object.keys(body).length !== 1 || !['a', 'b'].includes(body.owner)))) return Promise.reject(new Error('Connected proof rejected an unsupported seat command.'));
      const requestId = `proof_${++sequence}`;
      const message = { ...body, type, requestId };
      if (Buffer.byteLength(JSON.stringify(message), 'utf8') > 20 * 1024) return Promise.reject(new Error('Connected proof IPC command is too large.'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Connected proof IPC command timed out.')); }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        child.send(message, error => { if (error && pending.has(requestId)) { clearTimeout(timer); pending.delete(requestId); reject(new Error('Connected proof IPC send failed.')); } });
      });
    },
    dispose: () => { fail(); child.off('message', onMessage); child.off('exit', fail); child.off('error', fail); }
  };
}
async function waitForRevision(controller, revision) {
  const deadline = Date.now() + 10_000;
  do {
    const observation = await controller.request('peer-listener-status', { owner: 'a' });
    if (observation.latest?.revision === revision && observation.accepted > 0 && observation.errors === 0) return observation;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error('Connected proof did not observe the expected server listener revision.');
}
export async function runConnectedProof({ venueUpdates = false } = {}) {
  assert(typeof venueUpdates === 'boolean', 'Connected proof venue scope must be explicit.');
  assertConnectedTarget(fixedConnectedTarget);
  const child = fork(new URL('./connectedServer.mjs', import.meta.url), ['--run'], { env: createConnectedEnvironment(process.env), execArgv: [], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  // Do not log/store child SDK output: it is unnecessary for bounded evidence.
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  const controller = createConnectedServerController(child);
  const report = { kind: 'host-sdk-api-preflight', target: fixedConnectedTarget, startedAt: new Date().toISOString(), checks: [], limitations: ['Auth/Firestore emulators and synthetic verified accounts only.', 'App Check disabled in local QA; no provider, live revocation or attestation proof.', 'Independent Firebase JS SDK clients on one host; no native/journal/device/pilot claim.', 'Discovery reads canonical authoritative state; publication outbox is not drained.'] };
  const check = async (name, task) => { report.stage = name; await task(); report.checks.push({ name, status: 'passed' }); };
  let cleaned = false;
  try {
    report.stage = 'server readiness';
    await controller.ready;
    await check('unchanged API rejects missing and invalid Firebase identity', async () => {
      for (const headers of [{}, { authorization: 'Bearer invalid.fixture.token' }]) {
        const url = assertConnectedUrl(`${apiOrigin}/player/match`);
        const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(5_000) });
        assert(response.status === 401, 'Expected signed-out/invalid-token HTTP401.'); await response.arrayBuffer();
      }
    });
    const first = await controller.request('peer-read', { owner: 'a' });
    await check('real verified Firebase JS SDK session restores empty owner state', async () => {
      assert(first.status === 200 && first.body?.state?.revision === 0 && first.body.state.decisions.length === 0, 'Unexpected initial owner Match state.');
    });
    await check('licensed authoritative discovery provides both cash candidates', async () => {
      const response = await controller.request('peer-discovery', { owner: 'a' });
      const club = response.body?.clubs?.find(item => item.club?.id === connectedFixtureVenue.clubId);
      assert(response.status === 200 && club && club.games.length === 2, 'Expected licensed fixture cash discovery.');
      assert(club.games.some(game => game.id === connectedFixtureVenue.gameId && game.availableSeats === 3 && game.waitlistCount === 1), 'Unexpected fixture availability.');
    });
    await controller.request('peer-listener-start', { owner: 'a' });
    await waitForRevision(controller, 0);
    const save = { type: 'decide', mutationId: 'native-qa-proof-save', ref: { clubId: connectedFixtureVenue.clubId, gameId: connectedFixtureVenue.gameId, kind: 'cash' }, summary: { venueName: connectedFixtureVenue.name, gameName: '$1/$2 No Limit Holdem' }, decision: 'saved' };
    await check('save and same-ID replay create one revision and receipt', async () => {
      const accepted = await controller.request('peer-operation', { owner: 'a', operation: save });
      const replayed = await controller.request('peer-operation', { owner: 'a', operation: save });
      const current = await controller.request('inspect', { owner: 'a' });
      assert(accepted.status === 200 && replayed.status === 200 && current.summary.revision === 1 && current.summary.savedCount === 1 && current.receiptCount === 1, 'Idempotent save did not retain exactly one decision/receipt.');
      await waitForRevision(controller, 1);
    });
    await check('conditional Undo persists through the real API and listener', async () => {
      const response = await controller.request('peer-operation', { owner: 'a', operation: { type: 'undo', mutationId: 'native-qa-proof-undo', targetMutationId: save.mutationId } });
      assert(response.status === 200 && response.body.state.revision === 2 && response.body.state.decisions.length === 0, 'Unexpected Undo result.'); await waitForRevision(controller, 2);
    });
    await controller.request('peer-operation', { owner: 'a', operation: { ...save, mutationId: 'native-qa-proof-save-again' } });
    const beforePreferences = await controller.request('peer-read', { owner: 'a' });
    const preferenceOperation = { type: 'preferences', mutationId: 'native-qa-proof-preferences', basePreferencesRevision: 0, preferences: { ...beforePreferences.body.state.preferences, variants: ['plo'], strictVariants: true, requireSeatsNow: true } };
    await check('preference CAS preserves saved games and rejects a stale peer write', async () => {
      const response = await controller.request('peer-operation', { owner: 'a', operation: preferenceOperation });
      const conflict = await controller.request('peer-operation', { owner: 'a', operation: { ...preferenceOperation, mutationId: 'native-qa-proof-stale-preferences' } });
      assert(response.status === 200 && response.body.state.revision === 4 && response.body.state.preferencesRevision === 1 && response.body.state.decisions.length === 1, 'Preferences did not preserve the saved game.');
      assert(conflict.status === 409 && conflict.body.code === 'MATCH_PREFERENCES_CONFLICT', 'Expected preference CAS conflict.'); await waitForRevision(controller, 4);
    });
    await check('second real SDK identity has empty state and cannot read/write private Match documents', async () => {
      const own = await controller.request('peer-read', { owner: 'b' });
      assert(own.status === 200 && own.body.state.revision === 0 && own.body.state.decisions.length === 0, 'Other owner did not retain empty independent state.');
      const isolation = await controller.request('peer-isolation', { owner: 'b' });
      assert(Object.keys(isolation).length === 4 && Object.values(isolation).every(value => value === true), 'Expected actual SDK permission-denied isolation.');
    });
    await check('API pause and recovery preserve authoritative state and receipts', async () => {
      await controller.request('pause-api'); let unavailable = false;
      try { await fetch(assertConnectedUrl(`${apiOrigin}/player/match`), { redirect: 'error', signal: AbortSignal.timeout(2_000) }); } catch { unavailable = true; }
      assert(unavailable, 'Expected the owned API listener to be unavailable.');
      await controller.request('resume-api'); const restored = await controller.request('peer-read', { owner: 'a' });
      const inspection = await controller.request('inspect', { owner: 'a' });
      assert(restored.status === 200 && inspection.summary.revision === 4 && inspection.summary.savedCount === 1 && inspection.receiptCount === 4, 'API recovery did not preserve state/receipts.');
      report.final = { ...inspection.summary, receiptCount: inspection.receiptCount };
    });
    if (venueUpdates) {
      const discovery = async () => {
        const response = await controller.request('peer-discovery', { owner: 'a' });
        assert(response.status === 200, 'Expected current authenticated discovery.');
        return response.body.clubs.find(item => item.club.id === connectedFixtureVenue.clubId);
      };
      await check('owned canonical availability update reaches authenticated API discovery', async () => {
        const updated = await controller.request('fixture-venue-update', { update: { kind: 'availability', expectedRevision: 1 } });
        const club = await discovery(), nlh = club.games.find(game => game.id === connectedFixtureVenue.gameId), plo = club.games.find(game => game.id === connectedFixtureVenue.secondGameId);
        assert(updated.venueRevision === 2 && updated.publicationDrained === false && nlh.availableSeats === 1 && nlh.waitlistCount === 7 && plo.availableSeats === 2, 'Unexpected owned availability update.');
      });
      await check('ended NLH stays saved while authenticated catalog retains the PLO table', async () => {
        const updated = await controller.request('fixture-venue-update', { update: { kind: 'ended', expectedRevision: 2 } });
        const club = await discovery(), nlh = club.games.find(game => game.id === connectedFixtureVenue.gameId), plo = club.games.find(game => game.id === connectedFixtureVenue.secondGameId);
        const saved = await controller.request('peer-read', { owner: 'a' });
        assert(updated.venueRevision === 3 && updated.publicationDrained === false && nlh.availableSeats === 0 && nlh.openTables.length === 0 && plo.availableSeats === 2
          && saved.status === 200 && saved.body.state.revision === 4 && saved.body.state.decisions.some(decision => decision.ref.gameId === connectedFixtureVenue.gameId && decision.decision === 'saved'), 'Ending the fixture did not preserve saved data/PLO availability.');
      });
      report.venue = { revision: 3, stage: 'ended', otherGameAvailableSeats: 2, publicationDrained: false };
    }
    report.listener = await controller.request('peer-listener-stop', { owner: 'a' });
    report.status = 'passed';
    delete report.stage;
  } catch { report.status = 'failed'; report.failure = 'A local preflight assertion or command failed; raw SDK/body details withheld.'; }
  finally {
    try { await controller.request('stop'); cleaned = true; } catch { report.cleanupFailure = true; child.kill('SIGTERM'); }
    controller.dispose(); report.cleaned = cleaned; report.finishedAt = new Date().toISOString();
    fs.mkdirSync(proofRoot, { recursive: true });
    const output = path.join(proofRoot, `host-proof-${report.startedAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, cleaned, output }));
  }
  if (report.status !== 'passed' || !cleaned) throw new Error('Connected host proof did not pass with complete fixture cleanup.');
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Set(process.argv.slice(2));
  if (!options.has('--run') || [...options].some(option => !['--run', '--venue-updates'].includes(option))) throw new Error('Use --run with optional --venue-updates for the fixed local connected host proof.');
  runConnectedProof({ venueUpdates: options.has('--venue-updates') }).catch(() => { process.exitCode = 1; });
}
