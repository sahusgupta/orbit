const { createHash } = require('node:crypto');
const { getDatabase } = require('./db/connection');
const { playerDeletionMarkerPath } = require('./playerDeletionGuard');
const { MatchStateError, applyMatchOperation, createMatchState, decodeMatchOperation, decodeMatchState, pruneMatchState } = require('./shared/orbitMatchState.cjs');

const maximumMatchStateBytes = 900 * 1024;
const maximumMatchOperationBytes = 16 * 1024;

function matchStatePath(uid) {
  if (typeof uid !== 'string' || !uid || uid.trim() !== uid || uid.length > 128 || /[\/\u0000-\u001f\u007f]/.test(uid)) {
    throw new MatchStateError('MATCH_AUTH_REQUIRED', 'A verified Orbit Player account is required.', 401);
  }
  return `players/${uid}/orbitMatch/state`;
}
function operationReceiptPath(uid, mutationId) { return `${matchStatePath(uid)}/receipts/${mutationId}`; }

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function matchOperationDigest(operation) { return createHash('sha256').update(canonicalJson(operation)).digest('hex'); }

function seededMatchState(profile) {
  const state = createMatchState();
  const source = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  const favorites = Array.isArray(source.favoriteClubIds) ? source.favoriteClubIds : [];
  state.preferences.favoriteClubIds = [...new Set(favorites.filter((id) => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id)))].slice(0, 100);
  const preferred = Array.isArray(source.preferredGameIds) ? source.preferredGameIds : [];
  if (preferred.some((id) => ['nlh', 'nlh-1-2', 'nlh-1-3'].includes(id))) state.preferences.variants.push('nlh');
  if (preferred.some((id) => ['plo', 'plo-1-2'].includes(id))) state.preferences.variants.push('plo');
  const stakes = typeof source.preferredStakes === 'string'
    ? /^\s*\$?(\d+(?:\.\d+)?)\s*\/\s*\$?(\d+(?:\.\d+)?)\s*$/.exec(source.preferredStakes) : null;
  if (stakes && Number(stakes[1]) <= Number(stakes[2]) && Number(stakes[2]) > 0 && Number(stakes[2]) <= 100_000) {
    state.preferences.stakes = { minBigBlind: Number(stakes[2]), maxBigBlind: Number(stakes[2]) };
  }
  // Legacy radius was not an active geographic filter. Do not silently enable it.
  return state;
}

function validStoredState(raw) {
  const state = decodeMatchState(raw);
  if (!state) throw new MatchStateError('MATCH_STORED_STATE_INVALID', 'Saved Match data could not be validated. No changes were made.', 503);
  return state;
}
function enforceStateSize(state) {
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > maximumMatchStateBytes) {
    throw new MatchStateError('MATCH_STORAGE_LIMIT', 'Saved Match data has reached its storage limit. Remove saved games before adding more.', 413);
  }
}

function createOrbitMatchService(dependencies = {}) {
  const database = async () => dependencies.database || await (dependencies.getDatabase || getDatabase)();
  const now = dependencies.nowMs || Date.now;
  const assertNotDeleting = async (transaction, uid) => {
    if (await transaction.getDocument(playerDeletionMarkerPath(uid))) {
      throw new MatchStateError('PLAYER_ACCOUNT_DELETION_IN_PROGRESS', 'This player account is being deleted and can no longer create or restore data.', 410);
    }
  };
  const readOrSeed = async (transaction, uid, raw) => raw === null
    ? seededMatchState(await transaction.getDocument(`players/${uid}`)) : validStoredState(raw);

  return {
    async read(uid) {
      const path = matchStatePath(uid);
      const store = await database();
      return store.runTransaction(async (transaction) => {
        await assertNotDeleting(transaction, uid);
        const raw = await transaction.getDocument(path);
        const state = await readOrSeed(transaction, uid, raw);
        let pruned = pruneMatchState(state, Number(now()));
        if (JSON.stringify(pruned) !== JSON.stringify(state)) pruned = { ...pruned, revision: state.revision + 1 };
        enforceStateSize(pruned);
        if (raw === null || pruned.revision !== state.revision) transaction.setDocument(path, pruned);
        return pruned;
      });
    },
    async operate(uid, input) {
      const path = matchStatePath(uid);
      if (Buffer.byteLength(JSON.stringify(input) || '', 'utf8') > maximumMatchOperationBytes) {
        throw new MatchStateError('MATCH_OPERATION_TOO_LARGE', 'Match operation is too large.', 413);
      }
      const operation = decodeMatchOperation(input);
      if (!operation) throw new MatchStateError('MATCH_INVALID_OPERATION', 'Match operation is invalid.', 400);
      const digest = matchOperationDigest(operation);
      const receiptPath = operationReceiptPath(uid, operation.mutationId);
      const store = await database();
      return store.runTransaction(async (transaction) => {
        await assertNotDeleting(transaction, uid);
        const raw = await transaction.getDocument(path);
        const receipt = await transaction.getDocument(receiptPath);
        const state = await readOrSeed(transaction, uid, raw);
        if (receipt) {
          if (receipt.digest !== digest) throw new MatchStateError('MATCH_MUTATION_ID_REUSED', 'This Match operation ID was already used for different data.');
          // Return current state, including later changes from another device.
          return pruneMatchState(state, Number(now()));
        }
        if (state.recentMutationIds.includes(operation.mutationId)) {
          throw new MatchStateError('MATCH_RECEIPT_MISSING', 'This Match operation could not be safely replayed. Refresh before continuing.', 503);
        }
        const nowMs = Number(now());
        const next = applyMatchOperation(state, operation, nowMs);
        enforceStateSize(next);
        transaction.setDocument(path, next);
        transaction.createDocument(receiptPath, { digest, receivedAt: new Date(nowMs).toISOString() });
        return next;
      });
    }
  };
}

function createOrbitMatchHandlers(dependencies = {}) {
  const service = createOrbitMatchService(dependencies);
  const respond = async (request, response, operation) => {
    response.set('cache-control', 'private, no-store, max-age=0');
    try {
      const state = await operation(request.orbitPlayer?.uid);
      response.json({ ok: true, state });
    } catch (error) {
      if (!(error instanceof MatchStateError)) throw error;
      response.status(error.status).json({ ok: false, code: error.code, error: error.message });
    }
  };
  return {
    read: (request, response) => respond(request, response, (uid) => service.read(uid)),
    operate: (request, response) => respond(request, response, (uid) => service.operate(uid, request.body))
  };
}

module.exports = { createOrbitMatchHandlers, createOrbitMatchService, matchOperationDigest, matchStatePath, maximumMatchOperationBytes, maximumMatchStateBytes, operationReceiptPath, seededMatchState };
