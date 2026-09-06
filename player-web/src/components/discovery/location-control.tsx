'use client';

import { MapPin } from 'lucide-react';
import { useLocation } from '@/src/location/location-context';

export function LocationControl() {
  const { label } = useLocation();
  return (
    <div className="location-control">
      <div className="location-control__status"><MapPin aria-hidden="true" size={17} /><span>{label}</span></div>
      <p>Search by venue or area. Orbit Player does not request a device location or calculate mileage in this release.</p>
    </div>
  );
}
