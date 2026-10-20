import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatchState } from '../../../../apps/api/src/shared/orbitMatchState.cjs';
import { defaultMatchPreferences, type MatchJournal, type MatchOperation } from '../../domain/orbitMatchTypes';
import { playerMatchPersistence } from './playerMatchRepository';

const boundary = vi.hoisted(() => {
  const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'uid-one' } };
  type Snapshot = { exists(): boolean; data(): unknown; metadata: { hasPendingWrites: boolean; fromCache: boolean } };
  const callbacks: { state?: (snapshot: Snapshot) => void; error?: (failure: { message: string }) => void } = {};
  return { auth, callbacks, db: {}, doc: vi.fn(), onSnapshot: vi.fn(), unsubscribe: vi.fn(), fetchState: vi.fn(), mutate: vi.fn(), load: vi.fn(), save: vi.fn() };
});
vi.mock('firebase/firestore', () => ({ doc: boundary.doc, onSnapshot: boundary.onSnapshot }));
vi.mock('./firebaseClient', () => ({ auth: boundary.auth, db: boundary.db }));
vi.mock('../api/playerHttpApi', () => ({ fetchRemoteMatchState: boundary.fetchState, submitRemoteMatchOperation: boundary.mutate }));
vi.mock('../storage/playerStorage', () => ({ playerStorage: { loadMatchJournal: boundary.load, saveMatchJournal: boundary.save } }));

