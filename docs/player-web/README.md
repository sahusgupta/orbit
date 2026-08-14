# Orbit Player Web

Orbit is the public product name for the browser player surface, developed by Caminus Labs, LLC. The repository calls the project Player Web to distinguish it from the native application. It is a first-class Next.js application in `player-web/`, alongside the Vite/Electron management app, the Express API, and the Expo Player app.

## Framework and boundaries

The web application uses Next.js 16 App Router, React 19, and strict TypeScript. Server rendering provides indexable discovery and direct entity URLs; client components own local filters, location permission, Firebase Authentication, live refresh markers, and player actions. This split avoids hydrating static presentation while keeping action state responsive.

The API remains the authoritative datastore boundary. `apps/api/src/routes/player.js` publishes sanitized, unauthenticated discovery through `/player/public/discovery` and `/player/public/clubs/:clubId`; those projections remove memberships, waitlists, notifications, known-player counts, and stress records. Authenticated mutations continue through the existing Firebase-token-protected membership, waitlist, tournament, and identity endpoints. Firebase Admin and server credentials never enter Player Web bundles.

Player Web has one browser Firebase client, one auth owner, and one authenticated discovery/subscription owner. Presentation components do not issue arbitrary Firestore reads. Public live refresh listens only for `clubs` publication markers and refreshes the server-rendered route after a debounced change. Firebase is dynamically imported only when live sync, authentication, or a private player action needs it; public discovery does not load the full Firebase SDK eagerly.

## Shared domain reuse

Web aliases in `player-web/tsconfig.json` point to the canonical platform-neutral Player source:

| Concern | Canonical owner | Web use |
| --- | --- | --- |
| Player, club, membership, waitlist, and tournament contracts | `player-app/src/domain/playerSync.ts` | Direct type/rule reuse |
| Distance and discovery semantics | `player-app/src/domain/discovery.ts` | Direct selector reuse |
| Boundary validation | `player-app/src/domain/decoders/playerBoundaryDecoders.ts` | Public/authenticated response decoding |
| Membership and waitlist request shapes | `player-app/src/data/playerRequests.ts` | Direct request construction |
| Firebase Auth and Firestore access | Native Firebase owners | Web SDK adapter in `player-web/src/data/firebase-client.ts` |
| Geolocation, browser persistence, routing | Native platform owners | Browser adapters under `player-web/src/location/` and Next routing |

React Native UI, Expo services, AsyncStorage, native linking/maps, RevenueCat, and EAS configuration are intentionally not imported.

## Visual and interaction contract

Player Web product routes follow the native Player app without copying a phone shell. The home route mirrors the supplied Interactive Poker Landing Page reference: a full-screen orbital hero leads into a four-stage sticky-scroll experience for discovery, joining, queue position, and reservation. Its original orange presentation accent is replaced by midnight blue (`#191970`), while the fixed landing navigation and footer use real Orbit brand assets and real destinations. Manrope and DM Mono are bundled through Next font loading so the reference typography does not rely on a runtime font request.

The governing web rules remain `docs/architecture/ASTRYX_DESIGN_SYSTEM.md`. The landing reference now also owns the web-wide midnight-blue, teal, cream, Manrope/DM Mono, compact-corner, and orbital-line visual vocabulary. The landing keeps its presentation-specific spacing, animation, drag interaction, and example labels. Those examples are demonstrative only; authoritative game, room, queue, and tournament state continues to come from the existing API-backed product routes.

The established product routes continue to use Base UI for accessible buttons, fields, selects, forms, radio groups, dialogs, menus, tooltips, and collapsibles, with shared tokens owning their landing-aligned appearance. Attribution and upstream sources are recorded in `player-web/THIRD_PARTY_NOTICES.md`. Route headers use concise titles without explanatory subtitle copy; metadata descriptions remain intact for search and sharing. The landing route bypasses the authenticated application providers and legacy shell entirely, so it does not initialize Firebase or background shell behavior it does not use.

