export type AuthoritativeTransitionSaveResult = {
  ok: boolean;
  conflict?: boolean;
  error?: string;
};

export type AuthoritativeTransitionOptions<TState> = {
  initialState: TState;
  transition: (state: TState) => TState;
  save: (state: TState) => Promise<AuthoritativeTransitionSaveResult>;
  loadAuthoritative: () => Promise<TState>;
};

export type AuthoritativeTransitionResult<TState> =
  | {
      ok: true;
      state: TState;
      retried: boolean;
      adoptedAuthoritative: boolean;
    }
  | {
      ok: false;
      state: TState;
      retried: boolean;
      adoptedAuthoritative: false;
      conflict?: boolean;
      error?: string;
    };

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Unable to save the management state.';

export async function commitAuthoritativeTransition<TState>({
  initialState,
  transition,
  save,
  loadAuthoritative
}: AuthoritativeTransitionOptions<TState>): Promise<AuthoritativeTransitionResult<TState>> {
  const attemptedState = transition(initialState);
  let firstSave: AuthoritativeTransitionSaveResult;
  try {
    firstSave = await save(attemptedState);
  } catch (error) {
    return {
      ok: false,
      state: initialState,
      retried: false,
      adoptedAuthoritative: false,
      error: errorMessage(error)
    };
  }

  if (firstSave.ok) {
    return {
      ok: true,
      state: attemptedState,
      retried: false,
      adoptedAuthoritative: false
    };
  }
  if (!firstSave.conflict) {
    return {
      ok: false,
      state: initialState,
      retried: false,
      adoptedAuthoritative: false,
      error: firstSave.error
    };
  }

  let authoritativeState: TState;
  try {
    authoritativeState = await loadAuthoritative();
  } catch (error) {
    return {
      ok: false,
      state: initialState,
      retried: true,
      adoptedAuthoritative: false,
      conflict: true,
      error: errorMessage(error)
    };
  }

  const retriedState = transition(authoritativeState);
  if (Object.is(retriedState, authoritativeState)) {
    return {
      ok: true,
      state: authoritativeState,
      retried: true,
      adoptedAuthoritative: true
    };
  }

  let retrySave: AuthoritativeTransitionSaveResult;
  try {
    retrySave = await save(retriedState);
  } catch (error) {
    return {
      ok: false,
      state: authoritativeState,
      retried: true,
      adoptedAuthoritative: false,
      error: errorMessage(error)
    };
  }

  if (retrySave.ok) {
    return {
      ok: true,
      state: retriedState,
      retried: true,
      adoptedAuthoritative: false
    };
  }
  if (retrySave.conflict) {
    try {
      authoritativeState = await loadAuthoritative();
    } catch {
      // Keep the first authoritative snapshot as the safest available rollback.
      // The original conflict remains the actionable save error.
    }
  }
  return {
    ok: false,
    state: authoritativeState,
    retried: true,
    adoptedAuthoritative: false,
    conflict: retrySave.conflict,
    error: retrySave.error
  };
}
