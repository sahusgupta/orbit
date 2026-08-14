'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import type {
  DiscoveryPayload,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration,
  SeatRequestInput
} from '@/src/domain/types';
import { getFirebaseBrowserClient } from './firebase-client';
import {
  fetchAuthenticatedDiscovery,
  registerTournament,
  submitMembershipApplication,
  submitSeatRequest,
  unregisterTournament
} from './player-api';

type PlayerDataStatus = 'idle' | 'loading' | 'ready' | 'error';

type PlayerDataContextValue = DiscoveryPayload & {
  status: PlayerDataStatus;
  error: string;
  refresh(): Promise<void>;
  requestMembership(club: PlayerClubSnapshot, option?: PlayerMembershipOption): Promise<void>;
  requestSeat(club: PlayerClubSnapshot, game: PlayerSyncGame, input: SeatRequestInput): Promise<void>;
  cancelSeat(club: PlayerClubSnapshot, game: PlayerSyncGame): Promise<void>;
  register(tournament: PlayerTournament): Promise<PlayerTournamentRegistration>;
  unregister(tournament: PlayerTournament): Promise<void>;
};

const emptyDiscovery: DiscoveryPayload = {
  clubs: [],
  tournaments: [],
  registrations: [],
  page: { count: 0, hasMore: false, nextCursor: null }
};

const PlayerDataContext = createContext<PlayerDataContextValue | null>(null);

export function PlayerDataProvider({ children }: { children: ReactNode }) {
  const { user, player } = useAuth();
  const [data, setData] = useState<DiscoveryPayload>(emptyDiscovery);
  const [status, setStatus] = useState<PlayerDataStatus>('idle');
  const [error, setError] = useState('');
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !player) {
      setData(emptyDiscovery);
      setStatus('idle');
      setError('');
      return;
    }
    if (refreshInFlight.current) return refreshInFlight.current;
    setStatus((current) => current === 'ready' ? current : 'loading');
    const task = fetchAuthenticatedDiscovery(user)
      .then((discovery) => {
        setData(discovery);
        setError('');
        setStatus('ready');
      })
      .catch((refreshError) => {
        setError(refreshError instanceof Error ? refreshError.message : 'My Orbit could not refresh.');
        setStatus('error');
      })
      .finally(() => {
        refreshInFlight.current = null;
      });
    refreshInFlight.current = task;
    return task;
  }, [player, user]);

  useEffect(() => {
    if (!user) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]).then(([firestoreModule, client]) => {
      if (disposed) return;
      unsubscribe = firestoreModule.onSnapshot(firestoreModule.collection(client.db, 'clubs'), () => void refresh(), (subscriptionError) => {
        setError(subscriptionError.message || 'Live Orbit updates are temporarily unavailable.');
      });
    }).catch((subscriptionError) => {
      if (!disposed) setError(subscriptionError instanceof Error ? subscriptionError.message : 'Live Orbit updates are temporarily unavailable.');
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [refresh, user]);

  const replaceClub = useCallback((snapshot: PlayerClubSnapshot) => {
    setData((current) => ({
      ...current,
      clubs: current.clubs.some((club) => club.club.id === snapshot.club.id)
        ? current.clubs.map((club) => club.club.id === snapshot.club.id ? snapshot : club)
        : [snapshot, ...current.clubs]
    }));
  }, []);

  const requestMembership = useCallback(async (club: PlayerClubSnapshot, option?: PlayerMembershipOption) => {
    if (!user || !player) throw new Error('Sign in before requesting membership.');
    replaceClub(await submitMembershipApplication(user, player, club, option));
  }, [player, replaceClub, user]);

  const requestSeat = useCallback(async (club: PlayerClubSnapshot, game: PlayerSyncGame, input: SeatRequestInput) => {
    if (!user || !player) throw new Error('Sign in before requesting a game.');
    replaceClub(await submitSeatRequest(user, player, club, game, input));
  }, [player, replaceClub, user]);

  const cancelSeat = useCallback(async (club: PlayerClubSnapshot, game: PlayerSyncGame) => {
    if (!user || !player) throw new Error('Sign in before changing a game request.');
    replaceClub(await submitSeatRequest(user, player, club, game, { attendance: 'interested' }, 'cancel'));
  }, [player, replaceClub, user]);

  const register = useCallback(async (tournament: PlayerTournament) => {
    if (!user) throw new Error('Sign in before registering for a tournament.');
    const registration = await registerTournament(user, tournament);
    setData((current) => ({
      ...current,
      registrations: [registration, ...current.registrations.filter((item) => item.id !== registration.id)]
    }));
    return registration;
  }, [user]);

  const unregister = useCallback(async (tournament: PlayerTournament) => {
    if (!user) throw new Error('Sign in before changing a tournament registration.');
    await unregisterTournament(user, tournament);
    setData((current) => ({
      ...current,
      registrations: current.registrations.filter((item) => item.tournamentId !== tournament.id || item.playerId !== user.uid)
    }));
  }, [user]);

  const value = useMemo<PlayerDataContextValue>(() => ({
    ...data,
    status,
    error,
    refresh,
    requestMembership,
    requestSeat,
    cancelSeat,
    register,
    unregister
  }), [cancelSeat, data, error, refresh, register, requestMembership, requestSeat, status, unregister]);

  return <PlayerDataContext.Provider value={value}>{children}</PlayerDataContext.Provider>;
}

export function usePlayerData() {
  const value = useContext(PlayerDataContext);
  if (!value) throw new Error('usePlayerData must be used inside PlayerDataProvider.');
  return value;
}
