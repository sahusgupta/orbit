import { activeInterestStatuses, inactiveInterestStatuses } from '../../domain/participants';
import type { AppState, Interest, InterestStatus, PlayerProfile } from '../../domain/types';
import { findUniqueProfileReference } from '../../lib/profileRelationships';

export type WaitlistCommandDependencies = {
  createId: () => string;
  nowIso: () => string;
};

export type WaitlistInterestInput = {
  playerName: string;
  gameId: string;
  status: InterestStatus;
  notes: string;
};

export type WaitlistDemandPrompt = {
  gameId: string;
  activeCount: number;
  message: string;
  defaultChoice: 'start';
};

const markManualEdit = (
  edits: Record<string, string> | undefined,
  key: string,
  nowIso: () => string
) => ({ ...(edits ?? {}), [key]: nowIso() });

export function getWaitlistDemandPrompt(state: AppState, gameId: string): WaitlistDemandPrompt | null {
  const game = state.games.find((item) => item.id === gameId);
  if (!game) return null;
  const activeCount = state.interests.filter(
    (interest) => interest.gameId === gameId && activeInterestStatuses.includes(interest.status)
  ).length;
  if (activeCount <= 5) return null;
  const hasOpenTargetTable = state.sessions.some(
    (session) => session.gameId === gameId && session.status !== 'Closed' && session.status !== 'Failed to Start'
  );
  if (hasOpenTargetTable) return null;
  return {
    gameId,
    activeCount,
    message: `${activeCount} players now want ${game.name}. Type "start" to create a new ${game.name} table, "switch" to convert a running table to ${game.name}, or leave blank to skip.`,
    defaultChoice: 'start'
  };
}

export function upsertWaitlistInterest(
  state: AppState,
  input: WaitlistInterestInput,
  dependencies: WaitlistCommandDependencies
) {
  const playerName = input.playerName.trim();
  const existingProfile = state.profiles.find(
    (profile) => profile.name.trim().toLowerCase() === playerName.toLowerCase()
  );
  const existingActiveInterest = state.interests.find(
    (interest) =>
      !inactiveInterestStatuses.includes(interest.status) &&
      (
        (existingProfile && interest.profileId === existingProfile.id) ||
        interest.playerName.trim().toLowerCase() === playerName.toLowerCase()
      )
  );
  const timestamp = dependencies.nowIso();
  const statusTimestamps =
    input.status === 'Confirmed Coming'
      ? { confirmedAt: timestamp, closedAt: undefined }
      : input.status === 'Arrived'
        ? { arrivedAt: timestamp, closedAt: undefined }
        : inactiveInterestStatuses.includes(input.status)
          ? { closedAt: timestamp }
          : { closedAt: undefined };
  const nextInterest: Interest = existingActiveInterest
    ? {
        ...existingActiveInterest,
        profileId: existingProfile?.id ?? existingActiveInterest.profileId,
        playerName,
        gameId: input.gameId,
        status: input.status,
        notes: input.notes.trim(),
        timestamp,
        ...statusTimestamps
      }
    : {
        id: dependencies.createId(),
        profileId: existingProfile?.id,
        playerName,
        gameId: input.gameId,
        status: input.status,
        notes: input.notes.trim(),
        timestamp,
        interestedAt: timestamp,
        confirmedAt: input.status === 'Confirmed Coming' ? timestamp : undefined,
        arrivedAt: input.status === 'Arrived' ? timestamp : undefined,
        seatedAt: undefined,
        closedAt: inactiveInterestStatuses.includes(input.status) ? timestamp : undefined
      };
  const nextState = {
    ...state,
    interests: existingActiveInterest
      ? state.interests.map((interest) => interest.id === existingActiveInterest.id ? nextInterest : interest)
      : [nextInterest, ...state.interests]
  };
  return {
    state: nextState,
    interest: nextInterest,
    updatedExisting: Boolean(existingActiveInterest),
    demandPrompt: getWaitlistDemandPrompt(nextState, input.gameId)
  };
}

