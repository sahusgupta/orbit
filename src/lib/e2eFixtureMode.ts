type FixtureEnvironment = {
  fixtureMode: string | undefined;
  firebaseSync: string | undefined;
  apiUrl: string | undefined;
  hostname: string;
};

export const isIsolatedFixtureEnvironment = ({ fixtureMode, firebaseSync, apiUrl, hostname }: FixtureEnvironment) =>
  fixtureMode === 'true'
  && firebaseSync === 'false'
  && apiUrl === 'http://127.0.0.1:4185'
  && (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1');

export const isLocalE2EFixtureMode = () => isIsolatedFixtureEnvironment({
  fixtureMode: import.meta.env.VITE_E2E_FIXTURE_MODE,
  firebaseSync: import.meta.env.VITE_ENABLE_FIREBASE_SYNC,
  apiUrl: import.meta.env.VITE_ORBIT_LOCAL_API_URL,
  hostname: typeof window === 'undefined' ? '' : window.location.hostname
});
