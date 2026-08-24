import { describe, expect, it } from 'vitest';
import clientRoutes from './client.js';

const { preserveServerManagedState } = clientRoutes;

describe('desktop state route server-owned fields', () => {
  it('preserves the authoritative QR generation and rejects a client-supplied generation when none exists', () => {
    const active = {
      capabilityGeneration: 'current-generation',
      generatedAt: '2026-08-24T12:00:00.000Z'
    };
    const staleClientState = {
      games: [],
      selfCheckIn: {
        capabilityGeneration: 'revoked-generation',
        generatedAt: '2026-08-23T12:00:00.000Z'
      }
    };

    expect(preserveServerManagedState(staleClientState, { selfCheckIn: active })).toEqual({
      games: [],
      selfCheckIn: active
    });
    expect(preserveServerManagedState(staleClientState, { games: [] })).toEqual({ games: [] });
  });
});
