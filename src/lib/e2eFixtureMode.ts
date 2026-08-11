export const isLocalE2EFixtureMode = () => {
  if (!import.meta.env.DEV || import.meta.env.VITE_E2E_FIXTURE_MODE !== 'true') return false;
  const hostname = typeof window === 'undefined' ? '' : window.location.hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
};
