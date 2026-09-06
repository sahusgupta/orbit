type Environment = Record<string, string | undefined>;

const requiredIdentity = {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'tabletalk-s',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'tabletalk-s.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'tabletalk-s.firebasestorage.app',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '133175572500',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:133175572500:web:5e1055ff74e92d29fd8f01',
  NEXT_PUBLIC_ENABLE_FIREBASE_SYNC: 'true',
  NEXT_PUBLIC_APP_CHECK_ENABLED: 'true'
} as const;
const allowedPublicNames = new Set([
  ...Object.keys(requiredIdentity), 'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_APP_CHECK_SITE_KEY', 'NEXT_PUBLIC_ORBIT_API_URL', 'NEXT_PUBLIC_PLAYER_WEB_URL'
]);

export function validateHostedPlayerWebEnvironment(environment: Environment) {
  if (!environment.VERCEL && environment.ORBIT_WEB_ENV !== 'production') return;
  const invalid = (name: string): never => { throw new Error(`Player Web production configuration is missing or invalid: ${name}.`); };
  for (const [name, expected] of Object.entries(requiredIdentity)) {
    if (environment[name] !== expected) invalid(name);
  }
  for (const name of ['ORBIT_API_URL', 'NEXT_PUBLIC_ORBIT_API_URL']) {
    if (environment[name]?.replace(/\/$/, '') !== 'https://orbitapp-one.vercel.app') invalid(name);
  }
  if (!['https://orbit-player-web-liart.vercel.app', 'https://orbit-player-web-sahoosegs-projects.vercel.app']
    .includes(environment.NEXT_PUBLIC_PLAYER_WEB_URL?.replace(/\/$/, '') || '')) invalid('NEXT_PUBLIC_PLAYER_WEB_URL');
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(environment.NEXT_PUBLIC_FIREBASE_API_KEY || '')) invalid('NEXT_PUBLIC_FIREBASE_API_KEY');
  if (!/^6L[A-Za-z0-9_-]{20,100}$/.test(environment.NEXT_PUBLIC_APP_CHECK_SITE_KEY || '')) invalid('NEXT_PUBLIC_APP_CHECK_SITE_KEY');
  for (const [name, value] of Object.entries(environment)) {
    if (name.startsWith('NEXT_PUBLIC_') && !allowedPublicNames.has(name)) invalid(name);
    if (/EMULATOR|FIREBASE_AUTH_HOST/i.test(name) && value) invalid(name);
  }
}
