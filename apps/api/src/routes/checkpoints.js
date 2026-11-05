const checkpoints = require('../db/checkpoints');
const { asyncRoute } = require('../http/auth');
const { schedulePublicationDrain } = require('../db/publicationOutbox');
const { sanitizeAccountKey } = require('../orbitCore');
const { logDomainChange, logStateChanges } = require('../http/domainEvents');
const { protectedIdentifier } = require('../http/dataProtection');

function authenticatedAccount(request, supplied) {
  const authenticated = request.orbitAuth?.accountKey;
  if (authenticated && supplied && authenticated !== supplied) {
    throw new checkpoints.CheckpointError(403, 'CHECKPOINT_TENANT_MISMATCH', 'Authenticated tenant cannot access another venue checkpoint.');
  }
  const key = authenticated || supplied;
  if (!key || sanitizeAccountKey(key) !== key) {
    throw new checkpoints.CheckpointError(400, 'CHECKPOINT_ACCOUNT_INVALID', 'A normalized accountKey is required.');
  }
  return key;
}

function registerCheckpointRoutes(app) {
  const cleanupDiagnostic = (accountKey) => () => logDomainChange('checkpoint-staging-cleanup-pending', {
    tenantRef: protectedIdentifier(accountKey)
  });
  app.get('/state/capabilities', (_request, response) => {
    response.json({ ok: true, checkpoint: checkpoints.checkpointLimits });
  });
  app.post('/state/checkpoints', asyncRoute(async (request, response) => {
    const accountKey = authenticatedAccount(request, request.body?.accountKey);
    const result = await checkpoints.beginCheckpoint({ ...request.body, accountKey }, undefined, {
      onCleanupPending: cleanupDiagnostic(accountKey)
    });
    response.status(result.completed ? 200 : 201).json(result);
  }));
  app.get('/state/checkpoints/:id', asyncRoute(async (request, response) => {
    const accountKey = authenticatedAccount(request, request.query.accountKey);
    response.json(await checkpoints.checkpointStatus(accountKey, request.params.id));
  }));
  app.post('/state/checkpoints/:id/chunks/:index', asyncRoute(async (request, response) => {
    const accountKey = authenticatedAccount(request, request.body?.accountKey);
    response.json(await checkpoints.putCheckpointChunk(accountKey, request.params.id, Number(request.params.index), request.body?.data));
  }));
  app.post('/state/checkpoints/:id/finalize', asyncRoute(async (request, response) => {
    const accountKey = authenticatedAccount(request, request.body?.accountKey);
    const result = await checkpoints.finalizeCheckpoint(accountKey, request.params.id, undefined, {
      onCommittedState: (previousState, nextState) => logStateChanges(previousState, nextState, accountKey),
      onCleanupPending: cleanupDiagnostic(accountKey)
    });
    logDomainChange('checkpoint-committed', {
      tenantRef: protectedIdentifier(accountKey), revision: result.revision, duplicate: result.duplicate,
      protocol: checkpoints.checkpointLimits.protocol, publicationStatus: result.publication?.status || 'pending'
    });
    void schedulePublicationDrain().catch(() => undefined);
    response.status(result.duplicate ? 200 : 201).json(result);
  }));
  app.get('/state/checkpoint/:accountKey', asyncRoute(async (request, response) => {
    const accountKey = authenticatedAccount(request, request.params.accountKey);
    const rawRevision = request.query.knownRevision;
    if (rawRevision !== undefined && (typeof rawRevision !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(rawRevision))) {
      throw new checkpoints.CheckpointError(400, 'CHECKPOINT_REVISION_INVALID', 'A non-negative knownRevision is required.');
    }
    response.json(await checkpoints.checkpointManifest(accountKey, rawRevision === undefined ? undefined : Number(rawRevision)));
  }));
  app.get('/state/checkpoint/:accountKey/:revision/chunks/:index', asyncRoute(async (request, response) => {
    const accountKey = authenticatedAccount(request, request.params.accountKey);
    response.json(await checkpoints.getCheckpointChunk(accountKey, Number(request.params.revision), Number(request.params.index)));
  }));
}

module.exports = { authenticatedAccount, registerCheckpointRoutes };
