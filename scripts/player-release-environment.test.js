import { describe, expect, it } from 'vitest';
import { productionPlayerEnvironment } from './player-release-environment.mjs';

describe('isolated Player release environment', () => {
  it('retains process essentials while dropping unexpected public values and credentials', () => {
    const environment = productionPlayerEnvironment({
      PATH: 'tool-path',
      TEMP: 'temp-path',
      EXPO_PUBLIC_UNREVIEWED_VALUE: 'must-not-ship',
      EXPO_PUBLIC_ORBIT_API_URL: 'https://attacker.example',
      ORBIT_UNREVIEWED_POLICY: 'true',
      FIREBASE_PRIVATE_KEY: 'secret',
      GOOGLE_APPLICATION_CREDENTIALS: 'credentials.json',
      EAS_TOKEN: 'token',
      TWILIO_AUTH_TOKEN: 'token'
    });

    expect(environment.PATH).toBe('tool-path');
    expect(environment.TEMP).toBe('temp-path');
    expect(environment.EXPO_PUBLIC_UNREVIEWED_VALUE).toBeUndefined();
    expect(environment.ORBIT_UNREVIEWED_POLICY).toBeUndefined();
    expect(environment.FIREBASE_PRIVATE_KEY).toBeUndefined();
    expect(environment.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(environment.EAS_TOKEN).toBeUndefined();
    expect(environment.TWILIO_AUTH_TOKEN).toBeUndefined();
    expect(environment.EXPO_PUBLIC_ORBIT_API_URL).toBe('https://orbitapp-one.vercel.app');
    expect(environment.ORBIT_APP_ENV).toBe('production');
  });
});
