export const maximumManagementStatePayloadBytes = 2_000_000;

export const getManagementStatePayloadBytes = (state: unknown) =>
  new TextEncoder().encode(JSON.stringify(state)).byteLength;

export const getManagementStatePayloadError = (state: unknown) => {
  const payloadBytes = getManagementStatePayloadBytes(state);
  if (payloadBytes <= maximumManagementStatePayloadBytes) return '';
  return `This change would make the management state ${payloadBytes.toLocaleString()} bytes, above Orbit's ${maximumManagementStatePayloadBytes.toLocaleString()}-byte save limit. Reduce imported or retained records before retrying.`;
};
