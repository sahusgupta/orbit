const { closeDatabase, getDatabasePath } = require('./db/connection');
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
const { listVenues, loadLatestState, loadState, saveState } = require('./db/state');
const { storeAnalyticalReport } = require('./db/reports');

module.exports = {
  closeDatabase,
  getClient,
  getDatabasePath,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  saveState,
  storeAnalyticalReport,
  upsertClient
};