The Open Graph image remains the repository-approved `orbit-table-rhythm-v1.jpg` composition exported to `player-web/public/orbit-table-rhythm.jpg`; it is real brand artwork, not an interface mockup. Both landing brand positions and the application shell depend on the canonical `public/orbit-logo.svg`, and brand governance tests require byte-identical Player Web exports. Standard repository icon assets supply the favicon, app icon, and Apple touch icon.

## Search, crawler, and source contract

Every rendered route has exactly one `h1`, a unique title and description, an absolute canonical URL, an Open Graph image, and JSON-LD. The root layout declares English with `lang="en"`; content images have alt text. Public entity URLs and `/privacy` are included in the dynamic sitemap, while `/me` and `/sign-in` remain `noindex` and are disallowed in crawler rules.

`/robots.txt` permits general indexing and explicitly permits GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, PerplexityBot, and Google-Extended on public routes. `/llms.txt` describes the product, route map, ownership, and public/private data boundary; `/LLMS.txt` permanently redirects to that canonical file. The real external links are Caminus Labs, the Orbit GitHub repository, and the published contact email. There is no visitor counter because no authoritative analytics count is exposed.

The page source contains the server-rendered product and live discovery content. Production browser source maps are disabled, console calls are removed except errors, the Lucide import is optimized, and Firebase is deferred behind dynamic imports. The responsive production browser audit checks source content, metadata, schema, crawler files, assets, source-map references, console/page errors, and horizontal overflow.

## Routes

Public discovery requires no account:

- `/` — live product-led home
- `/games` and `/games/[entity]`
- `/clubs` and `/clubs/[entity]`
- `/tournaments` and `/tournaments/[entity]`
- `/sign-in` — verified email authentication and intent return
- `/privacy` — code-backed data inventory, provider disclosures, rights, and AI-development disclosure
- unknown paths — custom 404 response with a current-discovery recovery action

Verified-player routes:

- `/me` — current commitments overview
- `/me/clubs`
- `/me/games`
- `/me/tournaments`
- `/me/profile`

Entity routes accept the human-readable route key emitted by listing links and the stable entity ID as a compatibility/deep-link fallback. Public routes have route-specific titles, descriptions, canonical URLs, and Open Graph metadata. My Orbit and sign-in routes are not indexed.

## Auth and data flow

The landing page is a static, interactive product presentation and routes access requests into the existing sign-in flow. Discovery pages fetch the sanitized API projection on the server and render honest error or empty states if it is unavailable. Filters operate locally and preserve query parameters with the browser history API, avoiding a server route request for every search keystroke. Location is optional: players can grant geolocation, deny it, continue without it, or enter a manual area.

Firebase Auth uses browser-local persistence. Email accounts must be verified before they are treated as signed in. A logged-out action records a validated internal return path and action intent in the sign-in URL. Successful sign-in returns to the original game, club, or tournament. My Orbit loads private discovery only after a verified user and profile are available.

Player actions reuse existing API semantics:

- membership requests remain pay-in-person requests and never imply payment completion;
- running games accept at-club, arriving-later, or interested attendance context;
- forming games capture interest through the same waitlist request boundary;
- tournament registration/unregistration uses mutation IDs and authoritative API responses;
- action errors stay visible and never mutate the UI into a false success state.

## Local development

Install the independent lockfiles from the repository root:

```powershell
npm ci
npm ci --prefix apps/api
npm ci --prefix player-app
npm ci --prefix player-web
```

Start a deliberately local API or test service on `127.0.0.1:4629`, then:

```powershell
$env:ORBIT_API_URL='http://127.0.0.1:4629'
$env:NEXT_PUBLIC_ORBIT_API_URL='http://127.0.0.1:4629'
$env:NEXT_PUBLIC_ENABLE_FIREBASE_SYNC='false'
npm run web:dev
```

Do not run local browser work against hosted defaults. `NEXT_PUBLIC_ENABLE_FIREBASE_SYNC=false` keeps local public/auth initialization offline. The isolated browser fixture server is test tooling only:

```powershell
npm run qa:api --prefix player-web
```

It imports fixtures from `player-web/tests/`; no production route imports or depends on them.

## Environment variables

Copy variable names from `player-web/.env.example`; do not commit populated environment files.

