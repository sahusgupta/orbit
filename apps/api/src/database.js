const { closeDatabase, getDatabasePath, getDatabaseStatus } = require('./db/connection');
const { getClient, listClients, upsertClient } = require('./db/clients');
const {
  getTelemetrySummary,
  listClientErrors,
  listClientUpdateEvents,
  listTelemetryEvents,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent
} = require('./db/telemetry');
const { getPublicationStatus, listVenues, loadLatestState, loadState, saveState, StateConflictError } = require('./db/state');
const { drainPublicationOutbox, listPublicationOutbox, schedulePublicationDrain } = require('./db/publicationOutbox');
const { storeAnalyticalReport } = require('./db/reports');

module.exports = {
  closeDatabase,
  drainPublicationOutbox,
  getClient,
  getDatabasePath,
  getDatabaseStatus,
  getPublicationStatus,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listPublicationOutbox,
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
