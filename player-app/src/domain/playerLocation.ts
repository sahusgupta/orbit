import { isValidCoordinate } from './discovery';
import type { PlayerCoordinate } from './playerSync';

export const deviceOriginLifetimeMs = 15 * 60_000;
export type PlayerLocalOrigin = { coordinate: PlayerCoordinate; label: string; source: 'device' | 'manual'; capturedAt: number; expiresAt: number | null };

export function decodePlayerLocalOrigin(value: unknown): PlayerLocalOrigin | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const coordinate: unknown = Reflect.get(value, 'coordinate');
  const label: unknown = Reflect.get(value, 'label');
  const source: unknown = Reflect.get(value, 'source');
  const capturedAt: unknown = Reflect.get(value, 'capturedAt');
  const expiresAt: unknown = Reflect.get(value, 'expiresAt');
  if (!coordinate || typeof coordinate !== 'object' || Array.isArray(coordinate)) return null;
  const latitude: unknown = Reflect.get(coordinate, 'latitude');
  const longitude: unknown = Reflect.get(coordinate, 'longitude');
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !isValidCoordinate({ latitude, longitude })
    || typeof label !== 'string' || !label.trim() || label.length > 120
    || /[\u0000-\u001f\u007f]/.test(label) || typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt < 0
    || (source !== 'device' && source !== 'manual') || (source === 'manual' ? expiresAt !== null : expiresAt !== capturedAt + deviceOriginLifetimeMs)) return null;
  return { coordinate: { latitude, longitude }, label, source, capturedAt, expiresAt: source === 'manual' ? null : capturedAt + deviceOriginLifetimeMs };
}
