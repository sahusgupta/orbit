'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/src/auth/auth-context';
import { PlayerDataProvider } from '@/src/data/player-data-context';
import { LocationProvider } from '@/src/location/location-context';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PlayerDataProvider>
        <LocationProvider>{children}</LocationProvider>
      </PlayerDataProvider>
    </AuthProvider>
  );
}
