import type { VenueCoordinate } from './types';

/** Public, operator-authored venue metadata; never inferred from an address. */
export function decodeVenueCoordinate(value: unknown): VenueCoordinate | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const latitude: unknown = Reflect.get(value, 'latitude');
  const longitude: unknown = Reflect.get(value, 'longitude');
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return undefined;
  }
  return { latitude, longitude };
}
