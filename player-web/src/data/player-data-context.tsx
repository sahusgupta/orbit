'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { useAuth } from '@/src/auth/auth-context';
import { isPlayerSessionChangedError, PlayerSessionChangedError } from '@/src/auth/session-identity';
import type {
  DiscoveryPayload,
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentInterest,
  SeatRequestInput
} from '@/src/domain/types';
import { scheduleAtBoundary } from '@/src/domain/boundary-timer';
import { isSameTournamentInterest, isTournamentInterestFor } from '@orbit/player-domain/playerSync';
import { getNextTournamentInterestBoundary } from '@/src/domain/selectors';
import { getFirebaseBrowserClient } from './firebase-client';
import {
  fetchAuthenticatedDiscovery,
  expressTournamentInterest,
  submitMembershipApplication,
  submitSeatRequest,
  withdrawTournamentInterest
} from './player-api';

type PlayerDataStatus = 'idle' | 'loading' | 'ready' | 'error';

type PlayerDataContextValue = DiscoveryPayload & {
  status: PlayerDataStatus;
  error: string;
  refresh(): Promise<void>;
  requestMembership(club: PlayerClubSnapshot, option: PlayerMembershipOption): Promise<void>;
  requestSeat(club: PlayerClubSnapshot, game: PlayerSyncGame, input: SeatRequestInput): Promise<void>;
  cancelSeat(club: PlayerClubSnapshot, game: PlayerSyncGame): Promise<void>;
  expressInterest(tournament: PlayerTournament): Promise<PlayerTournamentInterest>;
  withdrawInterest(tournament: PlayerTournament): Promise<void>;
};

const emptyDiscovery: DiscoveryPayload = {
  clubs: [],
  tournaments: [],
  interests: [],
  page: { count: 0, hasMore: false, nextCursor: null }
};

const PlayerDataContext = createContext<PlayerDataContextValue | null>(null);

export function PlayerDataProvider({ children }: { children: ReactNode }) {
  const { user, player } = useAuth();
  return (
    <PlayerDataSession key={user?.uid ?? 'signed-out'} sessionUser={user} sessionPlayer={player}>
      {children}
    </PlayerDataSession>
  );
}

function isRetiredRequest(error: unknown) {
  return isPlayerSessionChangedError(error) || (
    error instanceof Error && error.name === 'AbortError'
  );
}

