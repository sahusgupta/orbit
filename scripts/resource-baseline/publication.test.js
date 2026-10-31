import { describe, expect, it } from 'vitest';
import publication from './publication.cjs';

describe('isolated publication resource baseline', () => {
  it.each([0, 10, 250, 501, 1000])('counts real publisher operations for %i synthetic players', async (players) => {
    const originalFetch = globalThis.fetch;
    const result = await publication.measurePublication({ players });
    const pages = Math.max(1, Math.ceil(players / 500));
    expect(result.operations.documentUpdates).toBe(1 + 2 * players);
    expect(result.operations.updateBatchRequests).toBe(Math.ceil((1 + 2 * players) / 250));
    expect(result.operations.listRequestsByCollection.players).toBe(players ? 2 * pages : 1);
    expect(result.operations.listRequestsByCollection.memberships).toBe(pages);
    expect(result.operations.listedDocuments).toBe(3 * players);
    expect(result.operations.documentDeletes).toBe(0);
    expect(result.operations.parentWrites).toBe(1);
    expect(result.operations.requestBodyBytes).toBeGreaterThan(0);
    expect(result.operations.responseBodyBytes).toBeGreaterThan(0);
    expect(result.parentMarkerLast).toBe(true);
    expect(result.unexpectedRequests).toBe(0);
    expect(result.finalDocumentCount).toBe(2 * players + 2);
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.memory.sampledHeapUsedMax).toBeGreaterThanOrEqual(result.memory.heapUsedBefore);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it('applies stale cleanup before the legacy scan and preserves foreign documents', async () => {
    const result = await publication.measurePublication({ players: 10, stalePlayers: 3, legacyPlayers: 2, foreignPlayers: 4 });
    expect(result.operations.documentDeletes).toBe(5);
    expect(result.operations.deleteBatchRequests).toBe(2);
    // Players: 19 before owned cleanup, 16 afterwards; memberships: 10.
    expect(result.operations.listedDocumentsByCollection.players).toBe(35);
    expect(result.operations.listedDocuments).toBe(45);
    expect(result.finalDocumentCount).toBe(26);
  });

  it('reproduces operation counts and final documents across samples', async () => {
    const result = await publication.measurePublication({ players: 10, sampleCount: 3 });
    expect(result.sampleCount).toBe(3);
    expect(result.samples).toHaveLength(3);
  });

  it('returns stable worker results after resetting the stateful transport', async () => {
    const run = publication.createPublicationScenario({ players: 10, stalePlayers: 3, legacyPlayers: 2, foreignPlayers: 4 });
    const first = await run();
    const second = await run();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first).toMatchObject({ kind: 'publication', response: { finalDocumentCount: 26, parentMarkerLast: true, unexpectedRequests: 0 } });
    expect(first).not.toHaveProperty('durationMs');
    expect(first).not.toHaveProperty('memory');
  });

  it.each([-1, 1.5, 10_001, NaN])('rejects invalid fixture size %s before loading the publisher', async (players) => {
    await expect(publication.measurePublication({ players })).rejects.toThrow('players must be an integer');
  });

  it('rejects legacy counts larger than the profile set', async () => {
    await expect(publication.measurePublication({ players: 1, legacyPlayers: 2 })).rejects.toThrow('legacyPlayers must be an integer');
  });
});
