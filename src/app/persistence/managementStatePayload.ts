export const maximumManagementStatePayloadBytes = 2_000_000;

export const getManagementStatePayloadBytes = (state: unknown) =>
  new TextEncoder().encode(JSON.stringify(state)).byteLength;

export const getManagementStatePayloadError = (state: unknown) => {
  const payloadBytes = getManagementStatePayloadBytes(state);
  if (payloadBytes <= maximumManagementStatePayloadBytes) return '';
  return `This change would make the management state ${payloadBytes.toLocaleString()} bytes, above Orbit's ${maximumManagementStatePayloadBytes.toLocaleString()}-byte save limit. Export a backup and contact Orbit support to archive retained records safely, then retry. Accounting and audit history have been preserved.`;
};

export const getManagementStatePayloadContributions = (state: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key, getManagementStatePayloadBytes({ [key]: value }) - 2
  ]));

// Usage events are already best-effort, newest-first telemetry capped at 5,000.
// Under byte pressure retain the newest events that fit, never operational history.
export const compactManagementUsageTelemetry = <T extends { usageEvents: unknown[] }>(state: T): T => {
  if (getManagementStatePayloadBytes(state) <= maximumManagementStatePayloadBytes || state.usageEvents.length < 2) return state;
  const emptyBytes = getManagementStatePayloadBytes({ ...state, usageEvents: [] });
  let bytes = emptyBytes;
  let count = 0;
  for (const event of state.usageEvents) {
    const eventBytes = getManagementStatePayloadBytes(event) + (count ? 1 : 0);
    if (bytes + eventBytes > maximumManagementStatePayloadBytes) break;
    bytes += eventBytes;
    count += 1;
  }
  // Keep the current action's telemetry: if it cannot fit, reject truthfully.
  return count ? { ...state, usageEvents: state.usageEvents.slice(0, count) } : state;
};
