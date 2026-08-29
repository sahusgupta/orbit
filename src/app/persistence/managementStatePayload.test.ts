import { describe, expect, it } from 'vitest';
import {
  getManagementStatePayloadBytes,
  getManagementStatePayloadError,
  maximumManagementStatePayloadBytes
} from './managementStatePayload';

describe('management state payload boundary', () => {
  it('measures serialized UTF-8 bytes rather than JavaScript character count', () => {
    const state = { label: 'Orbit ♠' };

    expect(getManagementStatePayloadBytes(state)).toBe(new TextEncoder().encode(JSON.stringify(state)).byteLength);
    expect(getManagementStatePayloadBytes(state)).toBeGreaterThan(JSON.stringify(state).length);
  });

  it('rejects state beyond the Electron IPC save limit with a truthful size', () => {
    expect(getManagementStatePayloadError({ profiles: [] })).toBe('');

    const oversized = { value: 'x'.repeat(maximumManagementStatePayloadBytes) };
    const payloadBytes = getManagementStatePayloadBytes(oversized);
    expect(payloadBytes).toBeGreaterThan(maximumManagementStatePayloadBytes);
    expect(getManagementStatePayloadError(oversized)).toContain(payloadBytes.toLocaleString());
  });
});