export function patchWaitlistInterest(
  state: AppState,
  id: string,
  patch: Partial<Interest>,
  dependencies: Pick<WaitlistCommandDependencies, 'nowIso'>
) {
  const timestampPatch =
    patch.status === 'Confirmed Coming'
      ? { confirmedAt: dependencies.nowIso() }
      : patch.status === 'Arrived'
        ? { arrivedAt: dependencies.nowIso() }
        : patch.status === 'Seated'
          ? { seatedAt: dependencies.nowIso() }
          : patch.status && inactiveInterestStatuses.includes(patch.status)
            ? { closedAt: dependencies.nowIso() }
            : {};
  const nextState = {
    ...state,
    interests: state.interests.map((interest) =>
      interest.id === id
        ? {
            ...interest,
            ...patch,
            ...timestampPatch,
            timestamp: patch.status ? dependencies.nowIso() : interest.timestamp,
            manualEdits: Object.keys(patch).reduce(
              (edits, key) => markManualEdit(edits, key, dependencies.nowIso),
              interest.manualEdits
            )
          }
        : interest
    )
  };
  const changedInterest = nextState.interests.find((interest) => interest.id === id);
  return {
    state: nextState,
    changedInterest,
    demandPrompt: changedInterest && activeInterestStatuses.includes(changedInterest.status)
      ? getWaitlistDemandPrompt(nextState, changedInterest.gameId)
      : null
  };
}

export type InterestTimestampKey = 'interestedAt' | 'confirmedAt' | 'arrivedAt' | 'seatedAt' | 'closedAt';

export function correctWaitlistInterestTimestamp(
  state: AppState,
  id: string,
  key: InterestTimestampKey,
  nextValue: string | undefined,
  dependencies: WaitlistCommandDependencies
): AppState {
  const interest = state.interests.find((item) => item.id === id);
  const nextState = {
    ...state,
    interests: state.interests.map((item) =>
      item.id === id
        ? { ...item, [key]: nextValue, manualEdits: markManualEdit(item.manualEdits, key, dependencies.nowIso) }
        : item
    ),
    playerSessions: state.playerSessions.map((session) => {
      if (!interest || session.playerName !== interest.playerName || session.gameId !== interest.gameId) return session;
      if (key === 'seatedAt' && nextValue) {
        return {
          ...session,
          seatedAt: nextValue,
          manualEdits: markManualEdit(session.manualEdits, 'seatedAt', dependencies.nowIso)
        };
      }
      if (key === 'closedAt') {
        return {
          ...session,
          leftAt: nextValue,
          manualEdits: markManualEdit(session.manualEdits, 'leftAt', dependencies.nowIso)
        };
      }
      return session;
    })
  };
  return {
    ...nextState,
    correctionLog: [
      {
        id: dependencies.createId(),
        entity: interest?.playerName ?? id,
        field: key,
        note: 'Timestamp corrected',
        timestamp: dependencies.nowIso()
      },
      ...nextState.correctionLog
    ].slice(0, 50)
  };
}

export function removeWaitlistInterest(state: AppState, id: string): AppState {
  return {
    ...state,
    interests: state.interests.filter((interest) => interest.id !== id)
  };
}

export function ensureWaitlistInterest(
  state: AppState,
  profile: PlayerProfile,
  gameId: string,
  status: InterestStatus,
  note: string,
  timestamp: string,
  createId: () => string
) {
  const existingRelationship = findUniqueProfileReference(
    state.interests,
    state.profiles,
    profile,
    (interest) => !inactiveInterestStatuses.includes(interest.status)
  );
  const existing = existingRelationship?.gameId === gameId ? existingRelationship : undefined;
  if (existing) {
    return state.interests.map((interest) =>
      interest.id === existing.id
        ? {
            ...interest,
            status: interest.status === 'Seated' ? interest.status : status,
            profileId: profile.id,
            timestamp,
            interestedAt: interest.interestedAt ?? timestamp,
            arrivedAt: status === 'Arrived' ? interest.arrivedAt ?? timestamp : interest.arrivedAt,
            notes: interest.notes || note
          }
        : interest
    );
  }
  return [
    {
      id: createId(),
      profileId: profile.id,
      playerName: profile.name,
      gameId,
      status,
      timestamp,
      interestedAt: timestamp,
      arrivedAt: status === 'Arrived' ? timestamp : undefined,
      notes: note
    },
    ...state.interests
  ];
}
