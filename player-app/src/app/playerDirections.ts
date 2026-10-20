import { isValidCoordinate } from '../domain/discovery';
import type { PlayerCoordinate } from '../domain/playerSync';

export type PlayerDirectionsResult = { ok: true } | { ok: false; error: string };

export function buildPlayerDirectionsUrl(os: string, address: string, coordinate?: PlayerCoordinate | null, iosVersion?: string | number) {
  const destination = isValidCoordinate(coordinate) ? `${coordinate.latitude},${coordinate.longitude}` : address.trim();
  if (!destination) return null;
  const encoded = encodeURIComponent(destination);
  if (os === 'ios') {
    const version = Number.parseFloat(String(iosVersion ?? ''));
    return version >= 18.4
      ? `https://maps.apple.com/directions?destination=${encoded}&mode=driving`
      : `https://maps.apple.com/?daddr=${encoded}&dirflg=d`;
  }
  return os === 'android' ? `google.navigation:q=${encoded}` : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}
