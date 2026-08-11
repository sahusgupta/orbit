const { closeDatabase, getDatabasePath, getDatabaseStatus } = require('./db/connection');
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

module.exports = {
  closeDatabase,
  drainPublicationOutbox,
  getClient,
  getDatabasePath,
  getDatabaseStatus,
  getPublicationStatus,
  getOperationalQueryPlans,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listPublicationOutbox,
  listStatePage,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  saveState,
  schedulePublicationDrain,
  StateConflictError,
  storeAnalyticalReport,
  upsertClient
};
