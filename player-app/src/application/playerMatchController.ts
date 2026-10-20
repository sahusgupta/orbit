import { applyMatchOperation, createMatchState, decodeMatchOperation, decodeMatchState } from '../../../apps/api/src/shared/orbitMatchState.cjs';
import { matchReferenceKey, type MatchDecision, type MatchEvent, type MatchJournal, type MatchOperation, type MatchPersistencePort, type MatchPreferences, type MatchReference, type MatchState } from '../domain/orbitMatchTypes';

export type { MatchPersistencePort } from '../domain/orbitMatchTypes';
export type MatchControllerSnapshot = {
  state: MatchState;
  ready: boolean;
  working: boolean;
  pending: boolean;
  error: string;
};
type MatchControllerOptions = {
  uid: string;
  preferences: MatchPreferences;
  port: MatchPersistencePort | null;
  createId: () => string;
  now?: () => number;
  onChange: (snapshot: MatchControllerSnapshot) => void;
};

function decodeJournal(value: unknown, uid: string): MatchJournal | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved Match data is invalid. Retry secure storage.');
  const record = value as Record<string, unknown>;
  const confirmed = record.confirmed === null ? null : decodeMatchState(record.confirmed);
  if (record.uid !== uid || (record.confirmed !== null && !confirmed) || !Array.isArray(record.pending) || record.pending.length > 100) {
    throw new Error('Saved Match data is invalid. Retry secure storage.');
  }
  const pending = record.pending.map(decodeMatchOperation);
  if (pending.some((operation) => operation === null)) throw new Error('Saved Match changes are invalid.');
  return { uid, confirmed, pending: pending.filter((operation): operation is MatchOperation => operation !== null) };
}

