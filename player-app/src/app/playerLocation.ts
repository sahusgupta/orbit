import * as Location from 'expo-location';
import { isValidCoordinate } from '../domain/discovery';
import type { PlayerCoordinate } from '../domain/playerSync';

export type PlayerLocationPort = { getOneShotPosition(): Promise<{ coordinate: PlayerCoordinate; capturedAt: number }> };
export const playerLocationTimeoutMs = 15_000;

export const playerLocation: PlayerLocationPort = {
  async getOneShotPosition() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retired = false;
    try {
      return await Promise.race([
        (async () => {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (retired) throw new Error('Location request expired. Try again.');
          if (!permission.granted) throw new Error('Location permission was not granted. Choose a point manually instead.');
          const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const coordinate = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
          if (!isValidCoordinate(coordinate) || !Number.isFinite(fix.timestamp) || fix.timestamp < Date.now() - 120_000 || fix.timestamp > Date.now() + 60_000) {
            throw new Error('A current location could not be confirmed. Choose a point manually or try again.');
          }
          return { coordinate, capturedAt: fix.timestamp };
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Location took too long. Choose a point manually or try again.')), playerLocationTimeoutMs);
        })
      ]);
    } finally { retired = true; if (timer) clearTimeout(timer); }
  }
};
