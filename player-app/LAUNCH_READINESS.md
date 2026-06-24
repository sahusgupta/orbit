# Orbit Player Launch Readiness

## Ready In Code

- Player onboarding persists locally with AsyncStorage.
- Firebase Google auth is wired for player and browser-based management sync clients.
- Player app reads club snapshots from Firestore.
- Player app writes membership and waitlist requests to Firestore.
- Management app publishes club state to Firestore on save.
- Live map UI is wired through `react-native-maps`.
- EAS build profiles are configured in `eas.json`.
- Firestore rules and indexes are included for deployment.
- Stripe native setup is opt-in and scoped only to a future social/player premium tier.

## Required External Setup

1. Enable Firestore in Firebase project `tabletalk-s`.
2. Keep Google sign-in disabled until the account/auth model is finalized.
3. Deploy Firestore rules from this directory:

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

4. Open the management app and save once for each club account so `clubStates/{accountKey}` is created.
5. Create Google Maps API keys:
   - iOS key with Maps SDK for iOS enabled.
   - Android key with Maps SDK for Android enabled.
6. Set these for production builds:

   ```bash
   GOOGLE_MAPS_IOS_API_KEY=...
   GOOGLE_MAPS_ANDROID_API_KEY=...
   ```

7. Create Apple Developer and Google Play Console app records.
8. Add privacy policy and support URLs to both stores.

## Beta Build

```bash
cd player-app
npm install
npm run typecheck
npx eas build --profile preview --platform ios
npx eas build --profile preview --platform android
```

## Production Build

```bash
cd player-app
npx eas build --profile production --platform all
```

## Important Production Hardening

The included Firestore rules are pilot-ready, not final public-launch security. They currently permit narrow unauthenticated player request writes and broad management publishing so the desktop pilot can sync without admin auth. Before wide public launch, move club-state writes to one of these:

- Firebase Admin SDK behind Cloud Functions.
- Custom claims for club/admin users.
- A separate private collection readable/writable only by club admins.

Player clients should ultimately write only request documents, not the authoritative club state.

## Payments Boundary

Stripe belongs only to the social/player app's future premium tier. Do not wire Stripe into management-app billing, table-state operations, seat requests, deposits, or club memberships.

Management-app payments should be scoped as a separate product and payment system later.

## Acceptance Test

1. Start management app.
2. Add or update a game/table/profile.
3. Confirm Firestore has `clubStates/{accountKey}`.
4. Install/open player app.
5. Create a player account.
6. Confirm clubs/games appear from Firebase.
7. Join a club.
8. Join a waitlist.
9. Confirm Firestore has request documents.
10. Confirm management app can load or apply those requests.
