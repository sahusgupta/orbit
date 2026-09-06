'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { getFirebaseBrowserClient, isFirebaseBrowserSyncEnabled } from '@/src/data/firebase-client';
import { scheduleAtBoundary } from '@/src/domain/boundary-timer';
import { getNextTournamentInterestBoundary } from '@/src/domain/selectors';
import type { PlayerTournament } from '@/src/domain/types';

export function LiveRouteRefresh({ tournaments = [] }: { tournaments?: PlayerTournament[] }) {
  const router = useRouter();
  const { user } = useAuth();
  const ready = useRef(false);
  const nextTournamentBoundary = getNextTournamentInterestBoundary(tournaments);

  useEffect(() => {
    if (nextTournamentBoundary == null) return;
    return scheduleAtBoundary(nextTournamentBoundary, () => router.refresh());
  }, [nextTournamentBoundary, router]);

  useEffect(() => {
    if (user || !isFirebaseBrowserSyncEnabled()) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    void Promise.all([import('firebase/firestore'), getFirebaseBrowserClient()]).then(([firestoreModule, client]) => {
      if (disposed) return;
      unsubscribe = firestoreModule.onSnapshot(firestoreModule.collection(client.db, 'clubs'), () => {
        if (!ready.current) {
          ready.current = true;
          return;
        }
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => router.refresh(), 400);
      }, () => undefined);
    }).catch(() => {
      ready.current = false;
    });
    return () => {
      disposed = true;
      clearTimeout(refreshTimer);
      unsubscribe?.();
    };
  }, [router, user]);
  return <span className="live-refresh" aria-hidden="true" />;
}
