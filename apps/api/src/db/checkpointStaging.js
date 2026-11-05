const crypto = require('crypto');
const { getDatabase } = require('./connection');

const maximumStagingChunks = 128;
const stagingPath = (accountKey) => `orbitStateCheckpoints/${crypto.createHash('sha256').update(accountKey).digest('hex')}`;
const chunkPath = (accountKey, index) => `${stagingPath(accountKey)}/checkpointChunks/${String(index).padStart(3, '0')}`;

async function cleanupInactiveChunks(accountKey, maximumSlots) {
  const database = await getDatabase();
  const slots = Math.min(Math.max(Number(maximumSlots || 0), 0), maximumStagingChunks);
  // Firestore charges deleted document/index bytes toward its transaction
  // limit. Eight raw chunks leave ample overhead below 10 MiB per batch.
  for (let offset = 0; offset < slots; offset += 8) {
    await database.runTransaction(async (transaction) => {
      const current = await transaction.getDocument(stagingPath(accountKey));
      const indices = Array.from({ length: Math.min(8, slots - offset) }, (_, index) => offset + index);
      const chunks = [];
      for (const index of indices) chunks.push(await transaction.getDocument(chunkPath(accountKey, index)));
      chunks.forEach((chunk, position) => {
        if (chunk && (!current || current.completed || chunk.generation !== current.generation)) {
          transaction.deleteDocument(chunkPath(accountKey, indices[position]));
        }
      });
    });
  }
  if (slots) {
    await database.runTransaction(async (transaction) => {
      const current = await transaction.getDocument(stagingPath(accountKey));
      if (current && slots >= Number(current.stagingSlots ?? current.chunkCount)) {
        transaction.setDocument(stagingPath(accountKey), {
          ...current, stagingSlots: current.completed ? 0 : current.chunkCount
        });
      }
    });
  }
}

async function invalidateAccountCheckpoint(accountKey) {
  const database = await getDatabase();
  await database.runTransaction(async (transaction) => {
    transaction.deleteDocument(stagingPath(accountKey));
  });
  await cleanupInactiveChunks(accountKey, maximumStagingChunks);
}

module.exports = { maximumStagingChunks, stagingPath, chunkPath, cleanupInactiveChunks, invalidateAccountCheckpoint };
