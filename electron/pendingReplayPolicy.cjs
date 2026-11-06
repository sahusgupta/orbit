const { isRecord } = require('./runtimeUtils.cjs');

/**
 * @typedef {{ schemaVersion: 1, mutationId: string, sha256: string, expectedRevision: number,
 *   kind: 'auth' | 'permanent' | 'transient', httpStatus: number, failureType: 'http' | 'application' | 'transport' | 'capability',
 *   code?: 'STATE_REVISION_CONFLICT', attempts: number, notBeforeMs: number }} PendingRetryPolicy
 */
/**
 * Validate additive metadata without changing the retained operation.
 * @param {unknown} value
 * @param {{ mutationId: string, sha256: string, expectedRevision: number }} pending
 * @returns {PendingRetryPolicy}
 */
function validatePendingRetryPolicy(value, pending) {
  if (!isRecord(value) || Object.keys(value).some(key => !['schemaVersion', 'mutationId', 'sha256', 'expectedRevision', 'kind', 'httpStatus', 'failureType', 'code', 'attempts', 'notBeforeMs'].includes(key))
    || value.schemaVersion !== 1 || typeof value.mutationId !== 'string' || typeof value.sha256 !== 'string' || value.mutationId !== pending.mutationId || value.sha256 !== pending.sha256
    || typeof value.expectedRevision !== 'number' || value.expectedRevision !== pending.expectedRevision
    || value.kind !== 'auth' && value.kind !== 'permanent' && value.kind !== 'transient'
    || typeof value.httpStatus !== 'number' || !Number.isSafeInteger(value.httpStatus) || value.httpStatus < 0 || value.httpStatus > 599
    || value.httpStatus !== 0 && value.httpStatus < 100
    || value.failureType !== 'http' && value.failureType !== 'application' && value.failureType !== 'transport' && value.failureType !== 'capability'
    || value.code !== undefined && value.code !== 'STATE_REVISION_CONFLICT'
    || value.failureType === 'transport' && value.httpStatus !== 0
    || value.failureType === 'application' && (value.httpStatus < 200 || value.httpStatus >= 300)
    || typeof value.attempts !== 'number' || !Number.isSafeInteger(value.attempts) || value.attempts < 1 || value.attempts > 1_000_000
    || typeof value.notBeforeMs !== 'number' || !Number.isSafeInteger(value.notBeforeMs) || value.notBeforeMs < 0 || value.notBeforeMs > 8_640_000_000_000_000
    || value.kind === 'auth' && ![401, 403].includes(value.httpStatus)
    || value.kind === 'permanent' && value.code !== 'STATE_REVISION_CONFLICT' && (value.httpStatus < 400 || value.httpStatus >= 500 || [401, 403, 429].includes(value.httpStatus))
    || value.kind === 'transient' && (value.httpStatus === 401 || value.httpStatus === 403 || value.code === 'STATE_REVISION_CONFLICT'
      || value.failureType !== 'capability' && value.httpStatus >= 400 && value.httpStatus < 500 && value.httpStatus !== 429)) {
    throw new Error('The pending retry policy cannot be recovered safely. Preserve the local cache for recovery.');
  }
  /** @type {PendingRetryPolicy['code']} */
  const code = value.code === 'STATE_REVISION_CONFLICT' ? value.code : undefined;
  return { schemaVersion: 1, mutationId: value.mutationId, sha256: value.sha256, expectedRevision: value.expectedRevision,
    kind: value.kind, httpStatus: value.httpStatus, failureType: value.failureType, ...(code ? { code } : {}), attempts: value.attempts, notBeforeMs: value.notBeforeMs };
}

module.exports = { validatePendingRetryPolicy };
