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
- On-device PDF417 ID-barcode capture before age-restricted actions, with server-enforced club-specific 18+ or 21+ eligibility and first-visit physical-ID review.

The app syncs with the Orbit management app through Firebase Firestore. If no live club state has been published, the app shows an empty state; it never inserts demo clubs or games into production.

- `PlayerClubSnapshot` for club, game, table, membership, waitlist, and loyalty state.
- `PlayerMembershipRequest` when a player taps Join Club.
- `PlayerWaitlistRequest` when a player joins a game waitlist.

## Run

```bash
cd player-app
npm ci
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

Player Premium uses Apple In-App Purchase through StoreKit and RevenueCat entitlement validation. The card-house storefront remains separate because it offers real-world venue services: the card house connects its own merchant account and remains the seller and fulfiller. Orbit provides discovery and checkout handoff; it does not sell poker table time, wagers, seat deposits, or game entries.

Create an App Store Connect monthly auto-renewable subscription with product ID `com.orbit.player.premium.monthly`, then map it to the RevenueCat entitlement `player_premium`. Configure production builds with:

```text
EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=appl_...
EXPO_PUBLIC_REVENUECAT_PREMIUM_ENTITLEMENT_ID=player_premium
EXPO_PUBLIC_APPLE_PREMIUM_PRODUCT_ID=com.orbit.player.premium.monthly
EXPO_PUBLIC_PRIVACY_POLICY_URL=https://your-public-host/privacy.html
```

Premium purchases require a development build or TestFlight build and do not run in Expo Go.

Card-house products use the Orbit API rather than a client-owned Payment Link. Set only this public value in the player app:

```text
EXPO_PUBLIC_ORBIT_API_URL=https://your-orbit-api.example.com
```

The API owns catalog and platform credentials, verifies the Firebase player ID token, and creates Checkout on the selected card house's connected Stripe account. Membership checkout resolves the submitted plan ID against that club's active server-side membership plans, so the client cannot choose its own price or duration. A published club must provide `stripeAccountId` (or `connectedStripeAccountId`). The API records memberships and time-wallet balances only after a signed Connect webhook confirms payment. `ORBIT_FIVE_HOUR_TIME_PRICE_CENTS` controls the fallback five-hour package price.

The Player app scans the PDF417 barcode on the device and discards the raw barcode immediately after extracting the confirmed name, date of birth, and address. Those safe fields go through the authenticated API; the ID photo, ID number, raw barcode, and selfie are never uploaded. The server recalculates age and enforces each club's 18+ or 21+ requirement. A passing scan is provisional until that card house checks the physical ID on the player's first visit.

## Sync With Management Database

The management app publishes player-safe card-house and game state to Firebase whenever it saves. The player app listens for live changes and also re-reads all registered card houses every 30 seconds so newly formed games, opened seats, waitlists, and table changes recover cleanly after network interruptions. Polling pauses while the app is backgrounded and refreshes immediately when it becomes active again.

Desktop, API, and mobile use sync protocol v2. Every desktop save has a unique `syncRevision`; child game records are tagged with that revision, and the parent club record is the commit marker with expected entity counts. Mobile keeps its last complete revision until the entire new game set is available, which prevents mixed saves, stale removed games, and partial API publishes. Mobile membership and waitlist mutations also include a stable `clientMutationId`, and desktop marks each request as applied after ingesting it.

The management `buildPlayerClubSnapshot` result is the player-safe pre-publication payload: it includes the required club-wide `social` summary but not revision metadata. The Firebase publisher adds protocol-v2 revision fields, publication timestamps, entity counts, and the parent-club commit marker. The Player hydrated snapshot keeps revision fields optional only so legacy pre-v2 publisher records remain readable.

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
- `orbitAccountStates/{accountKey}` and its server-only subcollections: authoritative revisioned management state and idempotency receipts.
- `orbitPublicationOutbox/{publicationId}`: server-only retryable projection checkpoints.
- `clubStates/{accountKey}`: compatibility/projection metadata; it is not a management-state authority.
- `clubStates/{accountKey}/membershipRequests/{requestId}`: player join requests.
- `clubStates/{accountKey}/waitlistRequests/{requestId}`: player waitlist requests.
- `players/{uid}`: Firebase player profile, preferences, and per-club membership status.
- `players/{uid}/private/identity`: server-only Stripe session reference and sanitized age-eligibility result.

The management desktop keeps only an OS-encrypted, non-authoritative file cache for offline recovery. Firestore is the sole persistent datastore, and only the backend publishes authoritative projections.

## Live Maps

The app uses `react-native-maps`. For production iOS/Android builds, set:

```bash
GOOGLE_MAPS_IOS_API_KEY=...
GOOGLE_MAPS_ANDROID_API_KEY=...
```

Enable the relevant Google Maps SDKs for those keys. Expo Go can render maps for local testing, but production builds should use your own API keys.
