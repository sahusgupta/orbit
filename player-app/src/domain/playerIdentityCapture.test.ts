import { describe, expect, it, vi } from 'vitest';
import { getOrCreateIdentityCaptureAttempt } from './playerIdentityCapture';

describe('Player identity capture retry attempts', () => {
  it('reuses one mutation ID for the same confirmed details until the attempt succeeds', () => {
    const createMutationId = vi.fn()
      .mockReturnValueOnce('identity:player-1:attempt-1')
      .mockReturnValueOnce('identity:player-1:attempt-2');
    const details = {
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St'
    };

    const first = getOrCreateIdentityCaptureAttempt(null, details, createMutationId);
    const retry = getOrCreateIdentityCaptureAttempt(first, { ...details }, createMutationId);
    const corrected = getOrCreateIdentityCaptureAttempt(first, { ...details, address: '101 Main St' }, createMutationId);

    expect(retry).toBe(first);
    expect(retry.mutationId).toBe('identity:player-1:attempt-1');
    expect(corrected.mutationId).toBe('identity:player-1:attempt-2');
    expect(createMutationId).toHaveBeenCalledTimes(2);
  });
});
