const { getDatabase } = require('./connection');

const collection = 'orbitRateLimits';

async function consumeRateLimit({ key, windowMs, maximum }, getStore = getDatabase) {
  const store = await getStore();
  const isolatedMemory = !process.env.VERCEL && process.env.ORBIT_FIRESTORE_MEMORY === 'true';
  if ((process.env.VERCEL || (process.env.NODE_ENV === 'production' && !isolatedMemory)) && store.mode !== 'firestore') {
    throw new Error('Production rate limiting requires the authoritative Firestore store.');
  }
  return store.runTransaction(async (transaction) => {
    const documentPath = `${collection}/${key}`;
    const previous = await transaction.getDocument(documentPath);
    // Sample time on every transaction attempt, including contention retries.
    const now = Date.now();
    if (previous && (!Number.isSafeInteger(previous.count) || previous.count < 1
      || !Number.isSafeInteger(previous.resetAt) || previous.resetAt < 1)) {
      throw new Error('Invalid durable rate-limit state.');
    }
    const active = previous && previous.resetAt > now;
    const count = active ? previous.count : 0;
    const resetAt = active ? previous.resetAt : now + windowMs;
    const nextCount = Math.min(count + 1, maximum + 1);
    // Persist the first rejection once. Further rejected requests do not extend
    // retention or generate repeated writes/alerts for an exhausted quota.
    if (!active || count < maximum + 1) {
      await transaction.setDocument(documentPath, {
        count: nextCount,
        resetAt,
        expiresAt: new Date(resetAt)
      });
    }
    return { count: nextCount, resetAt, firstRejection: count === maximum };
  });
}

module.exports = { consumeRateLimit };
