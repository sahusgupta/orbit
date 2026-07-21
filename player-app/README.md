# Orbit Player

Standalone Expo mobile app for players on iOS and Android.

## Current Scope

- First-run player account builder for identity, home area, search radius, preferred games, stakes, and availability.
- Discovery screen that ranks nearby/running games by seats, distance, joined clubs, and player preferences.
- Native live map UI for selecting a home area and browsing clubs by location.
- Club discovery and club-specific membership requests.
- Live game cards showing running/forming tables, available seats, waitlist counts, distance context, and table details.
- Waitlist request flow that produces the same action payload shape the management app can ingest.
- Club-by-club loyalty status, points, and tier progress.

The app syncs with the Orbit management app through Firebase Firestore. If no club state has been published yet, it falls back to local demo snapshots in `src/data/mockClubData.ts`.

- `PlayerClubSnapshot` for club, game, table, membership, waitlist, and loyalty state.
- `PlayerMembershipRequest` when a player taps Join Club.
- `PlayerWaitlistRequest` when a player joins a game waitlist.

## Run

```bash
cd player-app
npm install
npm run start
```

Then choose iOS, Android, or web from the Expo dev tools.

## Launch Readiness

See `LAUNCH_READINESS.md` for the beta and production checklist.

Core readiness items now in the repo:

- `eas.json` for internal preview and production builds.
- `app.config.js` for production map API key injection.
- `firestore.rules` and `firestore.indexes.json` for Firebase deployment.
- `STORE_LISTING_DRAFT.md` and `PRIVACY_POLICY_DRAFT.md` for app store prep.
- Local player account persistence through AsyncStorage.

## Payments Boundary

Stripe has two isolated flows: Player Premium and verified club-membership checkout. Table actions, deposits, seat holds, drop, and time-fee collection remain outside Player checkout.

Player Premium should be configured as a Stripe subscription around `$12.99/mo` and gates grinder/table recommendations plus player-hosted game posting. Set `EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL` to the Stripe Checkout or Payment Link URL for that monthly subscription. Management-app payment/billing remains separate.

To create the Stripe Product, recurring monthly Price, and subscription Payment Link from this repo, run:

```powershell
.\scripts\setup-player-premium-stripe.ps1 `
  -SecretKey "sk_test_..." `
  -PublishableKey "pk_test_..."
```

The setup script uses the secret key only for the Stripe API call. It writes only mobile-safe values to `.env`: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL`, `EXPO_PUBLIC_PLAYER_PREMIUM_PRICE_ID`, and `EXPO_PUBLIC_PLAYER_PREMIUM_PRODUCT_ID`.

Club memberships use the Orbit API rather than a client-owned Payment Link. Set only this public value in the player app:

```text
EXPO_PUBLIC_ORBIT_API_URL=https://your-orbit-api.example.com
```

The API owns prices and Stripe secrets, verifies the Firebase player ID token, and records a membership and revenue transaction only after a signed Stripe webhook confirms payment.

## Sync With Management Database

The management app publishes club state to Firebase under `clubStates/{accountKey}` whenever it saves. The player app reads the same document and writes membership/waitlist changes back to Firebase.

## Firebase Sync

Firebase project is configured in `src/data/firebaseConfig.ts`:

```text
tabletalk-s
```

Before testing with real users, enable:

- Firestore Database.
- Firebase Authentication with Google as a sign-in provider.
- Google OAuth client IDs for web, iOS, and Android exposed to Expo as:

```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...
```

Firestore layout:

- `clubStates/{accountKey}`: full management state plus player-safe snapshot.
- `clubStates/{accountKey}/membershipRequests/{requestId}`: player join requests.
- `clubStates/{accountKey}/waitlistRequests/{requestId}`: player waitlist requests.
- `players/{uid}`: Firebase player profile, preferences, and per-club membership status.

SQLite remains as a management-app local fallback/cache during the Firebase transition.

## Live Maps

The app uses `react-native-maps`. For production iOS/Android builds, set:

```bash
GOOGLE_MAPS_IOS_API_KEY=...
GOOGLE_MAPS_ANDROID_API_KEY=...
```

Enable the relevant Google Maps SDKs for those keys. Expo Go can render maps for local testing, but production builds should use your own API keys.
