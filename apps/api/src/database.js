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
const { getPublicationStatus, listStatePage, listVenues, loadLatestState, loadState, saveState, StateConflictError } = require('./db/state');
const { drainPublicationOutbox, listPublicationOutbox, schedulePublicationDrain } = require('./db/publicationOutbox');
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
  listStatePage,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordManagementSecurityEvent,
  recordTelemetryEvent,
  recordUpdateEvent,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride,
  saveState,
  schedulePublicationDrain,
  StateConflictError,
  storeAnalyticalReport,
  upsertClient
};