function PlayerDataSession({
  children,
  sessionUser: user,
  sessionPlayer: player
}: {
  children: ReactNode;
  sessionUser: User | null;
  sessionPlayer: PlayerAccount | null;
}) {
  const [data, setData] = useState<DiscoveryPayload>(emptyDiscovery);
  const [status, setStatus] = useState<PlayerDataStatus>('idle');
  const [error, setError] = useState('');
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const mutationAcknowledgement = useRef(0);
  const disposed = useRef(false);
  const requestControllers = useRef(new Set<AbortController>());

  useEffect(() => {
    disposed.current = false;
    const controllers = requestControllers.current;
    return () => {
      disposed.current = true;
      refreshPending.current = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);

  const assertActiveSession = useCallback(() => {
    if (disposed.current) throw new PlayerSessionChangedError();
  }, []);

  const runSessionOperation = useCallback(async <Result,>(operation: (signal: AbortSignal) => Promise<Result>) => {
    assertActiveSession();
    const controller = new AbortController();
    requestControllers.current.add(controller);
    try {
      const result = await operation(controller.signal);
      assertActiveSession();
      return result;
    } finally {
      requestControllers.current.delete(controller);
    }
  }, [assertActiveSession]);

  const refresh = useCallback((): Promise<void> => {
    if (!user || !player) {
      try {
        assertActiveSession();
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
      refreshPending.current = false;
      setData(emptyDiscovery);
      setStatus('idle');
      setError('');
      return Promise.resolve();
    }
    // Signed-in refreshes retired during cleanup have always settled quietly.
    if (disposed.current) return refreshInFlight.current ?? Promise.resolve();
    refreshPending.current = true;
    // Reuse the owned completion directly, including for a busy stream. An
    // async wrapper would retain one adoption promise per notification.
    if (refreshInFlight.current) return refreshInFlight.current;
    setStatus((current) => current === 'ready' ? current : 'loading');
    const task = Promise.resolve().then(async () => {
      try {
        while (refreshPending.current && !disposed.current) {
          refreshPending.current = false;
          const acknowledgementAtStart = mutationAcknowledgement.current;
          try {
            const discovery = await runSessionOperation((signal) => fetchAuthenticatedDiscovery(user, signal));
            assertActiveSession();
            if (acknowledgementAtStart !== mutationAcknowledgement.current) {
              refreshPending.current = true;
              continue;
            }
            // A later invalidation needs another read, but does not make this
            // response unsafe: render progress while draining a busy stream.
            setData(discovery);
            setError('');
            setStatus('ready');
          } catch (refreshError) {
            if (isRetiredRequest(refreshError) || disposed.current) {
              refreshPending.current = false;
              return;
            }
            setError(refreshError instanceof Error ? refreshError.message : 'My Orbit could not refresh.');
            setStatus('error');
          }
        }
      } finally {
        // Release ownership in the same continuation as the pending check.
        // An outer Promise.finally would leave a notification handoff gap.
        if (refreshInFlight.current === task) refreshInFlight.current = null;
      }
    });
    refreshInFlight.current = task;
    return task;
  }, [assertActiveSession, player, runSessionOperation, user]);

  const nextTournamentBoundary = getNextTournamentInterestBoundary(data.tournaments);

  useEffect(() => {
    if (!user || nextTournamentBoundary == null) return;
    return scheduleAtBoundary(nextTournamentBoundary, () => void refresh());
  }, [nextTournamentBoundary, refresh, user]);

  useEffect(() => {
    if (!user) return;
    let subscriptionDisposed = false;
    let unsubscribe: (() => void) | undefined;
    // Firestore listeners are only an invalidation signal. The initial private
    // discovery load must not depend on a snapshot arriving (or even on the
    // listener being established successfully).
    queueMicrotask(() => {
      if (!subscriptionDisposed) void refresh();
    });
    void Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]).then(([firestoreModule, client]) => {
      if (subscriptionDisposed) return;
      unsubscribe = firestoreModule.onSnapshot(firestoreModule.collection(client.db, 'clubs'), () => {
        if (!subscriptionDisposed) void refresh();
      }, (subscriptionError) => {
        if (!subscriptionDisposed && !disposed.current) setError(subscriptionError.message || 'Live Orbit updates are temporarily unavailable.');
      });
    }).catch((subscriptionError) => {
      if (!subscriptionDisposed && !disposed.current) setError(subscriptionError instanceof Error ? subscriptionError.message : 'Live Orbit updates are temporarily unavailable.');
    });
    return () => {
      subscriptionDisposed = true;
      unsubscribe?.();
    };
  }, [refresh, user]);

  const acknowledgeMutation = useCallback(() => {
    assertActiveSession();
    mutationAcknowledgement.current += 1;
    if (refreshInFlight.current) refreshPending.current = true;
  }, [assertActiveSession]);

  const replaceClub = useCallback((snapshot: PlayerClubSnapshot) => {
    acknowledgeMutation();
    setData((current) => ({
      ...current,
      clubs: current.clubs.some((club) => club.club.id === snapshot.club.id)
        ? current.clubs.map((club) => club.club.id === snapshot.club.id ? snapshot : club)
        : [snapshot, ...current.clubs]
    }));
  }, [acknowledgeMutation]);

  const requestMembership = useCallback(async (club: PlayerClubSnapshot, option: PlayerMembershipOption) => {
    if (!user || !player) throw new Error('Sign in before requesting membership.');
    replaceClub(await runSessionOperation((signal) => submitMembershipApplication(user, player, club, option, signal)));
  }, [player, replaceClub, runSessionOperation, user]);

  const requestSeat = useCallback(async (club: PlayerClubSnapshot, game: PlayerSyncGame, input: SeatRequestInput) => {
    if (!user || !player) throw new Error('Sign in before requesting a game.');
    replaceClub(await runSessionOperation((signal) => submitSeatRequest(user, player, club, game, input, 'join', signal)));
  }, [player, replaceClub, runSessionOperation, user]);

  const cancelSeat = useCallback(async (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
    if (!user || !player) throw new Error('Sign in before changing a game request.');
    replaceClub(await runSessionOperation((signal) => submitSeatRequest(user, player, club, game, { attendance: 'interested' }, 'cancel', signal)));
  }, [player, replaceClub, runSessionOperation, user]);

  const expressInterest = useCallback(async (tournament: PlayerTournament) => {
    if (!user) throw new Error('Sign in before expressing tournament interest.');
    const interest = await runSessionOperation((signal) => expressTournamentInterest(user, tournament, signal));
    acknowledgeMutation();
    setData((current) => ({
      ...current,
      interests: [interest, ...current.interests.filter((item) => !isSameTournamentInterest(item, interest))]
    }));
    return interest;
  }, [acknowledgeMutation, runSessionOperation, user]);

  const withdrawInterest = useCallback(async (tournament: PlayerTournament) => {
    if (!user) throw new Error('Sign in before changing tournament interest.');
    await runSessionOperation((signal) => withdrawTournamentInterest(user, tournament, signal));
    acknowledgeMutation();
    setData((current) => ({
      ...current,
      interests: current.interests.filter((item) => item.playerId !== user.uid || !isTournamentInterestFor(item, tournament))
    }));
  }, [acknowledgeMutation, runSessionOperation, user]);

  const value = useMemo<PlayerDataContextValue>(() => ({
    ...data,
    status,
    error,
    refresh,
    requestMembership,
    requestSeat,
    cancelSeat,
    expressInterest,
    withdrawInterest
  }), [cancelSeat, data, error, expressInterest, refresh, requestMembership, requestSeat, status, withdrawInterest]);

  return <PlayerDataContext.Provider value={value}>{children}</PlayerDataContext.Provider>;
}

export function usePlayerData() {
  const value = useContext(PlayerDataContext);
  if (!value) throw new Error('usePlayerData must be used inside PlayerDataProvider.');
  return value;
}
