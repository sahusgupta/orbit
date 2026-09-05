const { closeDatabase, getDatabaseStatus } = require('./db/connection');
const { getClient, listClients, upsertClient } = require('./db/clients');
const {
  getOperationalQueryPlans,
  getTelemetrySummary,
  listClientErrors,
  listClientUpdateEvents,
  listTelemetryEvents,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent
} = require('./db/telemetry');
const {
  getPublicationStatus,
  listStatePage,
  listVenues,
  loadGlobalMutationReceipt,
  loadStateMutationReceipt,
  loadLatestState,
  loadState,
  saveState,
  StateConflictError
} = require('./db/state');
const {
  drainPublicationOutbox,
  listPublicationOutbox,
  recoverAbandonedPublicationClaim,
  schedulePublicationDrain
} = require('./db/publicationOutbox');
const { storeAnalyticalReport } = require('./db/reports');
const {
  claimManagementRecoveryOverride,
  consumeManagementRecoveryOverride,
  createManagementRecoveryOverride,
  getManagementRecoveryOverride,
  listManagementRecoveryOverrides,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride
} = require('./db/managementRecovery');
const { listManagementSecurityEvents, recordManagementSecurityEvent } = require('./db/managementSecurityEvents');
const { listLegacyStates, loadLegacyState } = require('./db/legacyState');

module.exports = {
  closeDatabase,
  claimManagementRecoveryOverride,
  consumeManagementRecoveryOverride,
  createManagementRecoveryOverride,
  drainPublicationOutbox,
  getClient,
  getDatabaseStatus,
  getPublicationStatus,
  getOperationalQueryPlans,
  getManagementRecoveryOverride,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listPublicationOutbox,
  listManagementRecoveryOverrides,
  listManagementSecurityEvents,
  listLegacyStates,
  listStatePage,
  listVenues,
  loadGlobalMutationReceipt,
  loadStateMutationReceipt,
  loadLatestState,
  loadLegacyState,
  loadState,
  recordClientError,
  recordManagementSecurityEvent,
  recordTelemetryEvent,
  recordUpdateEvent,
  recoverAbandonedPublicationClaim,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride,
  saveState,
  schedulePublicationDrain,
  StateConflictError,
  storeAnalyticalReport,
  upsertClient
};
