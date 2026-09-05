import type { FirebaseApp } from 'firebase/app';
import type { Auth, Dependencies, Persistence } from 'firebase/auth';

export function initializePlayerAuth(
  app: FirebaseApp,
  persistence: Persistence,
  ports: {
    getExisting(target: FirebaseApp): Auth;
    initialize(target: FirebaseApp, dependencies: Dependencies): Auth;
  }
) {
  try {
    return ports.initialize(app, { persistence });
  } catch (error) {
    // Fast refresh and shared test processes can initialize the same app first.
    // In that case Firebase retains the already-configured Auth instance.
    if ((error as { code?: string } | null)?.code !== 'auth/already-initialized') throw error;
    return ports.getExisting(app);
  }
}
