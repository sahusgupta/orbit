import { describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({
  adapter: { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() },
  firebasePersistence: { type: 'LOCAL' },
  getReactNativePersistence: vi.fn()
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: persistence.adapter }));
vi.mock('firebase/auth', () => ({
  getReactNativePersistence: persistence.getReactNativePersistence.mockReturnValue(persistence.firebasePersistence)
}));

import { playerAuthPersistence } from './playerAuthPersistence.native';

describe('native Firebase Auth persistence', () => {
  it('uses React Native AsyncStorage so a verified session can restore after cold start', () => {
    expect(persistence.getReactNativePersistence).toHaveBeenCalledWith(persistence.adapter);
    expect(playerAuthPersistence).toBe(persistence.firebasePersistence);
  });
});
