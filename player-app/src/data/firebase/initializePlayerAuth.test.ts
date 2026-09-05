import { describe, expect, it, vi } from 'vitest';
import type { Auth, Persistence } from 'firebase/auth';
import { initializePlayerAuth } from './initializePlayerAuth';

describe('Firebase Auth initialization', () => {
  it('initializes with the supplied durable persistence adapter', () => {
    const app = {} as never;
    const persistence = { type: 'LOCAL' } as Persistence;
    const initialized = {} as Auth;
    const initialize = vi.fn(() => initialized);
    const getExisting = vi.fn(() => ({} as Auth));

    expect(initializePlayerAuth(app, persistence, { getExisting, initialize })).toBe(initialized);
    expect(initialize).toHaveBeenCalledWith(app, { persistence });
    expect(getExisting).not.toHaveBeenCalled();
  });

  it('reuses an already-initialized persisted Auth instance', () => {
    const existing = {} as Auth;
    const getExisting = vi.fn(() => existing);

    expect(initializePlayerAuth({} as never, { type: 'LOCAL' } as Persistence, {
      getExisting,
      initialize: () => { throw Object.assign(new Error('already initialized'), { code: 'auth/already-initialized' }); }
    })).toBe(existing);
    expect(getExisting).toHaveBeenCalledOnce();
  });

  it('fails closed when durable persistence initialization itself fails', () => {
    const getExisting = vi.fn(() => ({} as Auth));
    const failure = Object.assign(new Error('AsyncStorage unavailable'), { code: 'auth/internal-error' });

    expect(() => initializePlayerAuth({} as never, { type: 'LOCAL' } as Persistence, {
      getExisting,
      initialize: () => { throw failure; }
    })).toThrow(failure);
    expect(getExisting).not.toHaveBeenCalled();
  });
});
