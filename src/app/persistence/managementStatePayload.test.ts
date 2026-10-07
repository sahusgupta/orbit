import { describe, expect, it } from 'vitest';
import {
  compactManagementUsageTelemetry,
  getManagementStatePayloadContributions,
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


describe('bounded disposable telemetry retention', () => {
  it('removes only oldest usage telemetry under byte pressure and preserves operational/audit data', () => {
    const state = {
      profiles: [{ id: 'synthetic', notes: 'preserved' }],
      playerLedger: [{ id: 'receipt', amount: 50 }],
      correctionLog: [{ id: 'correction', note: 'preserved' }],
      usageEvents: Array.from({ length: 5000 }, (_, index) => ({ id: String(index), metadata: { marker: 'x'.repeat(500) } }))
    };
    const compacted = compactManagementUsageTelemetry(state);
    expect(getManagementStatePayloadBytes(state)).toBeGreaterThan(maximumManagementStatePayloadBytes);
    expect(getManagementStatePayloadBytes(compacted)).toBeLessThanOrEqual(maximumManagementStatePayloadBytes);
    expect(compacted.usageEvents[0]).toBe(state.usageEvents[0]);
    expect(compacted.usageEvents).toEqual(state.usageEvents.slice(0, compacted.usageEvents.length));
    expect(compacted.playerLedger).toBe(state.playerLedger);
    expect(compacted.correctionLog).toBe(state.correctionLog);
    expect(compacted.profiles).toBe(state.profiles);
    expect(state.usageEvents).toHaveLength(5000);
  });

  it('rejects operational growth even when removing telemetry cannot make room for the current event', () => {
    const state = { playerLedger: [{ note: 'x'.repeat(maximumManagementStatePayloadBytes) }], usageEvents: [{ id: 'newest' }, { id: 'oldest' }] };
    expect(compactManagementUsageTelemetry(state)).toBe(state);
    expect(getManagementStatePayloadError(state)).toContain('Accounting and audit history have been preserved');
  });

  it('accounts for every top-level property, UTF-8 values, and JSON separators exactly', () => {
    const state = { profiles: [{ name: '♠' }], interests: [], history: [], usageEvents: [] };
    const sizes = getManagementStatePayloadContributions(state);
    expect(Object.keys(sizes)).toEqual(Object.keys(state));
    expect(Object.values(sizes).reduce((sum, bytes) => sum + bytes, 0) + Object.keys(state).length - 1 + 2).toBe(getManagementStatePayloadBytes(state));
  });
});
