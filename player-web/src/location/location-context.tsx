'use client';

import { createContext, useContext, type ReactNode } from 'react';

type LocationContextValue = {
  coordinate: null;
  label: string;
};

const noPlayerOrigin: LocationContextValue = {
  coordinate: null,
  label: 'Distance unavailable in this release'
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  return <LocationContext.Provider value={noPlayerOrigin}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useLocation must be used inside LocationProvider.');
  return value;
}
