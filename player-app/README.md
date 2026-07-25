# Orbit Player

Standalone Expo mobile app for players on iOS and Android.

## Current Scope

- First-run player account builder for identity, home area, search radius, preferred games, stakes, and availability.
- Discovery screen that ranks nearby/running games by seats, distance, joined clubs, and player preferences.
- Native live map UI for selecting a home area and browsing clubs by location.
- Club discovery and club-specific membership requests.
- Live game cards showing running/forming tables, available seats, waitlist counts, distance context, and table details.
- Real-time game listeners plus a full 30-second refresh across every registered card house, with an immediate refresh when the app returns to the foreground.
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

Stripe has two isolated flows: Player Premium and the card-house storefront. The storefront can offer day passes, memberships, and prepaid time packages, but the card house must connect its own Stripe account and remains the seller and fulfiller. Orbit provides discovery, checkout handoff, receipts, and entitlement sync; it does not sell poker table time itself. Table deposits, seat holds, and drop collection remain outside Player checkout.

Player Premium should be configured as a Stripe subscription around `$12.99/mo` and gates grinder/table recommendations plus player-hosted game posting. Set `EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL` to the Stripe Checkout or Payment Link URL for that monthly subscription. Management-app payment/billing remains separate.

To create the Stripe Product, recurring monthly Price, and subscription Payment Link from this repo, run:

```powershell
.\scripts\setup-player-premium-stripe.ps1 `
  -SecretKey "sk_test_..." `
  -PublishableKey "pk_test_..."
```

The setup script uses the secret key only for the Stripe API call. It writes only mobile-safe values to `.env`: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_PLAYER_PREMIUM_CHECKOUT_URL`, `EXPO_PUBLIC_PLAYER_PREMIUM_PRICE_ID`, and `EXPO_PUBLIC_PLAYER_PREMIUM_PRODUCT_ID`.

Card-house products use the Orbit API rather than a client-owned Payment Link. Set only this public value in the player app:

```text
EXPO_PUBLIC_ORBIT_API_URL=https://your-orbit-api.example.com
```

The API owns catalog defaults and platform credentials, verifies the Firebase player ID token, and creates Checkout on the selected card house's connected Stripe account. A published club must provide `stripeAccountId` (or `connectedStripeAccountId`). The API records memberships and time-wallet balances only after a signed Connect webhook confirms payment. `ORBIT_FIVE_HOUR_TIME_PRICE_CENTS` controls the fallback five-hour package price.

## Sync With Management Database

The management app publishes player-safe card-house and game state to Firebase whenever it saves. The player app listens for live changes and also re-reads all registered card houses every 30 seconds so newly formed games, opened seats, waitlists, and table changes recover cleanly after network interruptions. Polling pauses while the app is backgrounded and refreshes immediately when it becomes active again.

Desktop, API, and mobile use sync protocol v2. Every desktop save has a unique `syncRevision`; child game records are tagged with that revision, and the parent club record is the commit marker with expected entity counts. Mobile keeps its last complete revision until the entire new game set is available, which prevents mixed saves, stale removed games, and partial API publishes. Mobile membership and waitlist mutations also include a stable `clientMutationId`, and desktop marks each request as applied after ingesting it.

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

- `clubs/{clubId}`: public card-house record and current committed sync revision.
- `clubs/{clubId}/games/{gameId}`: player-safe live/forming game state for the committed revision.
- `clubs/{clubId}/memberships/{playerId}`: player-scoped membership state.
- `clubs/{clubId}/waitlists/{waitlistId}`: player-scoped interest and seat-request state.
- `clubs/{clubId}/membershipRequests/{requestId}` and `waitlistRequests/{requestId}`: idempotent mobile mutations and desktop acknowledgements.
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