describe('Authenticated player Match repository boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.auth.currentUser = { uid: 'uid-one' };
    boundary.callbacks.state = undefined;
    boundary.callbacks.error = undefined;
    boundary.doc.mockReturnValue({ path: 'players/uid-one/orbitMatch/state' });
    boundary.onSnapshot.mockImplementation((_reference, onState, onError) => {
      boundary.callbacks.state = onState;
      boundary.callbacks.error = onError;
      return boundary.unsubscribe;
    });
  });

  it('delegates journals by UID and remote operation identity without direct client writes', async () => {
    const journal: MatchJournal = { uid: 'uid-one', confirmed: createMatchState(), pending: [] };
    const operation: MatchOperation = { mutationId: 'mutation-id-00000001', type: 'event', event: { kind: 'opened' } };
    await playerMatchPersistence.loadJournal('uid-one');
    await playerMatchPersistence.saveJournal('uid-one', journal);
    await playerMatchPersistence.fetchState('uid-one');
    await playerMatchPersistence.mutate('uid-one', operation);
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith('uid-one');
    expect(boundary.save).toHaveBeenCalledExactlyOnceWith('uid-one', journal);
    expect(boundary.fetchState).toHaveBeenCalledExactlyOnceWith('uid-one');
    expect(boundary.mutate).toHaveBeenCalledExactlyOnceWith('uid-one', operation);
    expect(boundary.doc).not.toHaveBeenCalled();
  });

  it('fails closed before installing a listener for a different or missing identity', () => {
    const onError = vi.fn();
    playerMatchPersistence.subscribe('uid-other', vi.fn(), onError)();
    boundary.auth.currentUser = null;
    playerMatchPersistence.subscribe('uid-one', vi.fn(), onError)();
    expect(boundary.onSnapshot).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('reads only server-confirmed Match state from the authenticated owner path', () => {
    const onState = vi.fn();
    const onError = vi.fn();
    const unsubscribe = playerMatchPersistence.subscribe('uid-one', onState, onError);
    expect(boundary.doc).toHaveBeenCalledExactlyOnceWith(boundary.db, 'players', 'uid-one', 'orbitMatch', 'state');
    const state = createMatchState(defaultMatchPreferences);
    const push = (exists: boolean, fromCache: boolean, hasPendingWrites: boolean, value: unknown = state) => {
      boundary.callbacks.state?.({ exists: () => exists, data: () => value, metadata: { fromCache, hasPendingWrites } });
    };
    push(false, false, false);
    push(true, true, false);
    push(true, false, true);
    expect(onState).not.toHaveBeenCalled();
    push(true, false, false);
    expect(onState).toHaveBeenCalledExactlyOnceWith(state);
    push(true, false, false, { invalid: true });
    expect(onError.mock.calls[0][0].message).toContain('Saved Match data is invalid');
    unsubscribe();
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('reports an active owner SDK failure once without reading or mutating Match data', () => {
    const onState = vi.fn();
    const onError = vi.fn<(failure: Error) => void>();
    const failure = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    const unsubscribe = playerMatchPersistence.subscribe('uid-one', onState, onError);
    boundary.callbacks.error?.(failure);
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).not.toBe('');
    expect(onState).not.toHaveBeenCalled();
    for (const operation of [boundary.load, boundary.save, boundary.fetchState, boundary.mutate]) {
      expect(operation).not.toHaveBeenCalled();
    }
    expect(boundary.unsubscribe).not.toHaveBeenCalled();
    unsubscribe();
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('preserves the precise identity and invalid-state recovery messages', () => {
    const onState = vi.fn();
    const onError = vi.fn<(failure: Error) => void>();
    playerMatchPersistence.subscribe('uid-other', onState, onError)();
    boundary.auth.currentUser = null;
    playerMatchPersistence.subscribe('uid-one', onState, onError)();
    expect(boundary.onSnapshot).not.toHaveBeenCalled();
    boundary.auth.currentUser = { uid: 'uid-one' };
    const unsubscribe = playerMatchPersistence.subscribe('uid-one', onState, onError);
    boundary.callbacks.state?.({ exists: () => true, data: () => ({ invalid: true }), metadata: { fromCache: false, hasPendingWrites: false } });
    expect(onError.mock.calls.map(([failure]) => failure.message)).toEqual([
      'Sign in to restore Match on your other devices.',
      'Sign in to restore Match on your other devices.',
      'Saved Match data is invalid. Retry sync.'
    ]);
    expect(onError.mock.calls.every(([failure]) => failure instanceof Error)).toBe(true);
    expect(onState).not.toHaveBeenCalled();
    expect(boundary.unsubscribe).not.toHaveBeenCalled();
    unsubscribe();
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([
    { label: 'observed emulator rules denial', message: "\nfalse for 'get' @ L197, false for 'get' @ L282", code: 'permission-denied' },
    { label: 'ordinary permission denial', message: 'Missing or insufficient permissions.', code: 'permission-denied' },
    { label: 'another terminal SDK failure', message: 'Firestore stream closed unexpectedly.', code: 'unavailable' }
  ])('uses readable sync copy while retaining the original SDK cause in memory: $label', ({ message, code }) => {
    const onState = vi.fn();
    const onError = vi.fn<(failure: Error) => void>();
    const failure = Object.freeze(Object.assign(new Error(message), { name: 'FirebaseError', code }));
    const unsubscribe = playerMatchPersistence.subscribe('uid-one', onState, onError);
    boundary.callbacks.error?.(failure);
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
    const reported = onError.mock.calls[0][0];
    expect.soft(reported.message).toBe('Could not sync your Match data. Try again shortly.');
    expect.soft(reported.cause).toBe(failure);
    expect.soft(Object.getOwnPropertyDescriptor(reported, 'cause')?.enumerable).toBe(false);
    expect(failure.message).toBe(message);
    expect(failure.code).toBe(code);
    expect(onState).not.toHaveBeenCalled();
    for (const operation of [boundary.load, boundary.save, boundary.fetchState, boundary.mutate]) {
      expect(operation).not.toHaveBeenCalled();
    }
    unsubscribe();
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });

  it('retires state and error callbacks when authentication changes', () => {
    const onState = vi.fn();
    const onError = vi.fn();
    playerMatchPersistence.subscribe('uid-one', onState, onError);
    boundary.auth.currentUser = { uid: 'uid-other' };
    boundary.callbacks.state?.({ exists: () => true, data: () => createMatchState(), metadata: { fromCache: false, hasPendingWrites: false } });
    boundary.callbacks.error?.({ message: 'Old owner error' });
    expect(onState).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