/** A device journals operations, never writes a stale whole-account snapshot. */
export function createPlayerMatchController(options: MatchControllerOptions) {
  const now = options.now ?? Date.now;
  let confirmed = createMatchState(options.preferences);
  let hasConfirmed = options.port === null;
  let pending: MatchOperation[] = [];
  let ready = false;
  let working = false;
  let error = '';
  let listenerError = '';
  let preferenceConflict = '';
  let disposed = false;
  let draining = false;
  let subscription: { unsubscribe?: () => void } | undefined;
  let startup: Promise<void> | undefined;
  let journalTail: Promise<unknown> = Promise.resolve();
  const seenEvents = new Set<string>();

  const sequence = <T,>(operation: () => Promise<T>) => {
    const result = journalTail.then(operation);
    journalTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const projectPending = () => {
    let state = confirmed;
    let preferencesBlocked = false;
    for (const operation of pending) {
      if (operation.type === 'preferences' && preferencesBlocked) continue;
      try { state = applyMatchOperation(state, operation, now()); }
      catch {
        // Later preference revisions may belong to this failed local chain,
        // rather than the unrelated device revision with the same number.
        if (operation.type === 'preferences') preferencesBlocked = true;
      }
    }
    return { state, preferencesBlocked };
  };
  const currentState = () => projectPending().state;
  const visibleError = () => error || listenerError || preferenceConflict;
  const emit = () => {
    if (!disposed) options.onChange({ state: currentState(), ready, working, pending: pending.length > 0, error: visibleError() });
  };
  const persist = (nextConfirmed: MatchState, nextPending: MatchOperation[]) => options.port
    ? options.port.saveJournal(options.uid, { uid: options.uid, confirmed: hasConfirmed ? nextConfirmed : null, pending: nextPending })
    : Promise.resolve();
  const receive = async (state: MatchState) => sequence(async () => {
    if (disposed || state.revision < confirmed.revision) return;
    hasConfirmed = true;
    const remaining = pending.filter((operation) => !state.recentMutationIds.includes(operation.mutationId));
    // Keep an acknowledged operation if its local acknowledgement cannot be saved.
    await persist(state, remaining);
    if (disposed) return;
    confirmed = state;
    pending = remaining;
    if (!remaining.length) error = '';
    emit();
  });
  const message = (failure: unknown, fallback: string) => failure instanceof Error ? failure.message : fallback;
  const startListener = () => {
    if (!options.port || subscription || disposed) return;
    const next: { unsubscribe?: () => void } = {};
    subscription = next;
    const isCurrent = () => !disposed && subscription === next;
    try {
      next.unsubscribe = options.port.subscribe(options.uid, (state) => {
        if (!isCurrent()) return;
        void receive(state).catch((failure: unknown) => {
          if (!isCurrent()) return;
          error = message(failure, 'Match sync needs attention.');
          emit();
        });
      }, (failure) => {
        if (!isCurrent()) return;
        subscription = undefined;
        listenerError = failure.message;
        next.unsubscribe?.();
        emit();
      });
      // A port can report an error synchronously before returning its cleanup.
      if (!isCurrent()) next.unsubscribe();
      else { listenerError = ''; emit(); }
    } catch (failure: unknown) {
      if (subscription === next) subscription = undefined;
      throw failure;
    }
  };
  const drain = async () => {
    if (!options.port || !hasConfirmed || draining || disposed) return;
    draining = true;
    try {
      while (pending.length && !disposed) {
        const operation = pending[0];
        try {
          const state = await options.port.mutate(options.uid, operation);
          await sequence(async () => {
            if (disposed) return;
            const nextConfirmed = state.revision >= confirmed.revision ? state : confirmed;
            const remaining = pending.filter((candidate) => candidate.mutationId !== operation.mutationId && !nextConfirmed.recentMutationIds.includes(candidate.mutationId));
            await persist(nextConfirmed, remaining);
            if (disposed) return;
            confirmed = nextConfirmed;
            pending = remaining;
            error = '';
            emit();
          });
        } catch (failure: unknown) {
          if (disposed) return;
          // A listener may have durably acknowledged this request before its response failed.
          const stillPending = await sequence(async () => pending.some((candidate) => candidate.mutationId === operation.mutationId));
          if (disposed) return;
          if (!stillPending) continue;
          if (operation.type === 'event') {
            // Analytics are best effort and cannot block a player's next save.
            await sequence(async () => {
              const remaining = pending.filter((candidate) => candidate.mutationId !== operation.mutationId);
              await persist(confirmed, remaining);
              if (disposed) return;
              pending = remaining;
              emit();
            });
            continue;
          }
          const status = failure && typeof failure === 'object' ? Reflect.get(failure, 'status') : undefined;
          if (status === 400 || status === 409 || status === 413) {
            // The server rejected this edit. Reconcile rather than overwriting another device.
            const state = await options.port.fetchState(options.uid);
            await sequence(async () => {
              if (disposed) return;
              const nextConfirmed = state.revision >= confirmed.revision ? state : confirmed;
              const unresolved = pending.filter((candidate) => !nextConfirmed.recentMutationIds.includes(candidate.mutationId));
              const rejectedIndex = unresolved.findIndex((candidate) => candidate.mutationId === operation.mutationId);
              const rejectedPreferences = operation.type === 'preferences' && rejectedIndex >= 0;
              const remaining = unresolved.filter((candidate, index) => candidate.mutationId !== operation.mutationId
                && !(rejectedPreferences && index > rejectedIndex && candidate.type === 'preferences'));
              await persist(nextConfirmed, remaining);
              if (disposed) return;
              confirmed = nextConfirmed;
              pending = remaining;
              if (rejectedPreferences) {
                preferenceConflict = message(failure, 'Match preferences changed on another device. Review the current preferences before saving again.');
                error = '';
              } else {
                error = operation.type === 'preferences' && rejectedIndex < 0 ? ''
                  : message(failure, 'This change conflicted with another device. Review the current Match data.');
              }
              emit();
            });
          } else {
            error = message(failure, 'Match changes are saved on this device and waiting to sync.');
            emit();
            break;
          }
        }
      }
    } catch (failure: unknown) {
      error = message(failure, 'Match changes are waiting to sync.');
      emit();
    } finally { draining = false; }
  };
  const loadRemote = async () => {
    if (!options.port || disposed) return;
    const state = await options.port.fetchState(options.uid);
    await receive(state);
    if (disposed) return;
    startListener();
    await drain();
  };
  const restore = async () => {
    if (disposed) return;
    try {
      const journal = options.port ? decodeJournal(await options.port.loadJournal(options.uid), options.uid) : null;
      if (disposed) return;
      if (journal) {
        if (journal.confirmed) { confirmed = journal.confirmed; hasConfirmed = true; }
        pending = journal.pending;
      }
      ready = true;
      emit();
      await loadRemote();
    } catch (failure: unknown) {
      error = message(failure, 'Match data could not be restored.');
      emit();
    }
  };
  const start = () => {
    if (disposed) return Promise.resolve();
    if (startup) return startup;
    if (ready) return Promise.resolve();
    // Bind the shared attempt before storage or callbacks can reenter startup.
    const attempt = Promise.resolve().then(restore);
    startup = attempt;
    const release = () => { if (startup === attempt) startup = undefined; };
    void attempt.then(release, release);
    return attempt;
  };
  const enqueue = async (operation: MatchOperation, silent = false) => sequence(async () => {
    if (disposed || !ready) return false;
    if (pending.length >= 100) {
      if (!silent) { error = 'Reconnect to sync your saved changes before adding more.'; emit(); }
      return false;
    }
    const projection = projectPending();
    if (operation.type === 'preferences' && projection.preferencesBlocked) {
      preferenceConflict = 'Match preferences changed on another device. Review the current preferences before saving again.';
      error = '';
      emit();
      return false;
    }
    const projected = projection.state;
    if (operation.type === 'decide') {
      const previous = projected.decisions.find((decision) => matchReferenceKey(decision.ref) === matchReferenceKey(operation.ref));
      if (previous?.decision === operation.decision) return false;
    }
    try {
      applyMatchOperation(projected, operation, now());
      working = true;
      emit();
      const next = [...pending, operation];
      await persist(confirmed, next);
      if (disposed) return false;
      if (options.port) pending = next;
      else confirmed = applyMatchOperation(projected, operation, now());
      if (operation.type === 'preferences') preferenceConflict = '';
      if (!silent) error = '';
      return true;
    } catch (failure: unknown) {
      if (!silent) error = message(failure, 'This Match change could not be saved.');
      return false;
    } finally {
      working = false;
      emit();
    }
  }).then((accepted) => {
    if (accepted) void drain();
    return accepted;
  });
  return {
    start,
    dispose() {
      disposed = true;
      const previous = subscription;
      subscription = undefined;
      previous?.unsubscribe?.();
    },
    snapshot() { return { state: currentState(), ready, working, pending: pending.length > 0, error: visibleError() }; },
    async retry() {
      if (!ready) return start();
      try { error = ''; emit(); await loadRemote(); }
      catch (failure: unknown) { error = message(failure, 'Match could not reconnect.'); emit(); }
    },
    decide(ref: MatchReference, summary: MatchDecision['summary'], decision: MatchDecision['decision']) {
      return enqueue({ mutationId: options.createId(), type: 'decide', ref, summary, decision });
    },
    remove(record: MatchDecision) {
      return enqueue({ mutationId: options.createId(), type: 'remove', ref: record.ref, expectedDecisionMutationId: record.mutationId });
    },
    undo() {
      const previous = currentState().undo;
      return previous ? enqueue({ mutationId: options.createId(), type: 'undo', targetMutationId: previous.mutationId }) : Promise.resolve(false);
    },
    preferences(preferences: MatchPreferences, basePreferencesRevision = currentState().preferencesRevision) {
      return enqueue({ mutationId: options.createId(), type: 'preferences', basePreferencesRevision, preferences });
    },
    recordEvent(event: Omit<MatchEvent, 'at' | 'eventId'>) {
      const key = JSON.stringify([event.kind, event.ref && matchReferenceKey(event.ref), event.saveMutationId]);
      if (seenEvents.has(key)) return Promise.resolve(false);
      seenEvents.add(key);
      if (seenEvents.size > 500) seenEvents.delete(seenEvents.values().next().value ?? '');
      return enqueue({ mutationId: options.createId(), type: 'event', event }, true);
    }
  };
}
