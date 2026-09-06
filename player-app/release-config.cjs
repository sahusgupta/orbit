const path = require('node:path');
const PRODUCTION_ENVIRONMENT = 'production';
const PRODUCTION_ORIGIN = 'https://orbitapp-one.vercel.app';

const productionUrlVariables = Object.freeze({
  EXPO_PUBLIC_ORBIT_API_URL: '/',
  EXPO_PUBLIC_PRIVACY_POLICY_URL: '/privacy',
  EXPO_PUBLIC_SUPPORT_URL: '/support',
  EXPO_PUBLIC_TERMS_OF_SERVICE_URL: '/terms'
});

const v1DisabledFeatureVariables = Object.freeze([
  'ORBIT_V1_CARD_HOUSE_CHECKOUT_ENABLED',
  'ORBIT_V1_DEMO_DATA_ENABLED',
  'ORBIT_V1_PLAYER_PREMIUM_ENABLED',
  'ORBIT_V1_PRIVATE_GAMES_ENABLED',
  'ORBIT_V1_PUSH_NOTIFICATIONS_ENABLED',
  'ORBIT_V1_SOCIAL_AUTH_ENABLED',
  'ORBIT_V1_TOURNAMENT_REGISTRATION_ENABLED'
]);

function isPlaceholderHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.invalid')
    || normalized.endsWith('.example')
    || normalized === 'example.com'
    || normalized.endsWith('.example.com')
    || /^127\./.test(normalized)
    || /^10\./.test(normalized)
    || /^192\.168\./.test(normalized)
    || /^169\.254\./.test(normalized)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

function validateProductionUrl(variableName, rawValue, expectedPath) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return `${variableName} is required for a production Player build.`;
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    return `${variableName} must be a valid absolute URL.`;
  }

  if (parsed.protocol !== 'https:') return `${variableName} must use HTTPS.`;
  if (parsed.username || parsed.password) return `${variableName} must not contain credentials.`;
  if (parsed.search || parsed.hash) return `${variableName} must not contain a query string or fragment.`;
  if (isPlaceholderHostname(parsed.hostname)) return `${variableName} must use a non-placeholder public hostname.`;
  if (parsed.origin !== PRODUCTION_ORIGIN) {
    return `${variableName} must use the repository-approved Orbit production origin.`;
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath !== expectedPath) return `${variableName} must use the expected ${expectedPath} path.`;
  return null;
}

function validateProductionEnvironment(environment) {
  const failures = [];
  if (environment.ORBIT_APP_ENV !== PRODUCTION_ENVIRONMENT) {
    failures.push('ORBIT_APP_ENV must be production for a production Player build.');
  }
  for (const [variableName, expectedPath] of Object.entries(productionUrlVariables)) {
    const failure = validateProductionUrl(variableName, environment[variableName], expectedPath);
    if (failure) failures.push(failure);
  }
  for (const variableName of v1DisabledFeatureVariables) {
    if (environment[variableName] !== 'false') {
      failures.push(`${variableName} must be explicitly set to false for the conservative v1 build.`);
    }
  }
  if (environment.EXPO_PUBLIC_APP_CHECK_ENABLED !== 'true') {
    failures.push('EXPO_PUBLIC_APP_CHECK_ENABLED must be true for a production Player build.');
  }
  if (environment.FIREBASE_SDK_VERSION) {
    failures.push('FIREBASE_SDK_VERSION overrides are not approved for production.');
  }
  // Metro injects this build-only public value before EAS export:embed reloads
  // the config. Accept only this application's actual root, never arbitrary data.
  if (environment.EXPO_PUBLIC_PROJECT_ROOT !== undefined && (
    typeof environment.EXPO_PUBLIC_PROJECT_ROOT !== 'string'
    || !path.isAbsolute(environment.EXPO_PUBLIC_PROJECT_ROOT)
    || path.resolve(environment.EXPO_PUBLIC_PROJECT_ROOT) !== __dirname
  )) {
    failures.push('EXPO_PUBLIC_PROJECT_ROOT must identify the current Player project directory.');
  }
  const permittedPublicVariables = new Set([
    ...Object.keys(productionUrlVariables),
    'EXPO_PUBLIC_APP_CHECK_ENABLED',
    'EXPO_PUBLIC_APP_CHECK_WEB_SITE_KEY',
    'EXPO_PUBLIC_PROJECT_ROOT',
    'EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY'
  ]);
  for (const variableName of Object.keys(environment)) {
    if (variableName.startsWith('EXPO_PUBLIC_') && !permittedPublicVariables.has(variableName)) {
      failures.push(`${variableName} is not an approved public variable for the conservative v1 build.`);
    }
  }
  if (failures.length) {
    throw new Error(`Invalid Orbit Player production configuration:\n- ${failures.join('\n- ')}`);
  }
}

function withoutGoogleMapsConfig(config = {}) {
  const { googleMapsApiKey: _unusedGoogleMapsApiKey, ...remaining } = config;
  return remaining;
}

function createExpoConfig(config, environment) {
  const appEnvironment = environment.ORBIT_APP_ENV || 'development';
  if (appEnvironment === PRODUCTION_ENVIRONMENT) validateProductionEnvironment(environment);

  const androidMapsApiKey = environment.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  const configuredPlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const retainedPlugins = configuredPlugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return !['expo-camera', 'expo-splash-screen'].includes(name);
  });

  return {
    ...config,
    newArchEnabled: true,
    plugins: [
      ...retainedPlugins,
      ['@react-native-firebase/app', { ios: { disableSPM: true } }],
      '@react-native-firebase/app-check',
      ['expo-build-properties', { ios: { useFrameworks: 'static', forceStaticLinking: ['RNFBApp', 'RNFBAppCheck'] } }],
      'expo-asset',
      'expo-font',
      ['expo-camera', {
        cameraPermission: 'Allow Orbit Player to scan the PDF417 barcode on your government ID. Orbit does not save a photo.',
        microphonePermission: false,
        recordAudioAndroid: false
      }],
      ['expo-splash-screen', {
        backgroundColor: '#060C1A',
        image: './assets/splash-icon-transparent.png',
        resizeMode: 'contain'
      }],
      './plugins/with-no-ios-url-schemes.cjs'
    ],
    ios: {
      ...config.ios,
      googleServicesFile: './GoogleService-Info.plist',
      entitlements: {
        ...config.ios?.entitlements,
        'com.apple.developer.devicecheck.appattest-environment': 'production'
      },
      config: withoutGoogleMapsConfig(config.ios?.config)
    },
    android: {
      ...config.android,
      googleServicesFile: './google-services.json',
      blockedPermissions: [
        ...new Set([...(config.android?.blockedPermissions || []), 'android.permission.RECORD_AUDIO'])
      ],
      config: {
        ...config.android?.config,
        ...(androidMapsApiKey ? { googleMaps: { apiKey: androidMapsApiKey } } : {})
      }
    }
  };
}

module.exports = {
  createExpoConfig,
  PRODUCTION_ORIGIN,
  productionUrlVariables,
  validateProductionEnvironment,
  validateProductionUrl,
  v1DisabledFeatureVariables
};