| Variable | Purpose |
| --- | --- |
| `ORBIT_API_URL` | Server-only base URL for public SSR discovery |
| `NEXT_PUBLIC_ORBIT_API_URL` | Browser base URL for authenticated actions |
| `NEXT_PUBLIC_PLAYER_WEB_URL` | Public origin for metadata and sitemap URLs |
| `NEXT_PUBLIC_FIREBASE_*` | Public Firebase Web configuration used by Auth/Firestore |
| `NEXT_PUBLIC_ENABLE_FIREBASE_SYNC` | Set `false` only for isolated/offline local rendering; defaults to enabled |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | Optional local Auth emulator host |
| `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` | Optional local Firestore emulator host |

The API must allow the deployed Player Web origin in its CORS configuration and must use the same Firebase project accepted by API token verification and publication.

Every Express API request passes through the application-wide API quota before route registration; authentication, identity, player mutation, dashboard administration, recovery, and webhook families also receive stricter quotas. That quota is process-local, so production-wide enforcement requires project-level Vercel WAF rate-limit rules on both the API and Player Web projects. Do not substitute another module-global counter: serverless instances do not share that state. Vercel firewall changes are production configuration and must be reviewed and explicitly authorized before publication.

## Verification

Focused checks:

```powershell
npm run web:typecheck
npm run web:lint
npm run web:test
npm run web:build
```

With the isolated fixture API and local web server already running, `npm run web:e2e` checks 15 routes, including the privacy policy and custom 404, at 375 by 812, 430 by 932, 768 by 1024, 1366 by 768, 1440 by 900, and 1920 by 1080. It creates 90 screenshots and performs 31 interaction and web-quality checks covering the five-link web navigation, landing shell isolation, request-free local filtering, mobile control geometry, route-state filters, manual location, auth intent links, protected-route return paths, keyboard reachability, visible focus, raw page source, unique metadata, structured data, crawler artifacts, source-map absence, console cleanliness, and responsive overflow. Screenshots and the JSON report are generated under ignored `test-results/player-web/`.

With both the supplied reference app and the production Player Web build running locally, set `ORBIT_REFERENCE_URL` and `ORBIT_PLAYER_WEB_URL`, then run `npm run web:landing:parity`. The Playwright harness checks matching text and geometry at five scroll checkpoints on mobile and desktop, compares normalized screenshots while allowing only the approved accent-color and font substitutions, verifies every landing destination, rejects the reference orange from source, and confirms the logo and favicon match the canonical repository assets byte for byte.

The authoritative repository gate is `npm run verify`. It runs root and native TypeScript, Player Web TypeScript/lint/tests/build, existing tests, and the desktop renderer build.

## Production deployment

Use a dedicated Vercel project for Player Web; do not reuse the `orbit_app` project, whose root is the production Express API under `apps/api/`. Run `node scripts/stage-player-web-deploy.mjs <absolute-empty-directory>` to create a self-contained deployment artifact containing Player Web and copies of its canonical shared Player domain modules. Link and deploy that temporary directory to the Player Web project, then remove the artifact after verification. Set every production environment variable above, confirm API CORS and Firebase authorized domains, and deploy from a reviewed commit.

No deployment is performed by repository verification. A successful local production build demonstrates artifact readiness, not hosted credentials, DNS, CORS, or Firebase-console configuration.

## Intentional limitations

- Landing examples are presentation-only. Public discovery remains API-projected and refreshed from Firestore publication markers; it does not duplicate private Firestore queries.
- Browser geocoding is deliberately absent. Manual area selection keeps discovery usable but distance ordering requires a known coordinate.
- Membership payment remains the existing request/pay-in-person flow. No unsupported checkout completion is shown.
- Email verification delivery, hosted API CORS, Firebase authorized domains, and final hosting configuration require deployment-environment ownership.
- Browser QA uses isolated fixtures and the signed-out protected state. Authenticated action/state boundaries are covered by focused component and transport tests without contacting production services.
- Lighthouse is not installed in any repository lockfile, so no Lighthouse score is claimed. The equivalent local evidence is the optimized production build, server/client route split, zero-error 84-capture responsive matrix, keyboard/focus checks, and manual screenshot review.
