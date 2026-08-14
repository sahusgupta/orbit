'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { getFirebaseBrowserClient, isFirebaseBrowserSyncEnabled } from '@/src/data/firebase-client';

export function LiveRouteRefresh() {
  const router = useRouter();
  const { user } = useAuth();
  const ready = useRef(false);
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
