const fs = require('fs');
const path = require('path');

const apiEnvPath = path.resolve(__dirname, '..', 'apps', 'api', '.env');

if (fs.existsSync(apiEnvPath)) {
  const envText = fs.readFileSync(apiEnvPath, 'utf8');
  envText.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
}

const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    'expo-asset',
    'expo-font',
    'expo-web-browser'
  ],
  ios: {
    ...config.ios,
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY || googleMapsApiKey
    }
  },
  android: {
    ...config.android,
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY || googleMapsApiKey
      }
    }
  },
  extra: {
    ...config.extra,
    appEnv: process.env.APP_ENV || 'development',
    firebaseProjectId: 'tabletalk-s',
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '',
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '',
    googleAndroidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '',
    stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
    playerPremiumCheckoutUrl: process.env.EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL || '',
    playerPremiumPriceId: process.env.EXPO_PUBLIC_PLAYER_PREMIUM_PRICE_ID || '',
    playerPremiumProductId: process.env.EXPO_PUBLIC_PLAYER_PREMIUM_PRODUCT_ID || ''
  }
});
