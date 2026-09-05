const crypto = require('crypto');
const { getDatabase } = require('./db/connection');

const deletionMarkersCollection = 'orbitPlayerDeletionMarkers';
const deletionBlocksCollection = 'playerDeletionBlocks';

function normalizedPlayerId(playerId) {
  const value = String(playerId || '').trim();
  if (!value || value.includes('/')) throw new Error('A valid Firebase player ID is required.');
  return value;
}

function playerDeletionMarkerId(playerId) {
  const value = normalizedPlayerId(playerId);
  return `deleted_${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function playerDeletionMarkerPath(playerId) {
  return `${deletionMarkersCollection}/${playerDeletionMarkerId(playerId)}`;
}

function playerDeletionBlockPath(playerId) {
  return `${deletionBlocksCollection}/${normalizedPlayerId(playerId)}`;
}

async function markPlayerDeletion(database, playerId, options = {}) {
  const markerPath = playerDeletionMarkerPath(playerId);
  const blockPath = playerDeletionBlockPath(playerId);
  const now = new Date(Number((options.nowMs || Date.now)())).toISOString();
  await database.runTransaction(async (transaction) => {
    const marker = await transaction.getDocument(markerPath);
    const block = await transaction.getDocument(blockPath);
    transaction.setDocument(markerPath, {
      status: 'blocked',
      createdAt: marker?.createdAt || now,
      updatedAt: now
    });
    transaction.setDocument(blockPath, {
      status: 'blocked',
      createdAt: block?.createdAt || now,
      updatedAt: now
    });
  });
  return { markerPath, blockPath };
}

async function isPlayerDeletionMarked(playerId, dependencies = {}) {
  const database = dependencies.database || await (dependencies.getDatabase || getDatabase)();
  return Boolean(await database.getDocument(playerDeletionMarkerPath(playerId)));
}

async function isPlayerDeletionMarkedInAdminDatabase(database, playerId) {
  const snapshot = await database.doc(playerDeletionMarkerPath(playerId)).get();
  return snapshot.exists;
}

function createRequireActivePlayerAccount(dependencies = {}) {
  const checkDeletionMarker = dependencies.isPlayerDeletionMarked || isPlayerDeletionMarked;
  return async function requireActivePlayerAccount(request, response, next) {
    try {
      if (await checkDeletionMarker(request.orbitPlayer?.uid, dependencies)) {
        response.status(410).json({
          ok: false,
          code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS',
          error: 'This player account is being deleted and can no longer create or restore data.'
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requireActivePlayerAccount = createRequireActivePlayerAccount();

module.exports = {
  createRequireActivePlayerAccount,
  deletionBlocksCollection,
  deletionMarkersCollection,
  isPlayerDeletionMarked,
  isPlayerDeletionMarkedInAdminDatabase,
  markPlayerDeletion,
  playerDeletionBlockPath,
  playerDeletionMarkerId,
  playerDeletionMarkerPath,
  requireActivePlayerAccount
};
