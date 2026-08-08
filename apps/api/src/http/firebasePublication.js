const { publishStateToFirebase } = require('../firebasePublisher');

async function publishStateForResponse(state) {
  try {
    return await publishStateToFirebase(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Firebase publish failed.';
    console.warn('[firebase] publish failed:', message);
    return { ok: false, error: message };
  }
}

module.exports = { publishStateForResponse };
