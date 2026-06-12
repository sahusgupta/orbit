const appJson = require('./app.json');

const stripePluginConfig = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? [
      [
        '@stripe/stripe-react-native',
        {
          merchantIdentifier: process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER || 'merchant.com.tabletalk.player',
          enableGooglePay: false
        }
      ]
    ]
  : [];

module.exports = () => ({
  ...appJson.expo,
  plugins: [
    ...(appJson.expo.plugins || []),
    'expo-web-browser',
    ...stripePluginConfig
  ],
  ios: {
    ...appJson.expo.ios,
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY || ''
    }
  },
  android: {
    ...appJson.expo.android,
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY || ''
      }
    }
  },
  extra: {
    ...appJson.expo.extra,
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
