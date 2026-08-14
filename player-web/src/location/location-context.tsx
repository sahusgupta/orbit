'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { resolveAddressCoordinate } from '@orbit/player-domain/discovery';
import type { Coordinate } from '@/src/domain/types';
import { defaultCoordinate } from '@/src/domain/selectors';

export type LocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'manual';

type LocationContextValue = {
  status: LocationStatus;
  coordinate: Coordinate;
  label: string;
  requestLocation(): void;
  setManualLocation(value: string): void;
};

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [coordinate, setCoordinate] = useState<Coordinate>(defaultCoordinate);
  const [label, setLabel] = useState('Location optional');

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus('unavailable');
      setLabel('Browser location unavailable');
      return;
    }
    setStatus('requesting');
    navigator.geolocation.getCurrentPosition((position) => {
      setCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setStatus('granted');
      setLabel('Using your location');
    }, (locationError) => {
      const denied = locationError.code === locationError.PERMISSION_DENIED;
      setStatus(denied ? 'denied' : 'unavailable');
      setLabel(denied ? 'Location denied — browse by city instead' : 'Location unavailable — browse by city instead');
    }, { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 });
  }, []);

  const setManualLocation = useCallback((value: string) => {
    const normalized = value.trim();
    setCoordinate(resolveAddressCoordinate(normalized));
    setStatus('manual');
    setLabel(normalized || 'Manual location');
  }, []);

  const value = useMemo(() => ({ status, coordinate, label, requestLocation, setManualLocation }), [coordinate, label, requestLocation, setManualLocation, status]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  const value = useContext(LocationContext);
  if (!value) throw new Error('useLocation must be used inside LocationProvider.');
  return value;
}
