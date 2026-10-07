import { describe, expect, it } from 'vitest';
import { managementSaveOutcome, mutationActionError } from './mutationResult';

describe('management mutation outcomes', () => {
  it.each(['published', 'server-pending', 'failed'] as const)('keeps an authoritative save separate from %s projection', (cloud) => {
    expect(managementSaveOutcome({ ok: true, cloud, revision: 9 })).toEqual({ ok: true, status: 'authoritative-saved', cloud, revision: 9 });
  });
  it('rejects conflicts and failed saves without inferring success from an empty callback', () => {
    expect(managementSaveOutcome({ ok: false, cloud: 'not-committed', conflict: true, error: 'STATE_REVISION_CONFLICT' })).toMatchObject({ ok: false, status: 'revision-conflict', conflict: true });
    const failure = managementSaveOutcome({ ok: false, cloud: 'not-committed', error: 'API unavailable' });
    expect(failure).toMatchObject({ ok: false, status: 'save-failed' });
    expect(mutationActionError(failure)).toBe('API unavailable');
    expect(mutationActionError(undefined)).not.toBe('');
    expect(mutationActionError(false)).not.toBe('');
    expect(mutationActionError(true)).toBe('');
  });
});
