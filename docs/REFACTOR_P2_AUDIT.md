# Orbit Refactor P2 — Pre-Implementation Audit

**Audit date:** 2026-08-10
**Stage 0 amendment:** 2026-08-11
**Audit branch:** `audit/refactor-p2-phase-1`
**Scope:** Management desktop renderer and Electron host, Express API and dashboard, Expo player app, Firebase rules/publication, public download/legal site, persistence, release configuration, tests, dependency/build output, rendered local production builds, and public production URLs. The tracked SQLite artifact and credential-shaped files were deliberately not opened.
**Change boundary:** Audit only. No application code, test, dependency, database, route, configuration, deployment, or production state was changed.
**Founder disposition:** The four engineering architecture directions in Stage 0 are settled prerequisites. Legal/company attribution and production-domain ownership/cutover are deferred, do not block engineering implementation after separate audit approval, and remain outside implementation authority until later explicit approval.

## 1. Executive Summary

| Area | Current condition | Largest concern |
| --- | --- | --- |
| Security | Several sound controls exist—Electron isolation, Firebase token checks, Stripe signature checks, prepared SQL, and escaped dashboard HTML—but core authorization boundaries are incomplete. | Two player mutation routes accept unauthenticated identities, and legacy pilot bootstrap trusts a self-supplied, format-only code. |
| Performance | Route-level lazy loading and a cycle-free module graph are in place. | A normal desktop save can publish the same full snapshot three times; player discovery grows by club and keeps duplicate listeners/polling active. |
| Design / UX | The table view has a distinctive poker identity and the public site is restrained, responsive, and free of fake content. | The floor dashboard breaks names into letters in narrow cards and uses repeated containers that flatten hierarchy. |
| Public site / SEO | The repository has five strong static pages, but the production surface is unavailable. | `orbitpoker.com` serves a GoDaddy parking lander and the configured Vercel legal/support routes return 500. |
| Reliability | Unit/type/build coverage is broad and sync protocol v2 has commit-marker semantics. | The hosted API defaults to ephemeral `/tmp` SQLite on Vercel, while concurrent full-state writes have no revision conflict protection. |
| Architecture / scalability | Runtime boundaries and the module graph are sound, but authoritative state ownership is duplicated. | Renderer, Electron, API, SQLite, and Firebase can all participate in one save without one revision/publisher owner. |

Highest-impact findings:

1. **SEC-001:** unauthenticated callers can submit membership/waitlist mutations as any supplied player.
2. **SEC-002:** the enabled-by-default legacy path can mint an active pilot license from a matching, format-only code in the request body.
3. **REL-001:** the production-default API database is ephemeral and instance-local on Vercel.
4. **SEC-003 / SEC-004:** globally readable club documents can disclose a pilot credential fallback, internal contacts, and targeted notification details.
5. **SEC-012:** repeated Stripe events can credit a time wallet repeatedly; RevenueCat events are not ordered or deduplicated.
6. **REL-002:** player and desktop mutations overwrite whole venue state without a revision check, so concurrent changes can be lost.
7. **SEC-005:** a signed-in operator can select a privileged staff role without proving its PIN.
8. **PERF-001:** one save can trigger API, Electron, and renderer Firebase publication.
9. **PERF-002 / PERF-003:** player club and tournament reads scale as per-club fan-out and remain subscribed/polled.
10. **REL-005:** every push to `main` can publish an unsigned Windows update that the app downloads and installs automatically.
11. **SEO-006:** the production public domain does not serve Orbit and shipped legal/support links return HTTP 500.

## 2. Priority Overview

| ID | Finding | Area | Severity | Effort | Why It Matters |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | Player mutation routes permit anonymous identity claims | Security | Critical | Moderate | An attacker who knows a club ID can change membership or waitlist state. |
| SEC-002 | Legacy bootstrap trusts a self-supplied pilot code | Security | Critical | Moderate | A forged format-valid code can establish a new active tenant credential. |
| SEC-003 | Public club records can expose credentials and internal contacts | Security | Critical | Moderate | Public Firestore readers may receive a usable legacy code and confidential business data. |
| SEC-012 | Payment webhooks are not idempotent or ordered | Security | Critical | Moderate | Provider retries can add paid time more than once or restore stale premium state. |
| REL-001 | Hosted API uses ephemeral, instance-local SQLite | Reliability | Critical | Large | Venue state can disappear or diverge across serverless instances. |
| REL-002 | Whole-state writes have no concurrency control | Reliability | Critical | Large | Simultaneous actions can silently overwrite one another. |
| SEO-006 | Production public URLs do not serve Orbit | Public / SEO | Critical | Moderate | The public brand, legal documents, and support surface are currently unavailable at shipped URLs. |
| SEC-004 | Targeted notifications are globally readable | Security | High | Moderate | Names, player IDs, and private operational messages can be enumerated. |
| SEC-005 | Staff privilege selection does not verify the stored PIN | Security | High | Moderate | Any signed-in operator can act as Manager or Owner. |
| SEC-006 | Dashboard key is persisted and sent in an SSE URL | Security | High | Moderate | A master key can leak through browser storage and URL logging. |
| SEC-007 | API perimeter lacks abuse and response hardening | Security | High | Moderate | Wildcard CORS and no rate limits leave identity, mutation, and webhook endpoints easy to probe. |
| SEC-008 | Loopback authentication bypass depends on `NODE_ENV` | Security | High | Small | A misconfigured proxy/runtime can make protected routes trust unauthenticated traffic. |
| SEC-009 | Sensitive state is stored unencrypted on clients | Security | High | Large | Local browser/device compromise exposes PII, hashes, and license material. |
| SEC-010 | Player phone/email identities are not verified | Security | High | Large | A user can claim a phone number without SMS proof and use weak six-character passwords. |
| SEC-011 | Player account deletion is incomplete | Security | High | Large | Deleting an account leaves operational, payment-adjacent, and social records behind. |
| PERF-001 | A desktop save can publish to Firebase three times | Performance | High | Moderate | Duplicate full writes increase cost and create conflicting revisions. |
| PERF-002 | Player club discovery fans out per club | Performance | High | Large | Initial work grows as `1 + 4N` Firestore reads plus `N` hosted API requests. |
| PERF-003 | Tournament loading refetches all clubs on child changes | Performance | High | Moderate | Each event can repeat `1 + 2N` collection reads. |
| PERF-004 | API Firebase publication is full and serial | Performance | High | Large | State saves wait on many sequential network writes and can time out. |
| PERF-005 | Initial renderer bundle remains large | Performance | High | Large | Startup parses 915 KB of JavaScript before deferred features are needed. |
| DESIGN-001 | Floor cards break names at normal desktop widths | Design / UX | High | Moderate | Staff cannot scan live player/table state quickly. |
| DESIGN-004 | Public company attribution conflicts with the stated owner | Design / UX | High | Small | Legal attribution names a different company from the founder brief. |
| DESIGN-014 | The public site calls an unsigned installer signed | Design / UX | High | Small | The release trust claim conflicts with the shipped signing configuration. |
| SEO-001 | Public pages lack canonical, social, and schema metadata | SEO | High | Moderate | Search engines and link previews lack authoritative page/entity signals. |
| REL-003 | Failed cloud publication can still appear “Synced” | Reliability | High | Moderate | Operators may assume remote state is safe when only a local save succeeded. |
| REL-004 | Application roots have no render error boundary | Reliability | High | Moderate | A render exception can blank an entire desktop or player surface. |
| REL-005 | Unsigned releases publish and auto-install without full gates | Reliability | High | Moderate | A bad or tampered build can reach rooms with no staged rollback path. |
| SEC-016 | One API key spans owner, client, and dashboard privileges | Security | High | Moderate | One disclosure can expose cross-venue data and license actions. |
| SEC-017 | Credential-shaped artifacts are present in a synced working copy | Security | High | Small | Ignored secrets can still leak through OneDrive, backup, or local sharing. |
| REL-010 | Production errors have no actionable alerting path | Reliability | High | Moderate | Current 500 responses may remain unnoticed until users report them. |
| ARCH-001 | Public/legal availability is coupled to a failing API deployment | Architecture | High | Large | API/runtime failure removes legal and support content. |
| DEP-001 | Production dependency trees contain current high advisories | Dependencies | High | Moderate | Known denial-of-service and URL/image parsing risks remain unresolved. |
| SEC-013 | Operational logs retain sensitive identity and diagnostics | Security | Medium | Moderate | Names, IDs, stacks, and usage details can spread into long-lived logs. |
| SEC-014 | Health and error responses disclose internals | Security | Medium | Small | Public callers learn filesystem/configuration details and raw failure messages. |
| SEC-015 | Pilot telemetry is not bound to its tenant | Security | Medium | Moderate | One valid tenant can pollute another tenant's device and telemetry records. |
| PERF-006 | State saves rewrite duplicate JSON synchronously | Performance | Medium | Large | Each save blocks Node while rewriting full state and every profile. |
| PERF-007 | Hot lists lack pagination and matching composite indexes | Performance | Medium | Moderate | Dashboard and telemetry queries will degrade as data grows. |
| PERF-008 | The player root updates its clock every second | Performance | Medium | Small | The large player tree rerenders even when no visible data changed. |
| DESIGN-002 | Repeated containers flatten floor hierarchy | Design / UX | Medium | Moderate | Primary decisions compete with secondary status and unused space. |
| DESIGN-003 | Public claims have no real product proof | Design / UX | Medium | Moderate | Buyers cannot verify workflows from the marketing pages. |
| SEO-002 | No crawler policy or discovery files exist | SEO | Medium | Small | Search and AI crawlers receive no explicit discovery or access guidance. |
| SEO-003 | No dedicated public 404/error page exists | SEO | Medium | Small | Bad links have no useful recovery experience. |
| SEO-004 | Legal/support content is duplicated without canonicals | SEO | Medium | Moderate | Two hosts can expose the same content as competing URLs. |
| REL-006 | Critical player actions lack in-flight guards | Reliability | Medium | Small | Fast repeat taps can create separate checkout or request IDs. |
| REL-007 | Player HTTP and hydrate flows lack timeout/stale guards | Reliability | Medium | Moderate | Weak networks can leave stale results or no actionable recovery. |
| REL-008 | Browser smoke coverage has drifted and is outside CI | Reliability | Medium | Moderate | A core-flow regression can pass the normal verification pipeline. |
| REL-009 | Live event streaming lacks recovery and capacity controls | Reliability | Medium | Moderate | Broken or excessive SSE clients cannot resume safely. |
| SEC-018 | Privileged Electron IPC trusts any Orbit renderer | Security | Medium | Moderate | A renderer compromise could reach SMS, persistence, and telemetry capabilities. |
| SEC-019 | Local imports lack authoritative type and size limits | Security | Medium | Small | Renamed or oversized files can cause expensive in-memory parsing. |
| PERF-010 | API payloads are uncompressed and broader than necessary | Performance | Medium | Moderate | Full-state serialization wastes CPU, time, and mobile data. |
| PERF-011 | Independent reads and low-risk mutations wait unnecessarily | Performance | Medium | Moderate | One slow dependency delays unrelated UI and repeat taps can duplicate work. |
| DESIGN-005 | Desktop surfaces use prohibited glassmorphism | Design / UX | Medium | Moderate | Frosted layers weaken operational hierarchy and conflict with P2 direction. |
| DESIGN-006 | Desktop backgrounds use prohibited aurora treatments | Design / UX | Medium | Moderate | Decorative meshes compete with operational state and violate the required visual direction. |
| DESIGN-007 | Persistent glows are used outside hover states | Design / UX | Medium | Small | Decorative glow makes real interaction and alert emphasis less distinct. |
| DESIGN-008 | Pill shapes are a default rather than a reserved status pattern | Design / UX | Medium | Moderate | Actions, navigation, fields, and statuses lose silhouette-based hierarchy. |
| DESIGN-009 | Typography hierarchy depends on synthetic, scattered weights | Design / UX | Medium | Moderate | Rendering and emphasis vary by platform. |
| DESIGN-010 | Accessible primitives exist but are not one governed system | Design / UX | Medium | Large | Duplicated controls make states, density, and accessibility inconsistent. |
| DESIGN-011 | Hallmarks has no repository-defined meaning | Design / UX | Medium | Small | Inventing its meaning would create unsupported product scope or claims. |
| DESIGN-012 | The public site has no FAQ experience | Design / UX | Medium | Moderate | Buyers lack a factual self-service answer path. |
| DESIGN-013 | Marketing features use a generic numbered grid | Design / UX | Medium | Moderate | The clear but generic presentation does not express the requested poker-card concept. |
| DESIGN-015 | Logo assets are duplicated without one governed source | Design / UX | Medium | Small | Brand updates and accessibility variants can drift between product surfaces. |
| DESIGN-016 | Motion patterns are scattered and sometimes repeated by default | Design / UX | Medium | Moderate | Repeated entrance/pulse effects compete with operational state and lack one purpose/timing policy. |
| REL-011 | Cold starts and route loading can show the wrong or blank state | Reliability | Medium | Moderate | Slow hydration looks like lost account state or an empty screen. |
| REL-012 | Current verification is red and file discovery is environment-sensitive | Reliability | Medium | Small | OneDrive representation creates false lifecycle failures and a red release signal. |
| A11Y-001 | Important forms depend on placeholders instead of labels | Accessibility | Medium | Moderate | Field purpose and errors are not consistently available to assistive technology. |
| A11Y-002 | Player interaction state is not consistently exposed | Accessibility | Medium | Moderate | Roles, labels, and expanded/selected state are incomplete. |
| PERF-009 | Public release metadata is fetched uncached on every home load | Performance | Low | Small | Every visit depends on GitHub and produces an error when it is blocked. |
| SEO-005 | Public pages have no official social links | SEO | Low | Small | Visitors cannot confirm an official public presence. |

**Finding totals:** 68 — 7 Critical, 25 High, 34 Medium, 2 Low.

## 3. PUBLIC SITE / SEO / PRODUCTION QUALITY AUDIT

The table covers the five repository download-site pages and three API legal/support sources. A public GET check on 2026-08-10 showed that these are not the pages currently served at the shipped production URLs. The authenticated dashboard was not accessed and must remain excluded from indexing.

Per the 2026-08-11 founder amendment, repository-side public/SEO work does not require production-domain cutover. Any implementation that needs an origin or canonical host must use centralized configuration and leave the actual production hostname pending; DNS, registrar, certificate, production-link, and cutover changes remain prohibited without later explicit approval.

| Page | Title | Description | Canonical | H1 | OG | Schema | Sitemap | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Download home | Unique | Yes | No | 1 | No | No | No | Partial—metadata gaps |
| Download product | Unique, generic | Yes | No | 1 | No | No | No | Partial—metadata gaps |
| Download support | Unique, generic | Yes | No | 1 | No | No | No | Partial—metadata gaps |
| Download privacy | Unique | Yes | No | 1 | No | No | No | Duplicate legal copy |
| Download terms | Unique | Yes | No | 1 | No | No | No | Duplicate legal copy |
| API `/privacy` | Unique | Yes | No | 1 | No | No | No | Duplicate legal copy |
| API `/terms` | Unique | Yes | No | 1 | No | No | No | Duplicate legal copy |
| API `/support` | Unique, generic | Yes | No | 1 | No | No | No | Duplicate support copy |

All inspected repository pages set `lang="en"`, use semantic heading sequences, include the real SVG/PNG logo with an accessible brand link, and render meaningful HTML without JavaScript. The builds emitted no source maps. In contrast, production `orbitpoker.com` served a 114-byte JavaScript redirect to a GoDaddy parking lander; the lander had no title/H1 and an empty favicon response.

### SEO-001 — Public pages lack canonical, social, and schema metadata

**Current:** None of the eight public HTML sources has a canonical URL, Open Graph fields/image, or JSON-LD structured data.

**Impact:** Crawlers cannot reliably consolidate page authority or build rich brand/product/link previews.

**Fix:** Choose canonical production URLs, add page-specific OG metadata and a real share image, and add valid Organization/SoftwareApplication/FAQ schema only where the visible content supports it.

**Severity:** High

### SEO-002 — No crawler policy or discovery files exist

**Current:** No repository `robots.txt`, `sitemap.xml`, or `llms.txt` exists. Production exposes parking-service versions that allow all and list only `/lander`; they are not Orbit discovery content.

**Impact:** Discovery relies on incidental links and crawler defaults.

**Fix:** Add one production-hosted robots policy, a canonical sitemap, and a concise `llms.txt` if AI-crawler policy is desired; do not expose private dashboard routes.

**Severity:** Medium

### SEO-003 — No dedicated public 404/error page exists

**Current:** No tracked 404/error document exists. An unknown production path returned HTTP 200 with the same parking redirect rather than an Orbit 404.

**Impact:** Bad links can look valid, obscure navigation mistakes, and provide no recovery path.

**Fix:** Configure the production host to return a real 404 status with a branded recovery page and a separate minimal 5xx fallback.

**Severity:** Medium

### SEO-004 — Legal/support content is duplicated without canonicals

**Current:** Privacy, terms, and support HTML exist in both the download site and API public directory with the same titles and substantially identical content.

**Impact:** Content can drift and, if both hosts are indexed, compete as duplicate pages.

**Fix:** Establish one canonical public source/URL and generate, redirect, or mark the other copy canonical from that source.

**Severity:** Medium

### SEO-005 — Public pages have no official social links

**Current:** Public navigation includes product/legal/support and a personal GitHub release destination, but no verified company social profile.

**Impact:** Visitors have fewer independent signals that they reached the official product.

**Fix:** Add only maintained, organization-owned profiles after ownership is confirmed; otherwise keep them absent.

**Severity:** Low

### SEO-006 — Production public URLs do not serve Orbit

**Current:** On 2026-08-10, `https://orbitpoker.com/`, intended page paths, and an unknown path all returned HTTP 200 bootstraps for a GoDaddy parking lander. The Player app's configured Vercel privacy, terms, and support URLs each returned HTTP 500 with an empty body.

**Impact:** Orbit's actual public brand, legal documents, support path, and search surface are unavailable at the URLs shipped in the product. This is a current production-facing outage, not only an SEO omission.

**Fix:** Repository-side static pages, metadata, legal-route aliases, 404 behavior, and deployment verification may proceed behind one centralized public-origin/canonical configuration whose production hostname remains unset or explicitly pending. **Deferred founder decision:** do not change domain ownership, DNS, registrar settings, certificates, the canonical production hostname, client production links, or perform production cutover without later explicit approval.

**Severity:** Critical

## 4. DESIGN AND UX AUDIT

The public site's restrained editorial style, real Orbit logo, direct poker-room copy, and absence of testimonials, logo carousels, fake metrics, fake screenshots, glass panels, or decorative motion are strengths. The table view also establishes a clear poker-specific identity. The issues below are observable exceptions.

### DESIGN-001 — Floor cards break names at normal desktop widths

**Current:** In a 1440-pixel render, the narrow Time Overview rail wraps a player name across several lines; at 1024 pixels, names and actions degrade to letter-by-letter wrapping.

**Problem:** Staff cannot scan live state quickly, and key actions lose readable labels near compact desktop layouts.

**Direction:** Set content-based minimums, truncate names with an accessible full label, collapse low-priority rail content earlier, and test at the Electron minimum plus common laptop sizes.

**Priority:** High

### DESIGN-002 — Repeated containers flatten floor hierarchy

**Current:** Floor, player, and status content repeatedly use similar rounded containers and shadows; rendered floor views show dense nested panels and can leave a large empty center while the right rail remains crowded.

**Problem:** Primary table decisions, secondary status, and tertiary metadata receive similar visual weight.

**Direction:** Reserve containers for real grouping, use type/spacing/dividers for secondary information, and let the operational table area claim available space before adding rail cards.

**Priority:** Medium

### DESIGN-003 — Public claims have no real product proof

**Current:** The public pages describe floor, membership, reporting, and tournament workflows but show only the logo and text.

**Problem:** A buyer cannot verify that the described product exists or understand its information density before downloading.

**Direction:** Add a few current, redacted screenshots captured from the real application with concise annotations; do not use rendered or AI-generated mockups.

**Priority:** Medium

### DESIGN-004 — Public company attribution conflicts with the stated owner

**Current:** The brief identifies Caminus Labs, LLC, while every legal/public footer names Orbit Technologies LLC.

**Problem:** Conflicting legal identity weakens trust and may create legal exposure.

**Direction:** **Deferred founder decision.** Preserve the finding and current attribution unchanged; do not alter legal entity/controller identity, “Developed by” wording, copyright attribution, legal contacts, or related public/legal copy without later explicit approval.

**Priority:** High

### DESIGN-005 — Desktop surfaces use prohibited glassmorphism

**Current:** The public site is restrained, but desktop floor and notification surfaces use translucent panels with backdrop blur (`src/styles/20-floor-dashboard.css:19` and `src/styles/260-notifications.css:5`).

**Problem:** Frosted layers weaken operational hierarchy and conflict with the P2 prohibition on glassmorphism.

**Direction:** Replace decorative blur with solid Astryx surfaces, borders, spacing, and deliberate elevation.

**Priority:** Medium

### DESIGN-006 — Desktop backgrounds use prohibited aurora treatments

**Current:** Desktop compatibility and TV/table surfaces layer multiple radial gradients, including the fixed three-radial background in `src/styles/121-premium-detail-compatibility.css:13-16` and additional meshes in `src/styles/171-tournament-tv.css:117-118`.

**Problem:** These multicolor fog/mesh backgrounds conflict with the P2 aurora and gradient-blob prohibitions and compete with operational state.

**Direction:** Remove decorative aurora/gradient blobs and use restrained tonal section transitions and structured composition.

**Priority:** Medium

### DESIGN-007 — Persistent glows are used outside hover states

**Current:** Seat, live-feed, and TV treatments include persistent or animated glows, including `src/styles/140-table-system.css:89-162` and `src/styles/171-tournament-tv.css:234`.

**Problem:** Always-on glow reduces the distinction between actual hover/focus/alert state and decoration.

**Direction:** Remove decorative persistent/animated glow; reserve visible emphasis for hover, focus, and genuine operational state.

**Priority:** Medium

### DESIGN-008 — Pill shapes are a default rather than a reserved status pattern

**Current:** Desktop CSS contains 31 `border-radius: 999px` declarations across shared controls, navigation, filters, table surfaces, reports, and statuses; the public site's primary buttons use a restrained six-pixel radius.

**Problem:** Pill-shaped controls lose meaning when actions, navigation, fields, and statuses share the same silhouette.

**Direction:** Reserve pills for compact statuses/tags and use restrained radii for ordinary actions and form controls.

**Priority:** Medium

### DESIGN-009 — Typography hierarchy depends on synthetic, scattered weights

**Current:** Product and public CSS use platform system stacks plus nonstandard weights including 650, 680, 720, 750, 760, 850, and 950; no custom font files or `@font-face` declarations are present.

**Problem:** Platform substitution and synthetic weights make hierarchy and rendered emphasis inconsistent across Windows, browsers, and devices.

**Direction:** Define Astryx font families, licensed loading/fallback behavior, supported weight files, and a small role-based weight hierarchy.

**Priority:** Medium

### DESIGN-010 — Accessible primitives exist but are not one governed system

**Current:** Radix, Lucide, Ionicons, and a small ShadCN-compatible folder exist, but most controls still use raw elements/global classes; `src/components/ui/badge.tsx` and `button.tsx` have no incoming imports.

**Problem:** Duplicated control patterns make focus, error, loading, responsive, and accessible-state behavior inconsistent.

**Direction:** Standardize the existing accessible primitives under Astryx before considering one additional primitive source; do not add BaseUI and ShadCN indiscriminately.

**Priority:** Medium

### DESIGN-011 — Hallmarks has no repository-defined meaning

**Current:** “Hallmarks” does not occur in Orbit source, routes, components, documentation, design tokens, or public copy.

**Problem:** Inventing a page, feature, or marketing meaning would create unsupported product claims and bypass founder intent.

**Direction:** **Founder Definition Required.** Do not design or implement Hallmarks until the founder defines its product meaning; afterward, substantiate it only with repository-backed Orbit capabilities.

**Priority:** Medium

### DESIGN-012 — The public site has no FAQ experience

**Current:** No FAQ route, content, or accordion exists in `download-site/` or `apps/api/public/`.

**Problem:** Prospective rooms lack a self-service answer path, and no keyboard/accessibility behavior can be reviewed.

**Direction:** Add only approved, factual FAQ content in an Orbit-specific, keyboard-accessible disclosure pattern.

**Priority:** Medium

### DESIGN-013 — Marketing features use a generic numbered grid

**Current:** `download-site/product.html:18-24` presents six features in the conventional two-column `.feature-list`; no playing-card-inspired marketing presentation exists.

**Problem:** The presentation is clear but visually generic and does not express the requested poker-card feature concept.

**Direction:** Replace only the marketing feature grid with an accessible, restrained playing-card-inspired composition; do not force the metaphor into operational UI.

**Priority:** Medium

### DESIGN-014 — The public site calls an unsigned installer signed

**Current:** `download-site/product.html:26` says “latest signed release,” while `package.json:122` disables executable signing and `.github/workflows/release.yml:20` disables certificate auto-discovery.

**Problem:** The authenticity claim is unsupported by the release configuration and can mislead users evaluating installer trust.

**Direction:** Remove the wording unless a verifiably code-signed release pipeline is approved and operating; release hardening remains REL-005.

**Priority:** High

### DESIGN-015 — Logo assets are duplicated without one governed source

**Current:** Real Orbit artwork exists, but separate SVG copies live in `download-site/orbit-logo.svg` and `apps/api/public/orbit-logo.svg`, while desktop and Player use additional raster/app assets and repeated text branding.

**Problem:** Without one approved source/export pipeline, artwork, clear-space/color variants, metadata, and accessible usage can drift by surface.

**Direction:** Establish one canonical logo source and documented export/component pipeline for public, desktop, dashboard, and Player use.

**Priority:** Medium

### DESIGN-016 — Motion patterns are scattered and sometimes repeated by default

**Current:** A global reduced-motion override is present, but dashboard panels repeatedly use `panel-rise` (`src/styles/20-floor-dashboard.css:194,262,312`) and product CSS separately defines pulses, flicker, notifications, seat, and TV motion with unrelated durations.

**Problem:** Entrance and perpetual effects can become decoration rather than hierarchy/feedback, while scattered timings make motion inconsistent and harder to tune for performance.

**Direction:** Define allowed motion purposes, frequency, duration, easing, performance budget, and reduced-motion alternative in Astryx; remove repeated default entrance/flicker and keep only intentional feedback.

**Priority:** Medium

## 5. PERFORMANCE AUDIT

### PERF-001 — A desktop save can publish to Firebase three times

**Current:** The renderer starts its own Firebase save while Electron sends the state to the API; the API publishes it, and Electron also publishes it directly. Each path creates a separate revision, and the renderer may publish a slightly different request-applied copy.

**Impact:** One user action can triple cloud reads/writes and race newer state with older state.

**Fix:** Assign one publication owner per runtime path, persist once, and pass one revision/commit result back to the renderer.

**Expected benefit:** One authoritative Firebase publication per logical save and deterministic revision order.
**Priority:** High

### PERF-002 — Player club discovery fans out per club

**Current:** The player flow waits for a local API snapshot, reads the public club collection, performs four Firestore child queries per visible club, then requests a hosted API snapshot per club. Live mode keeps one root plus four listeners per club and repeats the aggregate refresh every 30 seconds while active.

**Impact:** Initial work is `1 + 4N` Firestore queries plus `N` hosted API requests (and the local request), so latency, reads, and battery use grow directly with club count.

**Fix:** Publish/query one player-safe aggregate per club or one scoped discovery feed, remove duplicate source reads, and poll only as a fallback to listeners.

**Expected benefit:** Bounded discovery work with substantially fewer reads and radio wakeups.
**Priority:** High

### PERF-003 — Tournament loading refetches all clubs on child changes

**Current:** Initial tournament loading reads clubs and, for each club, tournaments plus the player's registrations (`1 + 2N`). Subscriptions create the same `1 + 2N` listener shape, and any child event calls a refresh that repeats all reads.

**Impact:** A single tournament change can produce a full cross-club refetch.

**Fix:** Subscribe to a player-scoped registration index and incrementally update the changed club/event; avoid eager fetch plus immediate subscription duplication.

**Expected benefit:** Work proportional to the changed tournament rather than every visible club.
**Priority:** High

### PERF-004 — API Firebase publication is full and serial

**Current:** Every state save writes full legacy state and snapshot JSON, then awaits individual REST writes for every player, game, session, membership, waitlist entry, notification, tournament, and registration before writing the commit marker. Legacy player cleanup fetches one page of up to 1,000 records.

**Impact:** Save latency and failure probability grow with venue size, and the Node request remains open for the entire fan-out.

**Fix:** Diff by revision, batch/bulk-write within provider limits, queue publication after durable persistence, and paginate cleanup.

**Expected benefit:** Fewer network round trips and a short, predictable state-save response path.
**Priority:** High

### PERF-005 — Initial renderer bundle remains large

**Current:** The production build has one 914,989-byte initial JavaScript chunk (281,186 bytes gzip). Firebase Firestore/Auth and React DOM dominate it; route views are lazy, while Firebase remains on the startup path. QR scanning is a separate 412,054-byte chunk and ExcelJS is a separate 1,066,528-byte chunk.

**Impact:** Desktop startup pays parse/compile cost for cloud sync before most features are used.

**Fix:** Move Firebase behind authenticated/sync-needed dynamic boundaries, keep QR/Excel deferred, and set explicit initial/dynamic bundle budgets in verification.

**Expected benefit:** A materially smaller initial chunk; exact target should be chosen after startup profiling.
**Priority:** High

### PERF-006 — State saves rewrite duplicate JSON synchronously

**Current:** API SQLite stores the full state as `state_json`, deletes every `account_profiles` row, and reinserts every profile with another `raw_json` copy on each save. `node:sqlite` operations are synchronous.

**Impact:** Write and serialization work scales with total venue history and blocks the API event loop.

**Fix:** Persist changed entities transactionally, avoid duplicated full/raw projections, and keep whole snapshots only as versioned checkpoints where justified.

**Expected benefit:** Smaller writes and shorter event-loop stalls as venues grow.
**Priority:** Medium

### PERF-007 — Hot lists lack pagination and matching composite indexes

**Current:** Client/venue dashboard lists and several Firestore discovery collections are unbounded. SQLite has single-column venue/time indexes, but actual filters/orderings use combinations such as `(venue_id, occurred_at, id)` and `(device_id, occurred_at)`; update events have no supporting device/time index.

**Impact:** Memory, transfer, and scan/sort cost grow with operational history.

**Fix:** Add cursor pagination to every growing list, run `EXPLAIN QUERY PLAN` on representative local data, then add only the composite indexes proven useful.

**Expected benefit:** Predictable page sizes and index-backed operational queries.
**Priority:** Medium

### PERF-008 — The player root updates its clock every second

**Current:** `usePlayerLiveData` sets root state from a one-second interval so membership time comparisons stay current.

**Impact:** The large `PlayerApp` subtree can rerender every second even when the visible screen has no ticking content.

**Fix:** Move clocks into the smallest components that display time and use minute/deadline-based scheduling where second precision is unnecessary.

**Expected benefit:** Fewer idle renders and lower mobile CPU/battery use.
**Priority:** Medium

### PERF-009 — Public release metadata is fetched uncached on every home load

**Current:** The download home page requests GitHub's latest-release API with `cache: 'no-store'` on every load and falls back after a console error when unavailable.

**Impact:** Rendering metadata depends on a third party and consumes a request even when the release has not changed.

**Fix:** Resolve version/asset metadata at build or deployment time, or cache a same-origin manifest with a bounded TTL.

**Expected benefit:** No third-party request on the critical public-page path.
**Priority:** Low

### PERF-010 — API payloads are uncompressed and broader than necessary

**Current:** Express enables JSON parsing but no transport compression. State mutations return save metadata, Firebase publication status, and a rebuilt player snapshot while management routes exchange whole state objects; the public club projection also carries fields not needed for discovery.

**Impact:** Repeated serialization and larger responses add CPU, network time, and mobile data cost as venue state grows.

**Fix:** Measure representative payloads, define purpose-specific response DTOs, remove backend-only fields, enable safe HTTP compression at the hosting boundary, and retain `no-store` for sensitive state.

**Expected benefit:** Fewer bytes and less serialization work without changing sync protocol semantics.
**Priority:** Medium

### PERF-011 — Independent reads and low-risk mutations wait unnecessarily

**Current:** Player discovery awaits the local API before Firebase aggregation; tournament registrations are read after tournament reads per club; membership/waitlist actions wait for remote completion and often replace state from the returned snapshot. Several controls have no in-flight guard.

**Impact:** One slow dependency delays unrelated data, actions feel slower, and repeated taps can create duplicate work.

**Fix:** Parallelize independent reads, deduplicate requests, add abort/stale-response guards, and use reversible optimistic state only for idempotent low-risk actions. Payments, identity, and authoritative seating remain server-confirmed.

**Expected benefit:** Faster perceived interaction and shorter critical paths with explicit rollback.
**Priority:** Medium

## 6. SECURITY AUDIT

### SEC-001 — Player mutation routes permit anonymous identity claims

**Current:** `POST /player/membership-requests` and `/player/waitlist-requests` are registered before global client authentication. Their optional Firebase middleware accepts requests with no token, after which handlers trust body-supplied player ID, email, name, club ID, and request ID and save the full venue state.

**Risk:** Anyone who learns a club ID can impersonate a player, create or cancel requests, and trigger full state/Firebase publication.

**Fix:** Require a verified Firebase user and age where applicable, derive identity only from that token, validate the club relationship, and reject anonymous requests.

**Severity:** Critical
**Affected:** API player routes, SQLite state, Firebase publication, player app

### SEC-002 — Legacy bootstrap trusts a self-supplied pilot code

**Current:** When `ORBIT_LICENSE_ALLOW_LEGACY_BOOTSTRAP` is not exactly `false`, an unknown `TT-PILOT-` code is accepted if the same value appears in body state. Registration checks its format and expiration but does not verify the desktop license signature.

**Risk:** A caller can invent a format-valid code and future expiry, register an active license, and create or overwrite a tenant.

**Fix:** Disable bootstrap by default, move migration behind a short-lived server-issued challenge, and verify the signed license payload before creating a managed record.

**Severity:** Critical
**Affected:** API authentication, licensing, Firebase license collection, venue state

### SEC-003 — Public club records can expose credentials and internal contacts

**Current:** Firestore allows anyone to read `clubs/{clubId}`. The published record includes account/contact names, email, phone, renewal dates, internal snapshot paths, and `licenseIdentifier`; when no license ID exists, that field falls back to the pilot authorization code.

**Risk:** Public enumeration can expose confidential business data and, for legacy records, an authentication credential.

**Fix:** Publish a strict player-safe club projection, remove credentials/internal paths, and restrict any nonpublic club metadata to authenticated, scoped readers.

**Severity:** Critical
**Affected:** Firebase publisher, Firestore rules, desktop/API clients

### SEC-004 — Targeted notifications are globally readable

**Current:** `clubs/{clubId}/notifications/{id}` is public. Publication without a player context includes all in-app notifications, including target player IDs/names and membership, seat, and game messages.

**Risk:** Anyone can enumerate player relationships and private operational messages.

**Fix:** Make notifications self/admin-readable, store recipient IDs in access-controlled documents, and expose only a deliberately public announcement collection.

**Severity:** High
**Affected:** Firestore rules, API/Electron/renderer publishers, player app

### SEC-005 — Staff privilege selection does not verify the stored PIN

**Current:** Staff PINs are PBKDF2-hashed when created, but selecting `activeStaffId` requires no PIN. Closeout authorization then trusts the selected role, including Manager and Owner.

**Risk:** Any person with the management login can assume a privileged staff identity and approve, lock, or reopen financial closeouts.

**Fix:** Require PIN verification for staff activation and privileged actions, enforce role checks in one command boundary, and record failed/elevated attempts.

**Severity:** High
**Affected:** Management renderer, closeout commands, persisted staff accounts

### SEC-006 — Dashboard key is persisted and sent in an SSE URL

**Current:** The owner/dashboard key is stored in `localStorage`; the event stream connects with `?apiKey=...`. Query keys are also accepted by the shared API-key reader.

**Risk:** A master credential can leak through browser inspection, URLs, proxy/access logs, referrers, or captured history.

**Fix:** Use a short-lived, HttpOnly/SameSite dashboard session or scoped token; authenticate streaming without query secrets; rotate the current key.

**Severity:** High
**Affected:** API dashboard, SSE, API authentication

### SEC-007 — API perimeter lacks abuse and response hardening

**Current:** The API applies unrestricted `cors()` globally and has no rate limiter, CSP/Helmet-equivalent headers, per-identity quota, or connection cap. JSON size limits and provider webhook authentication exist, but mutation, login-like, identity, webhook, and streaming surfaces remain broadly probeable.

**Risk:** Automated abuse can consume resources, enumerate behavior, or amplify other authorization defects.

**Fix:** Define origin policy per route, add trusted-proxy-aware rate/connection limits, standard security headers, and separate quotas for identity, mutation, webhook, and dashboard traffic.

**Severity:** High
**Affected:** Express API, dashboard, SSE, public endpoints

### SEC-008 — Loopback authentication bypass depends on `NODE_ENV`

**Current:** Any loopback request bypasses client authentication unless `NODE_ENV` equals `production` exactly.

**Risk:** A reverse proxy, sidecar, or misconfigured hosted runtime can make remote traffic appear local and expose protected state routes.

**Fix:** Gate local bypass with an explicit development-only flag and process binding, reject it in hosted environments, and test proxy address handling.

**Severity:** High
**Affected:** API authentication and deployment configuration

### SEC-009 — Sensitive state is stored unencrypted on clients

**Current:** Browser persistence writes the complete management state to `localStorage`, including player data, account password hashes, staff PIN hashes, and pilot access. Expo `AsyncStorage` holds the full player profile; “stay signed in” is a local marker lasting until license expiry, with no idle timeout.

**Risk:** Local malware, browser script compromise, shared-device access, or device backup extraction can expose restricted data and extend unauthorized access.

**Fix:** Keep secrets and restricted records out of renderer storage, use OS secure storage for tokens, encrypt necessary local data, and add bounded/idle sessions with reauthentication for sensitive actions.

**Severity:** High
**Affected:** Management renderer, Electron persistence boundary, player app

### SEC-010 — Player phone/email identities are not verified

**Current:** “Phone” sign-in converts digits to a deterministic `phone-{digits}@players.orbit.local` email and uses email/password auth; no SMS OTP proves number ownership. Email verification is not required, the minimum password is six characters, and no player reset flow is exposed.

**Risk:** Numbers can be squatted or impersonated, weak credentials are easier to compromise, and legitimate users can be locked out.

**Fix:** Use Firebase phone OTP or another verified provider, require verified email where email is identity, raise password requirements, and add secure recovery.

**Severity:** High
**Affected:** Expo player authentication, Firebase Auth, Firestore self-access

### SEC-011 — Player account deletion is incomplete

**Current:** Deletion removes the API identity record, `players/{uid}`, and Firebase Auth user. Membership/waitlist requests and records, tournament registrations, hosted private games, targeted notifications, venue SQLite copies, telemetry, and transaction/audit retention are not reconciled.

**Risk:** Users reasonably expecting deletion leave identifiable and operational records across systems, with no visible retention outcome.

**Fix:** Define the legal retention policy, orchestrate deletion/anonymization across every store, make the operation resumable, and show the user what is retained and why.

**Severity:** High
**Affected:** Player app, API, Firestore, venue state, telemetry/payments

### SEC-012 — Payment webhooks are not idempotent or ordered

**Current:** Stripe signatures are verified, but a repeated `checkout.session.completed` event performs `FieldValue.increment(300)` again for a time package. RevenueCat authenticates its webhook token but does not store processed event IDs or reject older events.

**Risk:** Provider retries/replays can over-credit paid time, while out-of-order subscription events can overwrite a newer premium state.

**Fix:** Claim provider event IDs transactionally before applying effects, derive wallet balance from immutable transactions or an idempotent ledger, and compare RevenueCat event time/version before updating status.

**Severity:** Critical
**Affected:** Stripe/RevenueCat webhooks, Firestore billing and membership records

### SEC-013 — Operational logs retain sensitive identity and diagnostics

**Current:** Domain events log account keys, player IDs/names, and plan information. Client error/telemetry records can retain current user data, stack traces, and arbitrary details.

**Risk:** Central logs become a secondary store of confidential data with unclear minimization and retention.

**Fix:** Define an allowlist/redaction layer, hash or remove identities where not needed, cap detail size, and set documented retention/deletion controls.

**Severity:** Medium
**Affected:** API logs, telemetry SQLite, Electron reporting, dashboard

### SEC-014 — Health and error responses disclose internals

**Current:** Public `/health` returns the resolved database filesystem path, environment, and provider configuration. The global handler and Stripe webhook return raw exception messages and map failures to HTTP 400.

**Risk:** Attackers gain deployment detail, and users receive unstable/internal messages that may expose provider or validation internals.

**Fix:** Return a minimal public health result, put diagnostics behind owner auth, map typed errors to stable statuses/codes, and log full details only after redaction.

**Severity:** Medium
**Affected:** API system routes, error middleware, Stripe webhook

### SEC-015 — Pilot telemetry is not bound to its tenant

**Current:** Pilot authentication contains an account key, but heartbeat, update, telemetry, and error payloads accept caller-supplied `venueId` and `deviceId` without binding them to that key.

**Risk:** One valid tenant can create or contaminate another tenant's device and telemetry history.

**Fix:** Derive venue identity from `request.orbitAuth`, namespace device IDs by tenant, and reject cross-tenant payload fields.

**Severity:** Medium
**Affected:** Client API routes, telemetry/client SQLite tables, dashboard

### SEC-016 — One API key spans owner, client, and dashboard privileges

**Current:** `ORBIT_CLIENT_API_KEY` can authenticate ordinary client routes, owner telemetry/data routes, and the dashboard fallback. No per-client audience, capability, expiry, or rotation record exists in the repository.

**Risk:** Disclosure of one shared value can expose cross-venue operational data and privileged license actions far beyond the intended caller.

**Fix:** Replace the master-key fallback with separately scoped, rotatable credentials bound to tenant and capability; use a server-managed session for the owner dashboard.

**Severity:** High
**Affected:** Express API and dashboard

### SEC-017 — Credential-shaped artifacts are present in a synced working copy

**Current:** The OneDrive-backed repository directory contains ignored `*-pilot-key.json`, `*-firebase-adminsdk-*.json`, and Firebase/debug-log artifacts. Their contents were not opened; Git confirms they are ignored and untracked.

**Risk:** If any artifact is live, cloud-folder sync, backup, malware, or accidental sharing can expose signing, Firebase, or venue access material even though Git ignores it.

**Fix:** Inventory validity without copying values, rotate anything real, remove secrets and sensitive logs from synced/project directories, and use an approved secret store.

**Severity:** High
**Affected:** Developer workstation and operational credentials

### SEC-018 — Privileged Electron IPC trusts any Orbit renderer

**Current:** Context isolation, sandboxing, disabled Node integration, and navigation blocking are good. However, IPC handlers do not validate the sender frame, several accept broad objects, `send-text-messages` can request up to 200 Twilio messages, and external links allow any HTTP(S) host.

**Risk:** A future renderer compromise or unsafe content path could invoke privileged persistence, telemetry, SMS, or external-navigation behavior from the main process.

**Fix:** Validate sender URL/frame and payload schemas per channel, narrow costly capabilities, rate-limit messaging, and use an explicit HTTPS host allowlist where links are known.

**Severity:** Medium
**Affected:** Electron main/preload boundary

### SEC-019 — Local imports lack authoritative type and size limits

**Current:** CSV/XLSX, JSON backup, and key-file inputs use `accept` filters, then read `text()` or `arrayBuffer()` in memory. No server upload path exists, but file size and authoritative content/MIME checks are absent.

**Risk:** A renamed or very large local file can exhaust memory or drive expensive parsing; `accept` is only a picker hint.

**Fix:** Enforce small per-flow byte limits before reading, validate signature/structure rather than extension alone, and keep imported files local and non-executable.

**Severity:** Medium
**Affected:** Desktop local import flows

### 6.32 Data Classification

| Data | Classification | Stored Where | Main Protection Needed |
| --- | --- | --- | --- |
| Dashboard/client keys, Firebase Admin material, Twilio/Stripe/RevenueCat secrets, license signing material | Restricted | Secret provider/environment; ignored local artifacts were observed but not read | Secret manager, rotation, least privilege; never browser/URL/log/synced folders |
| Password/PIN hashes and salts, Firebase session credentials, pilot authorization codes | Restricted | Desktop state/SQLite/localStorage; Firebase/native persistence; API/Firebase | Provider/memory-hard hashing, secure OS storage or HttpOnly session, expiry/revocation |
| Player identity/contact, age result, membership, payments, time wallet | Confidential | Desktop/API SQLite, Firestore, Player device | Authenticated per-user/tenant access, minimization, encryption, retention/deletion |
| Venue contacts, waitlists, seating, buy-ins, ledger, tournaments, reports, staff actions | Confidential | Desktop/API state, SQLite, protected/public Firestore projections | Tenant isolation, revision control, minimal public projection, audit/retention |
| Error stacks, telemetry, device/request IDs, paths/config status | Internal | SQLite, Electron logs, Vercel/console where configured | Redaction, bounded retention, restricted access, correlation without PII |
| Marketing copy, approved logos, intended public game/tournament summary | Public | Static site and explicitly public Firestore documents | Deliberate allowlist, accurate branding, integrity, no private fields |
| Source maps, deployment identifiers, API/database topology | Internal | Build/hosting metadata | Private monitoring upload only; access control and no public disclosure |


## 7. Reliability Findings

### REL-001 — Hosted API uses ephemeral, instance-local SQLite

**Current:** With `VERCEL` set and no database URL, the API opens `file:/tmp/orbit-api.sqlite3`. The repository has no persistent database adapter; non-SQLite URLs are rejected.

**Impact:** Serverless restarts can erase venue state, and concurrent instances can read/write different databases despite desktop/player defaults pointing to the hosted API.

**Fix:** Move hosted state to a durable multi-instance database, migrate under a reviewed plan, and fail startup rather than accept ephemeral production persistence.

**Priority:** Critical

### REL-002 — Whole-state writes have no concurrency control

**Current:** Player routes and desktop saves load, modify, and replace complete venue JSON without `If-Match`, expected revision, database compare-and-swap, or mutation ledger.

**Impact:** Concurrent requests can both succeed while the later save silently discards the earlier change.

**Fix:** Make mutations server-side and entity-scoped, require an expected revision, transact updates, and return a conflict that can be refreshed/replayed safely.

**Priority:** Critical

### REL-003 — Failed cloud publication can still appear “Synced”

**Current:** Renderer and Electron Firebase failures are caught and ignored; the save result is labeled `firebase-pending`, while the shell renders every non-error state as “Synced.” The API can also durably save SQLite while reporting publication failure separately.

**Impact:** Operators can close the app believing player-visible state is current when publication failed.

**Fix:** Model local-saved, cloud-pending, cloud-failed, and cloud-confirmed separately; retry safely by revision and show a durable action/error state.

**Priority:** High

### REL-004 — Application roots have no render error boundary

**Current:** Both React roots use loading/Suspense behavior but no `ErrorBoundary`/`componentDidCatch` boundary was found around the shell or routes.

**Impact:** A render or lazy-chunk exception can replace a full application surface with a blank screen.

**Fix:** Add a root recovery boundary plus route-level boundaries that preserve navigation, capture a redacted incident ID, and offer reload/retry.

**Priority:** High

### REL-005 — Unsigned releases publish and auto-install without full gates

**Current:** Every push to `main` starts the release workflow, which runs `npm test` but not the full `npm run verify`, publishes unsigned Windows artifacts, and commits a release log. Electron auto-downloads and calls `quitAndInstall` three seconds after download.

**Impact:** A type/build/player regression or compromised unsigned artifact can reach live workstations with no approval, canary, or documented rollback gate.

**Fix:** Require the complete CI result, protected/tagged approval, code signing, staged rollout, explicit install timing, health monitoring, and a tested rollback channel.

**Priority:** High

### REL-006 — Critical player actions lack in-flight guards

**Current:** Membership request and checkout functions set messages but have no shared busy flag; buttons are not disabled while those promises are pending. Each repeat action can generate a new request/session ID.

**Impact:** Rapid taps can create duplicate provider sessions or logically duplicate requests.

**Fix:** Add per-action in-flight locks, disable/label the initiating control, and enforce server idempotency keys in addition to UI protection.

**Priority:** Medium

### REL-007 — Player HTTP and hydrate flows lack timeout/stale guards

**Current:** Player `fetch` calls have no abort timeout or retry policy. Profile/tournament promise failures are often swallowed, and profile hydration has no sequence/cancellation check before replacing current state.

**Impact:** Weak networks can leave indefinite waits, silent stale data, or a late result applied after identity/state changed.

**Fix:** Add bounded aborts, explicit retry controls/backoff for reads, sequence guards, and visible stale/offline state; never blindly retry mutations.

**Priority:** Medium

### REL-008 — Browser smoke coverage has drifted and is outside CI

**Current:** The existing management smoke harness is manual and not part of `npm run verify`; in this audit it timed out because `.start-table-panel` remained hidden, while an independent route capture rendered all eight routes.

**Impact:** The repository lacks a dependable user-flow signal and the current harness failure is ambiguous rather than actionable.

**Fix:** Repair selectors/fixtures against intended behavior, make the test deterministic with isolated endpoints, and promote a small critical-flow suite to CI.

**Priority:** Medium

### REL-009 — Live event streaming lacks recovery and capacity controls

**Current:** Dashboard SSE uses an in-memory client set with no heartbeat, replay ID/resume support, backpressure policy, connection limit, or token revalidation.

**Impact:** Dead clients can linger, reconnects miss events, and multi-instance/serverless operation cannot provide a coherent stream.

**Fix:** Add heartbeats and bounded connections now; for multi-instance hosting, use a durable event cursor/backplane and short-lived scoped authentication.

**Priority:** Medium

### REL-010 — Production errors have no actionable alerting path

**Current:** The API and Electron emit console/file/SQLite telemetry, but no integration routes server-error spikes, authentication abuse, deployment failures, or service degradation to an on-call destination. Vercel retention, correlation, and alerts could not be verified from the repository.

**Impact:** The current public 500 responses and a future API incident may remain unnoticed until a user reports them.

**Fix:** Add structured redacted events with request/tenant correlation, error-rate and availability alerts, deployment notifications, runbooks, and an owned escalation destination; verify Vercel settings with an authorized owner.

**Priority:** High

### REL-011 — Cold starts and route loading can show the wrong or blank state

**Current:** Player renders onboarding before `accountLoaded` completes, so a returning account can flash the new-user flow. Desktop lazy routes use an empty `aria-busy` main as fallback, and significant Player reads lack predictable skeleton layouts.

**Impact:** Slow storage or network startup looks like lost account state or a blank screen and causes layout shifts.

**Fix:** Gate routing on hydration, use layout-matched skeletons for predictable reads, provide explicit empty/error/retry states, and preserve announced loading semantics.

**Priority:** Medium

### REL-012 — Current verification is red and file discovery is environment-sensitive

**Current:** The initial `npm run verify` passed all TypeScript projects and the build, but 2 of 471 tests failed because `playerApplicationOrchestration.test.ts` accepts only `Dirent.isFile()`; extracted Player hook files are OneDrive reparse points and are skipped. Revision verification reproduced those two failures and also hit one 5-second API compiler-test timeout; that API file immediately passed 6/6 in a focused rerun, so the stable known failures remain the two OneDrive-sensitive assertions.

**Impact:** A developer receives a false lifecycle-regression signal based on filesystem representation, while a red gate reduces release confidence.

**Fix:** Make characterization discovery follow repository files safely and platform-independently, then restore a green full gate without weakening assertions.

**Priority:** Medium

## 8. ACCESSIBILITY AUDIT

Source, semantic markup, rendered desktop/public captures, focus styles, ARIA/accessibility props, dialogs, menus, form labels, error announcements, reduced motion, and mobile controls were inspected. Automated contrast tooling and device assistive-technology runs were unavailable, so those items remain explicit verification work.

### A11Y-001 — Important forms depend on placeholders instead of labels

**Current:** Desktop login/setup and the API dashboard key field have placeholder-only inputs; the dashboard status region is not live. Many later product forms do use labels or accessible names, so coverage is inconsistent rather than absent.

**Impact:** Screen-reader users and users with cognitive or memory constraints can lose field purpose after typing, and connection/error changes may not be announced.

**Fix:** Add persistent programmatic labels, descriptions, error associations, and polite/assertive live regions as appropriate; retain visible text for consequential actions.

**Priority:** Medium

### A11Y-002 — Player interaction state is not consistently exposed

**Current:** Player uses professional icons and many explicit labels, but tab-like controls, disclosures, selected chips, and some modal close/back controls do not consistently expose role, selected/expanded state, or a descriptive name. Seventy-six `Pressable` elements have only partial explicit metadata.

**Impact:** Screen-reader and switch users may not know what a control does or whether a section/tab is active.

**Fix:** Standardize roles, names, state, modal focus behavior, target sizes, and announcements in shared Player primitives, then verify with VoiceOver/TalkBack and keyboard web use.

**Priority:** Medium

### Accessibility scope reconciliation

| Requirement | State | Evidence / direction |
| --- | --- | --- |
| Keyboard navigation and focus | Partially satisfied | Public focus styles and Radix foundations exist; run route-by-route order, trap, return-focus, and skip/landmark checks. |
| Semantic HTML and headings | Partially satisfied | Static pages are semantic with one H1; dynamic application route/landmark naming is inconsistent. |
| Form labels and error announcements | Vulnerable | Placeholder-only fields and inconsistent live/error association; fix under A11Y-001. |
| Button labels, icon-only controls, tooltips | Partially satisfied | Many names exist; policy and native state/role coverage are incomplete. |
| Dialogs, menus, ARIA | Partially satisfied | Radix desktop primitives are strong; Player sheets/disclosures need explicit roles/state/focus verification. |
| Contrast | Needs verification | Visual review only; measure every light/dark/disabled/focus/error Astryx token pair. |
| Image alt text | Satisfied | Current public image is decorative/brand context; future real screenshots need contextual alt. |
| Reduced motion | Satisfied | Global reduced-motion behavior exists; preserve while removing decorative pulse/glow. |
| Mobile interaction | Partially satisfied | Touch-first UI exists; standardize target size, role, selected/expanded, and announcements. |

## 9. DATABASE AND NETWORK HOTSPOTS

### Saving management state

Current sequence:

1. Renderer serializes the complete state and sends it through Electron.
2. Electron sends the complete state to the API.
3. API synchronously replaces SQLite state/profiles.
4. API serially publishes the full Firebase projection and returns.
5. Electron also starts a direct Firebase publication.
6. Renderer independently starts another Firebase publication when sync is enabled.

**Problem:** Up to three cloud revisions and several full-state serializations are created for one logical save.

**Opportunity:** One durable write, one revisioned outbox/publication owner, and incremental entity changes.

### Opening player club discovery

For `N` visible clubs, current initial work is:

1. One local API snapshot request, awaited first.
2. One Firestore club-root query.
3. Four parallel child queries per club: games, the player's memberships, the player's waitlists, and all notifications.
4. One hosted API snapshot request per club.
5. Live mode then holds `1 + 4N` Firestore listeners and repeats the aggregate flow every 30 seconds while active.

**Problem:** Reads and network sources grow with every club and duplicate substantially similar snapshots.

**Opportunity:** A single scoped discovery feed or player-safe club aggregate, incremental listeners, and polling only as fallback.

### Loading player tournaments

Current initial work is one club query plus tournament and player-registration queries for every club (`1 + 2N`). The hook also starts live subscriptions immediately; every child event invokes the same aggregate refetch.

**Problem:** One event can cause cross-club work unrelated to the changed tournament.

**Opportunity:** Query a player registration index, fetch only referenced tournaments, and update the changed club incrementally.

### Publishing a venue snapshot

Current API publication writes one full legacy state/snapshot document, then each player, game, game session, membership, waitlist item, notification, tournament, and registration one at a time, followed by the club commit marker. Legacy cleanup reads at most 1,000 player documents.

**Problem:** A state request remains coupled to an unbounded number of serial remote calls, and stale documents beyond the first cleanup page can remain.

**Opportunity:** Queue a revisioned outbox after durable state commit, diff records, use provider bulk operations, paginate reconciliation, and retain the commit marker last.

### Querying operational telemetry

Telemetry uses cursor pagination, but its common venue/device filters and descending time ordering do not match composite indexes. Client detail reads the latest 100 update events by device with no device/time index; client and venue summary lists are unbounded.

**Problem:** SQLite must scan/sort more history as deployments grow.

**Opportunity:** Capture `EXPLAIN QUERY PLAN` on representative safe data, add proven composite indexes, and cursor-page every growing list.

## 10. DEPENDENCY AUDIT

| Dependency | Purpose | Issue | Proposed Action |
| --- | --- | --- | --- |
| Firebase web SDK | Auth, Firestore sync | Firestore/Auth dominate the 915 KB initial renderer chunk despite sync not being needed for every startup path. | Dynamically load after authentication/sync need; preserve protocol v2 behavior and measure the new initial budget. |
| ExcelJS | Spreadsheet import/export | Produces a 1,066,528-byte deferred chunk and triggers the build's `eval` warning. | Keep deferred; narrow imported functionality or evaluate a smaller parser only with compatibility fixtures. |
| `@zxing/browser` + `@zxing/library` | QR scanning | The deferred QR chunk is 412,054 bytes and includes broad barcode formats; `@zxing/library` is transitive through the browser package but is also declared directly without a direct import. | Confirm supported formats, remove an unnecessary direct declaration if lockfile analysis proves it redundant, and configure a QR-only path if supported. |
| Vite, TypeScript, `@vitejs/plugin-react` | Build/type tooling | They are production dependencies, so desktop packaging may retain tooling that is not required at runtime. | Prove packaged runtime requirements, then move build-only packages to `devDependencies` and compare artifact size. |
| Root transitive `brace-expansion`, `js-yaml`, `minimatch`, `nanoid` | Tool/runtime transitive utilities | `npm audit --omit=dev` reports 4 High advisory entries; runtime reachability was not established. | Trace packaged reachability and update through compatible parents/lockfile with full verification; do not use a blind audit fix. |
| Expo / React Native / Metro chain and `react-native-purchases` | Player runtime/build/subscriptions | Player production audit reports 16 High entries, including direct Expo, React Native, and purchases packages plus transitive tooling. | Follow the supported Expo SDK upgrade path, confirm advisory reachability on shipped platforms, and retest native purchase/auth flows. |

The API production audit reported zero known vulnerabilities. Direct installed package metadata across all three manifests declared permissive licenses (MIT/MIT-0, Apache-2.0, ISC, BSD, 0BSD, or BlueOak); no custom font is shipped, so no font-license issue was found. No direct dependency was proven abandoned merely because a newer major exists. Public pages are static HTML and the desktop/Player apps are intentionally client runtimes, so SSR incompatibility is not a current deployment defect. Module-graph analysis covered 170 source modules and 521 relative edges with zero cycles, dependency-boundary violations, or unresolved imports; only two configured-independent UI files (`ui/badge.tsx`, `ui/button.tsx`) were zero-incoming candidates and should be removed only after ownership/use verification.

### DEP-001 — Production dependency trees contain current high-severity advisories

**Current:** Read-only `npm audit --omit=dev` reported 4 high advisories in the root tree and 16 high advisories in the Player tree; the API tree reported zero. A Player `image-size` path has no non-breaking audit recommendation, and no audit fix was run.

**Impact:** Even when many paths are build-time, unresolved advisories create denial-of-service and URL/image parsing risk and make release provenance harder to defend.

**Fix:** Trace each advisory to shipped/runtime reachability, upgrade within the correct Expo/Electron compatibility matrix, add a reviewed audit gate, and avoid forced downgrades or blanket fixes.

**Severity:** High

## 11. ARCHITECTURE / MAINTAINABILITY FINDINGS

Positive boundaries were verified: Electron uses a sandboxed preload bridge; API and Player runtimes are separated; Player application hooks are extracted; the module graph has zero cycles, boundary violations, or unresolved relative imports.

Material architecture risks:

- State ownership is duplicated across browser persistence, Electron storage/API fallback, API SQLite, and two Firebase publishers. This directly causes PERF-001, REL-002, and REL-003.
- The Vercel SQLite default cannot be a durable multi-instance authority (REL-001).
- `src/main.tsx` remains a large orchestration root and the Player root owns a one-second clock; change ownership only where it reduces measured render or failure risk.
- CI omits root TypeScript although local `npm run verify` includes it; release CI runs only tests before publication.
- Two UI primitive candidates have no incoming imports; this is evidence of an incomplete primitive strategy, not permission for broad cleanup.

### ARCH-001 — Public/legal availability is coupled to a failing API deployment

**Current:** The repository has a separate static download-site build, but Player and desktop defaults link legal/support pages on the API host. Those production routes returned 500, and no checked-in Vercel routing/rollback definition explains the deployment.

**Impact:** Database/runtime failure can remove legally required documents and support information while the reviewed static site remains undeployed.

**Fix:** Repository-side work may separate immutable public/legal assets from API runtime failure, define route/build behavior as code, and centralize the public origin behind configuration. **Deferred founder decision:** domain ownership, DNS/registrar/certificate changes, the final canonical production hostname, and production cutover require later explicit approval.

**Severity:** High

## 12. PAGE-BY-PAGE PUBLIC SITE AUDIT

| Page / route | Title | Description | Canonical | H1 | OG | Schema | Sitemap | Static | Main Problem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intended `orbitpoker.com/` / repository Home | Good in repo; none in production lander | Good in repo | No | 1 repo; 0 lander | No | No | Repo none; production lists lander | Repo yes; production JS bootstrap | Production is a parking lander |
| Repository `product.html` | Generic | Yes | No | 1 | No | No | No | Yes | Not deployed; no real product proof |
| Repository `support.html` | Generic | Thin | No | 1 | No | No | No | Yes | Not deployed |
| Repository `privacy.html` | Unique | Yes | No | 1 | No | No | No | Yes | Wrong company attribution; duplicated alias |
| Repository `terms.html` | Unique | Yes | No | 1 | No | No | No | Yes | Wrong company attribution; duplicated alias |
| Production unknown path | None | None | No | 0 | No | No | No | JS parking bootstrap | Returns 200 instead of branded 404 |
| Production `/lander` | None | None | No | 0 | No | No | Only sitemap URL | Third-party client lander | Not Orbit content |
| Production `/robots.txt` | N/A | N/A | N/A | N/A | N/A | N/A | Points to parking sitemap | Static parking asset | Allows all but governs no Orbit content |
| Production `/sitemap.xml` | N/A | N/A | N/A | N/A | N/A | N/A | Self | Static parking asset | Contains only `/lander` |
| Production `/llms.txt` | N/A | N/A | N/A | N/A | N/A | N/A | References parking sitemap | Static parking asset | Generic parking-service policy, not Orbit |
| Production `/favicon.ico` | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Empty 204 response | No usable production favicon |
| API `/privacy[.html]` | Unique in source | Yes | No | 1 | No | No | No | Static file behind API | Production 500 |
| API `/terms[.html]` | Unique in source | Yes | No | 1 | No | No | No | Static file behind API | Production 500 |
| API `/support[.html]` | Generic in source | Thin | No | 1 | No | No | No | Static file behind API | Production 500 |
| API `/health` | N/A (JSON) | N/A | N/A | N/A | N/A | N/A | Exclude | Dynamic public API | Exposes environment, DB path, and provider configuration |
| API `/legal.css`, `/orbit-logo.svg` | N/A (assets) | N/A | N/A | N/A | N/A | N/A | Exclude | Static files behind API | Availability coupled to API host |
| API `/dashboard` | Unique | Missing | No | 1 | No | No | Exclude | Static shell + private data | Auth key storage, labels; must not index |
| API `/dashboard.js`, `/dashboard.css` | N/A (authenticated assets) | N/A | N/A | N/A | N/A | N/A | Exclude | Static files behind dashboard auth | Must remain authenticated/non-indexed |
| Desktop renderer root | Orbit | Missing | No | Client-rendered | No | No | Exclude | Dynamic packaged app | Not a marketing/index page |
| Player web root | Needs deployment verification | Needs verification | Needs verification | Client-rendered | Needs verification | Needs verification | Exclude if authenticated | Dynamic Expo app | No production web URL/config evidence |

## 13. FOUNDER-FACING REFACTOR P2 REQUIREMENT MATRIX

This matrix contains only the 118 original numbered Refactor P2 product requirements: 24 public/SEO, 43 design/UX, 19 performance, and 32 security requirements. Audit instructions, examples, methodology, severity/status vocabularies, report-format rules, and approval-gate checklist items are intentionally excluded.

“Implementation Required” answers whether work remains to reach the desired P2 state; it does not authorize that work. The hard human approval gate in §22 still controls every implementation action.

### 3. Public Site / SEO / Production Quality

| ID | Requirement | Current State | Exact Evidence/Location | Desired P2 State | Implementation Required (Yes/No) | Related Finding |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1 | Hallmarks | **Founder Definition Required.** “Hallmarks” has no repository-established product meaning. | Repo-wide product/source/routes/docs search: zero `Hallmark` matches; `download-site/`; `apps/api/public/`; `src/`; `player-app/src/`. | Founder defines the term and scope first; any later content uses only implemented, evidenced Orbit capabilities. | Yes | DESIGN-011 |
| 3.2 | View source with meaningful content | The five repository public pages contain useful static HTML and no inspected secret/debug payload, but the production domain serves a 114-byte parking redirect instead. | `download-site/index.html:18-50`; `download-site/product.html:16-27`; §21 production GET evidence. | Canonical production URLs initially deliver meaningful Orbit HTML and expose no private configuration. | Yes | SEO-006, ARCH-001 |
| 3.3 | 404 page | No tracked branded 404 exists; an unknown production path returned the parking bootstrap with HTTP 200. | No 404/error document under `download-site/` or `apps/api/public/`; §21 production GET evidence. | Unknown public routes return a branded, useful 404 with a true 404 status; 5xx has a separate fallback. | Yes | SEO-003, SEO-006 |
| 3.4 | Branding | Orbit naming is consistent, but public/legal footers name Orbit Technologies LLC while the brief names Caminus Labs, LLC; the public product also makes an unsupported signing claim. The founder deferred the legal/company attribution decision. | `download-site/index.html:52`; `download-site/privacy.html:43,105,109`; `download-site/product.html:26`; matching `apps/api/public/*.html`; Stage 0 amendment. | Orbit eventually uses founder/legal-approved company attribution and only verifiable release/brand claims; attribution remains unchanged until later explicit approval. | Yes | DESIGN-004, DESIGN-014 |
| 3.5 | Unique page titles | Repository pages have unique titles, although Product/Support are generic; the production parking lander has no useful title. | `download-site/index.html:7`; `download-site/product.html:7`; `download-site/support.html:7`; `download-site/privacy.html:7`; `download-site/terms.html:7`; §12. | Every canonical public page has a unique descriptive title in deployed HTML. | Yes | SEO-006 |
| 3.6 | Meta descriptions | Repository pages have descriptions, but Support is thin and desktop/dashboard surfaces either lack descriptions or are not index targets; production is not Orbit. | `download-site/*.html` head metadata; `apps/api/public/*.html`; page table in §3 and §12. | Each indexable deployed page has a useful page-specific description; private/product-app surfaces remain excluded. | Yes | SEO-001, SEO-006 |
| 3.7 | Open Graph image | No Open Graph fields or share image are linked by any of the eight public HTML sources. | `download-site/*.html` and `apps/api/public/{privacy,terms,support}.html`: no `og:` matches. | Canonical public pages use page-appropriate OG metadata and one real Orbit-branded image that does not depict fake UI. | Yes | SEO-001 |
| 3.8 | Structured data | No JSON-LD exists; therefore no malformed or fabricated schema was found either. | `download-site/*.html` and `apps/api/public/*.html`: no `application/ld+json` matches. | Add only valid Organization/WebSite/SoftwareApplication/FAQ schema supported by visible facts and approved company identity. | Yes | SEO-001, DESIGN-004 |
| 3.9 | Exactly one principal H1 | Every inspected repository public page has one H1 with logical lower headings; the production lander has none. | `download-site/index.html:21`; `download-site/product.html:17`; `download-site/support.html:17`; `download-site/privacy.html:19`; `download-site/terms.html:19`; `apps/api/public/dashboard.html:14`; `apps/api/public/support.html:14`; `apps/api/public/privacy.html:19`; `apps/api/public/terms.html:19`. | Preserve one principal H1 and logical hierarchy on every deployed public page, including 404. | Yes | SEO-003, SEO-006 |
| 3.10 | Canonical tag | None of the eight public HTML sources declares a canonical URL. | `download-site/*.html`; `apps/api/public/{privacy,terms,support}.html`: no `rel="canonical"`; §3. | Canonical generation uses one centralized origin configuration; page paths/alias behavior may be implemented now, while the actual production hostname remains pending founder approval. | Yes | SEO-001, SEO-004 |
| 3.11 | llms.txt | Orbit has no repository `llms.txt`; production exposes a parking-provider file, not Orbit content. | Repo file inventory; production result in §12. | A concise public-only Orbit policy exists at the canonical domain if the founder chooses to support it; it exposes no private routes/data. | Yes | SEO-002, SEO-006 |
| 3.12 | Allow AI crawlers | No Orbit crawler policy is checked in; the parking service allows crawling unrelated lander content. Authenticated dashboard/data remain outside public discovery. | No `robots.txt` under `download-site/` or `apps/api/public/`; production result in §12; `apps/api/src/app.js:28`. | Robots rules intentionally permit legitimate crawlers on approved static pages and exclude authenticated/admin/API surfaces. | Yes | SEO-002, SEO-006 |
| 3.13 | Favicon | Repository pages link the real Orbit SVG logo as favicon, but production `/favicon.ico` returned an empty 204. | `download-site/index.html:8` and matching pages; `download-site/orbit-logo.svg`; §12 production favicon result. | Production serves valid canonical Orbit favicon assets and metadata on every public page. | Yes | SEO-006 |
| 3.14 | sitemap.xml | No Orbit sitemap is checked in; production lists only the parking `/lander`. | Repo file inventory; production `/sitemap.xml` result in §12. | Sitemap route membership may be implemented now; absolute URLs derive from centralized origin configuration whose production hostname remains pending. | Yes | SEO-002, SEO-006 |
| 3.15 | Language attribution | All inspected repository HTML declares English. | `download-site/*.html:2`; `apps/api/public/*.html:2` use `<html lang="en">`. | Preserve correct page language attribution on every public and error document. | No | — |
| 3.16 | Alt text | Current public imagery is the logo, marked decorative inside an `aria-label="Orbit home"` link; no product screenshots exist. | `download-site/index.html:13` and matching pages; `apps/api/public/*.html`; DESIGN-003. | Decorative images remain silent; meaningful real screenshots receive concise contextual alt text. | Yes | DESIGN-003 |
| 3.17 | Production source maps | Inspected production builds emitted no source maps; no private monitoring upload path was found. | §21 `npm run download:build`; Vite build evidence; generated outputs inspected during audit. | Public builds expose no source maps; any monitoring maps upload privately and are not served. | No | — |
| 3.18 | Clean production console | Isolated production renders recorded no page errors, but canonical production could not be tested because it serves parking content; release metadata failure is handled silently. | §21 isolated Playwright evidence; `download-site/main.js:6-38`; SEO-006. | Deployed Orbit pages have no debug output, warnings, uncaught errors, or avoidable failed requests while real failures remain visible to monitoring/users. | Yes | SEO-006, PERF-009, REL-010 |
| 3.19 | Optimized JavaScript bundle | The static public site has a 1.86 kB entry, but the web-rendered management entry is 914,989 bytes and eagerly includes Firebase. | §21 bundle measurement; `src/main.tsx:226-239`; PERF-005. | Static public routes stay minimal; dynamic application entries have measured budgets and load Firebase/heavy tools only when needed. | Yes | PERF-005, DEP-001 |
| 3.20 | Visitor counter | No public visitor/download/user counter or fabricated popularity number was found. | Public copy/script search across `download-site/` and `apps/api/public/`; `download-site/main.js` shows release metadata only. | Do not add a counter unless it has an approved source, definition, freshness policy, and privacy treatment. | No | — |
| 3.21 | Linked socials | No official company social links exist; the release CTA points to a personal GitHub repository. | `download-site/*.html` navigation/footer; `download-site/index.html:24`; SEO-005. | Add only maintained, organization-owned profiles after ownership is verified; otherwise keep socials absent. | Yes | SEO-005 |
| 3.22 | Real generated images | No generated imagery is currently used on the public site. | Public asset inventory: `download-site/orbit-logo.svg`, `download-site/orbit-icon.png`; no hero/illustration assets. | Add intentional, production-quality visual imagery where it materially improves the public experience. Generated imagery may be used only for truthful atmosphere, illustration, abstract brand artwork, or other clearly non-product visuals. It must never depict fictional Orbit UI, fictional functionality, fake customers, fake venues, fake usage, fake metrics, or otherwise masquerade as documentary/product evidence. Real Orbit functionality must be shown only through genuine captures of the functioning product. | Yes | DESIGN-003 |
| 3.23 | No fake screenshots of UI | No product screenshot, AI UI mockup, or fake dashboard is currently presented; this also leaves product claims without visual proof. | `download-site/*.html` and asset inventory; DESIGN-003. | Any public UI depiction is a current, redacted capture of the functioning application; no generated/mock UI. | Yes | DESIGN-003 |
| 3.24 | Static public site | The repository public pages are static HTML with a tiny metadata script, but they are not served at the intended production domain; legal/support is coupled to the API host. | `download-site/*.html`; `download-site/vite.config.mjs`; §12 production results; ARCH-001. | Prepare immutable static/pre-rendered marketing, legal, support, and 404 assets independently of app/API availability; production hostname assignment and cutover remain deferred. | Yes | SEO-006, ARCH-001 |

### 4. Design and UX

| ID | Requirement | Current State | Exact Evidence/Location | Desired P2 State | Implementation Required (Yes/No) | Related Finding |
| --- | --- | --- | --- | --- | --- | --- |
| 4.1 | Minimal pill-shaped buttons | Public CTAs use a six-pixel radius, but desktop CSS has 31 fully rounded declarations across actions, navigation, filters, and statuses. | `download-site/styles.css:127-142`; `src/styles/10-shared-controls.css:55,96` and repository-wide `border-radius: 999px` audit. | Pills are reserved for compact tags/statuses; ordinary actions and inputs use restrained Astryx radii. | Yes | DESIGN-008 |
| 4.2 | No reviews / testimonials | No marketing testimonial, customer quote, review component, or rating block exists. Operational uses of “review” are workflow copy, not social proof. | Public/source search; `download-site/index.html`; `download-site/product.html`; `src/main.tsx:2558` is an operational action. | Preserve the ban on testimonial/review marketing content. | No | — |
| 4.3 | No glassmorphism | Public pages avoid glass, but desktop floor and notification surfaces use backdrop blur. | `src/styles/20-floor-dashboard.css:19`; `src/styles/260-notifications.css:5`; DESIGN-005. | Product surfaces use solid/tonal layers; no frosted/translucent glass treatment. | Yes | DESIGN-005 |
| 4.4 | No fake screenshots of UI | No public product image currently exists, fake or real. | `download-site/*.html` and asset inventory; DESIGN-003. | Use only current redacted real application captures when showing functionality. | Yes | DESIGN-003 |
| 4.5 | No changing-color hero text | The static hero has fixed color and no cycling/gradient-shifting text animation. | `download-site/index.html:18-28`; `download-site/styles.css:82-125`; no hero animation script. | Preserve stable, readable hero typography. | No | — |
| 4.6 | Not every section should fade in | Public sections have no entrance framework, but multiple desktop dashboard panels apply the same `panel-rise` entrance and other surfaces use separate pulses/flicker. | `src/styles/20-floor-dashboard.css:194,262,312`; `src/styles/80-motion-responsive.css:2-31`; DESIGN-016. | Use entrance motion only where it clarifies hierarchy; never make section fade/rise the default. | Yes | DESIGN-016 |
| 4.7 | Real metrics or no metrics | Public pages contain build metadata but no users/venues/growth/uptime/performance/social-proof metrics. | `download-site/index.html:28-32`; public copy search; no counter/metric claims. | Publish only source-defined, fresh, reviewable metrics; otherwise publish none. | No | — |
| 4.8 | No bento grid layout | Public layouts use symmetric editorial/workflow grids, not asymmetric SaaS bento tiles. | `download-site/styles.css:145-193`; `download-site/index.html:34-50`; `download-site/product.html:18-24`. | Preserve a non-bento, Orbit-specific information structure. | No | — |
| 4.9 | Unique, captivating, intuitive layout | Public composition is restrained but the feature grid is generic; rendered floor layouts crowd the right rail and break names at common widths. | `download-site/styles.css:174-193`; rendered evidence in DESIGN-001–002. | Distinctive Orbit/poker-room composition preserves scanability, content priority, and responsive usability. | Yes | DESIGN-001, DESIGN-002, DESIGN-013 |
| 4.10 | Real logo dependency | Real SVG/PNG assets exist, but copies live in download/API/app surfaces and brand text is repeated; no single governed asset pipeline is evident. | `download-site/orbit-logo.svg`; `apps/api/public/orbit-logo.svg`; `src/components/AppShell.tsx:51`; `player-app/assets/{icon,adaptive-icon,splash-icon,favicon}.png`; DESIGN-015. | One approved logo source/component/export pipeline supplies all surfaces and accessibility variants. | Yes | DESIGN-015 |
| 4.11 | Moderate-frequency scroll animations | Public pages have no scroll animation; product motion is scattered across repeated entrances, pulses, flicker, notifications, seats, and TV, with a global reduced-motion override. | `src/styles/20-floor-dashboard.css:194,262,312`; `src/styles/80-motion-responsive.css:2-40`; `src/styles/140-table-system.css:141`; `src/styles/171-tournament-tv.css:303`. | Use purposeful, moderate-frequency motion only where it materially improves hierarchy/feedback; preserve reduced motion. | Yes | DESIGN-016 |
| 4.12 | No glowing borders except hover | Persistent/animated seat, live-feed, and TV glows exist outside hover. | `src/styles/140-table-system.css:89-162,234-240`; `src/styles/171-tournament-tv.css:234`. | Glow is absent by default and used only for hover/focus or genuine operational state. | Yes | DESIGN-007 |
| 4.13 | No gradient blobs | Several desktop backgrounds use decorative radial-gradient blobs. | `src/styles/121-premium-detail-compatibility.css:13-16`; `src/styles/171-tournament-tv.css:117-118`. | Remove decorative blobs and retain only restrained functional gradients. | Yes | DESIGN-006 |
| 4.14 | Smooth intentional transitions | Public pages already use solid tonal sections, while desktop compatibility surfaces rely on decorative gradients and scattered motion/easing. | `download-site/styles.css:1-12,145-205`; `src/styles/121-premium-detail-compatibility.css:13-16`; `src/styles/80-motion-responsive.css`; DESIGN-016. | Astryx defines purposeful tonal section changes and a small duration/easing scale without blobs/noise. | Yes | DESIGN-006, DESIGN-016 |
| 4.15 | No Trusted By | No “Trusted by,” “Used by,” “Loved by,” or customer-logo credibility section exists. | Public/source search across `download-site/` and `apps/api/public/`: zero marketing matches. | Preserve the prohibition unless the founder changes the requirement and supplies verified rights/evidence. | No | — |
| 4.16 | No emoji icons | No emoji code points are used as UI icons in inspected web/desktop/Player source. | Emoji-range search across `src/`, `player-app/src/`, `download-site/`, `apps/api/public/`: zero matches. | Continue using accessible vector icons rather than emoji controls. | No | — |
| 4.17 | Standard / professional icons | Desktop uses Lucide and Player uses Ionicons; quality is professional, but accessible names/state are inconsistent and two icon systems lack one governance layer. | `src/components/AppShell.tsx:4`; `player-app/src/PlayerApp.tsx:4,71`; A11Y-002. | Astryx standardizes icon size, stroke/weight, semantic use, labels, and platform-appropriate source. | Yes | DESIGN-010, A11Y-002 |
| 4.18 | No traditional corporate-slop wording | The inspected marketing hero/product copy is direct and does not use the listed vague SaaS phrases. | `download-site/index.html:19-49`; `download-site/product.html:17-26`; phrase search. | Preserve specific copy tied to actual room operations and evidenced capabilities. | No | — |
| 4.19 | Multi-page site | The repository has Home, Product, Support, Privacy, and Terms pages; production does not serve them, and FAQ/Hallmarks meaning is unresolved. | `download-site/{index,product,support,privacy,terms}.html`; §12; DESIGN-011–012. | Deploy a coherent multi-page public architecture using approved real content; Hallmarks remains out of scope until defined. | Yes | SEO-006, DESIGN-011, DESIGN-012 |
| 4.20 | No AI-generated mockups | No AI-generated Orbit UI/dashboard/app/venue-software mockup exists. | Public asset and markup search under `download-site/`; DESIGN-003. | Preserve the ban; product functionality is shown only with genuine captures. | No | — |
| 4.21 | No pricing cards | No public pricing page or SaaS pricing-card layout exists. | `download-site/*.html` and `download-site/styles.css`: no pricing section/card. | Preserve the no-pricing-card direction unless an approved factual non-card presentation is later required. | No | — |
| 4.22 | No animated grid background | No animated grid, dots, graph paper, perspective grid, or technical-line background exists. | `download-site/styles.css`; `src/styles/*.css` background/animation search. | Preserve the prohibition. | No | — |
| 4.23 | Unique customized FAQ accordion | No FAQ page, content, or accordion exists. | `download-site/` and `apps/api/public/`: no FAQ route/content; DESIGN-012. | Approved factual FAQs use an Orbit-specific, keyboard-operable disclosure with correct focus/state semantics. | Yes | DESIGN-012, A11Y-002 |
| 4.24 | Refined animation selection | Public motion is minimal and reduced motion exists, but product animation/easing is scattered and includes repeated entrance, decorative glow, flicker, and pulse. | `src/styles/80-motion-responsive.css:1-40`; `src/styles/20-floor-dashboard.css:194,262,312`; `src/styles/140-table-system.css:141-162`; DESIGN-016. | Astryx catalogs allowed purposes, durations, easing, repetition, performance, and reduced-motion alternatives. | Yes | DESIGN-007, DESIGN-016 |
| 4.25 | Specific and impactful hero copy | Current hero says “Run the room from one shared operating view” and explains audience/problem with concrete waitlist, seating, table, membership, tournament, and closeout language. | `download-site/index.html:19-22`. | Preserve or refine equally specific, repository-supported what/who/problem copy. | No | — |
| 4.26 | Poker cards for features | Product features use a conventional numbered two-column grid; no playing-card-inspired marketing system exists. | `download-site/product.html:18-24`; `download-site/styles.css:190-193`; DESIGN-013. | Marketing feature presentation uses a restrained, accessible playing-card concept without imposing it on operational UI. | Yes | DESIGN-013 |
| 4.27 | No logo carousel | No auto-scrolling logo band, customer carousel, or partner slider exists. | Public markup/CSS/script search across `download-site/`: zero matches. | Preserve the prohibition. | No | — |
| 4.28 | No noise texture overlay | No CSS/SVG/PNG grain or noise overlay exists. | Public/product asset inventory and CSS search: no noise/grain texture. | Preserve the prohibition. | No | — |
| 4.29 | Shadow only key parts of app | Shadows appear on many ordinary panels/cards as well as appropriate dialogs/overlays, so elevation is not reserved consistently. | Repository-wide `box-shadow` audit; examples `src/styles/20-floor-dashboard.css:193,259,275,308`; overlay examples `src/styles/180-app-shell.css:70,137`. | Astryx reserves elevation for overlays, selected/key surfaces, and meaningful layering; flat grouping uses border/spacing. | Yes | DESIGN-002, DESIGN-010 |
| 4.30 | No aurora background | Desktop compatibility/TV surfaces use multiradial gradient meshes resembling aurora/fog. | `src/styles/121-premium-detail-compatibility.css:13-16`; `src/styles/171-tournament-tv.css:117-118`; DESIGN-006. | Remove aurora/fog backgrounds. | Yes | DESIGN-006 |
| 4.31 | No cursive font | No cursive or script font is loaded; stacks use Bahnschrift/Aptos/Segoe/system/monospace. | `download-site/styles.css:3`; `src/styles/00-foundation.css:21`; repository font search. | Preserve the prohibition. | No | — |
| 4.32 | No “Built for the Future” content | The exact phrase and semantically similar public slogan were not found. Legal references to future features are policy language, not a hero claim. | Public phrase search; `download-site/privacy.html` and `download-site/terms.html` reviewed in context. | Keep marketing copy concrete; legal scoping remains factual and counsel-approved. | No | — |
| 4.33 | Minimal em dashes | Marketing pages do not overuse em dashes; occurrences are not an observable copy pattern. | Public copy punctuation search across `download-site/*.html`. | Preserve restrained punctuation and edit for clarity rather than applying a blanket ban. | No | — |
| 4.34 | Skeleton loaders where applicable | Player can flash onboarding before hydration; desktop lazy routes render an empty busy `<main>`; predictable reads do not consistently use layout-matched skeletons. | `src/main.tsx:237`; Player `accountLoaded` flow summarized in REL-011; async hooks in `player-app/src/application/`. | Hydration gates and skeletons hold predictable layout, with explicit loading/empty/error/retry states and announcements. | Yes | REL-011 |
| 4.35 | ui.watermelon.sh | No dependency, import, copied primitive, or repository reference was found. | All three manifests and source search: zero `watermelon` matches. | During Astryx implementation, explicitly evaluate ui.watermelon.sh against Orbit's identified component/design gaps. Adopt applicable patterns/components only where they materially improve the final system; if none are appropriate, document the evaluated candidates, why they were rejected, and the Astryx implementation used instead. Evaluation and disposition are mandatory; installation is not. | Yes | DESIGN-010 |
| 4.36 | motion-primitives.com | No dependency, import, or repository reference was found. | All manifests/source search: zero `motion-primitives` matches. | During Astryx motion implementation, explicitly evaluate Motion Primitives against Orbit's required motion system. Adopt applicable primitives where they improve performance, consistency, accessibility, or maintainability; otherwise document the evaluated candidates, why they were rejected, and the Astryx equivalent used instead. Evaluation and disposition are mandatory; installation is not. | Yes | DESIGN-010, DESIGN-016 |
| 4.37 | haikei.app | No Haikei asset/tool reference was found; current desktop nevertheless has CSS blobs/aurora that violate the same bans. | Repo search: zero `haikei` matches; `src/styles/121-premium-detail-compatibility.css:13-16`. | During visual-system implementation, explicitly evaluate Haikei for structured, non-product decorative assets that comply with P2. Do not use blob, noise, aurora, fake-UI, or prohibited gradient treatments. If no compliant output improves Orbit, document the evaluation and rejection. Evaluation and disposition are mandatory; use of a generated asset is not. | Yes | DESIGN-006, DESIGN-010 |
| 4.38 | BaseUI & ShadCN primitives | Radix-backed dialog/menu components and a small ShadCN-compatible `ui/` folder exist; most controls are raw/global and two primitives have no callers. BaseUI is absent. | `src/components/ui/*.tsx`; `src/components/AppShell.tsx:3`; root `package.json:50-56`; module-graph evidence §21. | Govern one accessible primitive strategy under Astryx and fill documented gaps without adding both systems indiscriminately. | Yes | DESIGN-010, A11Y-001, A11Y-002 |
| 4.39 | Custom fonts | No custom font files or `@font-face` exist; platform stacks use unsupported synthetic weights and can render differently. | `src/styles/00-foundation.css:21-24`; `download-site/styles.css:3`; DESIGN-009. | Founder-approved typography has licensed assets (if custom), optimized loading, supported weights, fallbacks, and no avoidable layout shift. | Yes | DESIGN-009 |
| 4.40 | Tooltips instead of text in appropriate buttons | Desktop has accessible icon-only controls and Radix Tooltip installed, but usage/policy is incomplete; consequential actions usually retain text. | `src/components/FloorView.tsx:143,160,211`; `src/components/ProfilesView.tsx:127-132`; `package.json:56`; A11Y-002. | Use icon-only plus tooltip only for familiar secondary actions, always with an accessible name; keep text where clarity/consequence requires it. | Yes | DESIGN-010, A11Y-002 |
| 4.41 | Consistent font-weight hierarchy | Nonstandard weights 650–950 appear across public, dashboard, and product CSS without one role mapping. | `download-site/styles.css:93,170,193`; `apps/api/public/dashboard.css:38,154`; multiple `src/styles/*.css`; DESIGN-009. | Astryx maps hero/heading/body/label/meta/form/button roles to a small supported set of weights. | Yes | DESIGN-009 |
| 4.42 | Professional SVGs / Lucide | Desktop uses Lucide SVGs; Player uses platform Ionicons; no emoji icons were found. Cross-surface sizing/accessibility governance is incomplete. | `src/components/*.tsx` Lucide imports; `player-app/src/**/*.tsx` Ionicons imports; A11Y-002. | Standardize professional vector icon roles/sizing/accessibility while retaining justified platform-native sets. | Yes | DESIGN-010, A11Y-002 |
| 4.43 | Astryx design system | Foundation tokens and some primitives exist, but typography, radii, elevation, motion, density, logo use, states, breakpoints, loading, and errors remain scattered. | `src/styles/00-foundation.css`; `src/styles/10-shared-controls.css`; `src/styles/80-motion-responsive.css`; `src/components/ui/`; DESIGN-005–010, DESIGN-015–016. | Astryx centrally governs every listed design-system dimension and is verified across public, desktop, dashboard, and Player surfaces. | Yes | DESIGN-005, DESIGN-006, DESIGN-007, DESIGN-008, DESIGN-009, DESIGN-010, DESIGN-015, DESIGN-016 |

### 5. Performance

| ID | Requirement | Current State | Exact Evidence/Location | Desired P2 State | Implementation Required (Yes/No) | Related Finding |
| --- | --- | --- | --- | --- | --- | --- |
| 5.1 | Compress JSON | Express has a 2 MB parser limit but no response compression; management exchanges full state and player mutations rebuild/return snapshot plus publication metadata. | `apps/api/src/app.js:17-20`; `apps/api/src/routes/client.js:116-119`; `apps/api/src/routes/player.js:57-67,94-103`; PERF-010. | Purpose-specific DTOs remove unnecessary fields and measured HTTP compression is applied at the appropriate trusted boundary. | Yes | PERF-010, SEC-003 |
| 5.2 | Optimized database writes | Each save rewrites full `state_json`, deletes every profile, and reinserts all profile `raw_json`; one desktop action can also publish three times. | `apps/api/src/db/state.js:4-30`; `src/app/persistence/managementPersistence.ts:107-117`; PERF-001/006. | Persist only changed entities transactionally, keep justified checkpoints, and perform one durable write/publication per logical mutation. | Yes | PERF-001, PERF-006, REL-002 |
| 5.3 | Do not write to DB one at a time | Firebase publication awaits individual writes for every entity and nested tournament player; profile replacement loops row-by-row inside a transaction. | `apps/api/src/firebasePublisher.js:488-617`; `apps/api/src/db/state.js:22-29`; PERF-004/006. | Batch/bulk-write within provider limits, retain required transactions/order, and paginate reconciliation. | Yes | PERF-004, PERF-006 |
| 5.4 | Remove single dependency bottlenecks | Player discovery awaits local API before Firebase; public metadata waits on GitHub; API saves wait for serial Firebase; public/legal availability depends on the failing API/domain deployment. | `player-app/src/data/firebase/clubSnapshotRepository.ts:54-73`; `download-site/main.js:6-38`; `apps/api/src/routes/client.js:116-119`; ARCH-001. | Independent capabilities degrade separately, critical writes commit durably before asynchronous publication, and static/legal pages remain available without API health. | Yes | PERF-004, PERF-009, PERF-011, ARCH-001 |
| 5.5 | Audit round-trip latency | Request sequencing was mapped, but representative production timings were not collected because safe non-production data/targets were unavailable. | §9 timelines; PERF-001–004/011; §21 notes on production boundaries. | Instrument action-to-render phases with redacted correlation and budgets on representative isolated data before/after changes. | Yes | PERF-001, PERF-002, PERF-003, PERF-004, PERF-011 |
| 5.6 | Break latency into network events | Major save, discovery, tournament, publication, and telemetry flows have explicit request timelines; auth/admin timing still needs isolated measurement. | §9 “Saving management state,” “Opening player club discovery,” “Loading player tournaments,” “Publishing a venue snapshot.” | Maintain per-flow network timelines and measurement for auth/session, dashboard, venue/player/waitlist/table/tournament/membership/admin paths. | Yes | PERF-001–004, PERF-011 |
| 5.7 | Optimistic rendering | Some membership/waitlist mutations wait for server snapshots and lack in-flight guards; payments/identity/seating require server confirmation. | `player-app/src/application/usePlayerClubs.ts`; request repos; REL-006; PERF-011. | Apply reversible optimistic state only to idempotent low-risk actions, with rollback/deduplication; keep sensitive actions authoritative. | Yes | PERF-011, REL-006 |
| 5.8 | Frontend optimistic rendering opportunities | Waitlist/membership and simple status flows can block on round trips/full snapshot replacement; repeated taps can create new IDs. | `player-app/src/application/usePlayerClubs.ts`; `player-app/src/data/playerRequests.ts`; REL-006; PERF-011. | Give immediate guarded feedback for proven low-risk candidates and avoid optimistic payment, identity, financial, and seating operations. | Yes | PERF-011, REL-006 |
| 5.9 | Statically loaded site | Repository marketing/legal pages are static, but the intended domain does not deploy them and API-hosted legal copies fail with 500. | `download-site/*.html`; §12; SEO-006; ARCH-001. | Serve canonical public/legal/support/error content statically or pre-rendered and isolate it from authenticated/API runtime failure. | Yes | SEO-006, ARCH-001 |
| 5.10 | N+1 queries | Club discovery creates four child reads plus one hosted API request per club; tournament discovery creates two child reads/listeners per club and refetches all on events. | `player-app/src/data/firebase/clubSnapshotRepository.ts:54-112`; `player-app/src/data/subscriptions/clubSnapshotSubscription.ts:88-168`; `player-app/src/data/firebase/playerTournamentRepository.ts:12-45`; PERF-002/003. | Use player-safe aggregates/scoped indexes and incremental changed-record subscriptions so work is bounded or proportional to changed data. | Yes | PERF-002, PERF-003 |
| 5.11 | Loading states | Desktop lazy routes use an empty busy main; Player can flash onboarding before hydration and several async paths swallow errors or lack retry/empty state. | `src/main.tsx:237`; `player-app/src/application/usePlayerStorage.ts:22-50`; `player-app/src/application/usePlayerLiveData.ts:90-155`; REL-007/011. | Every significant async interaction has announced loading, success, empty, and actionable error states with layout stability. | Yes | REL-007, REL-011, A11Y-001 |
| 5.12 | Cached information | Public release metadata uses `no-store` every visit; player discovery combines listeners with 30-second aggregate polling; sensitive state correctly uses no-store behavior. | `download-site/main.js:7,29`; `player-app/src/data/subscriptions/clubSnapshotSubscription.ts:35,78`; PERF-002/009. | Cache infrequently changing public metadata with bounded TTL/build manifests, deduplicate live reads, and keep confidential/auth data private/no-store. | Yes | PERF-002, PERF-009 |
| 5.13 | Optimized bundling | Route views are lazy, but Firebase stays in the 914,989-byte initial entry; QR and ExcelJS are large deferred chunks. | `src/main.tsx:226-239`; §21 bundle measurement; dependency table §10. | Keep heavy features deferred, dynamically load Firebase only when needed, remove proven duplication, and enforce measured budgets. | Yes | PERF-005, DEP-001 |
| 5.14 | Database indexing | SQLite has single-column venue/time indexes while common filter/order pairs need composite support; Firestore discovery indexes/pagination are incomplete. | `apps/api/src/db/schema.js:23-24,54-55,72-73`; query analysis §9; `player-app/firestore.indexes.json`; PERF-007. | Use representative `EXPLAIN QUERY PLAN`/Firestore query evidence to add only matching composite indexes and retire only proven-unused ones. | Yes | PERF-007 |
| 5.15 | Stateful async calls | Full-state writes lack revision conflict checks; actions allow repeat submissions; Player fetch/hydration lacks timeout, cancellation, and stale-response guards. | `apps/api/src/routes/client.js:116-119`; `player-app/src/application/usePlayerClubs.ts`; `player-app/src/application/usePlayerLiveData.ts`; REL-002/006/007. | Mutations use revisions/idempotency/in-flight locks; reads use abort, dedupe, sequence guards, and stale-state handling. | Yes | REL-002, REL-006, REL-007, SEC-012 |
| 5.16 | Retry button | Recoverable Player/public failures often fall back silently or show messages without retry; unsafe mutation retry can duplicate checkout/request/payment effects. | `download-site/main.js:6-38`; `player-app/src/application/usePlayerLiveData.ts:90-155`; `player-app/src/application/usePlayerPremium.ts`; REL-006/007. | Reads expose bounded user retry/backoff; mutations retry only with stable idempotency keys and explicit outcome reconciliation. | Yes | REL-006, REL-007, SEC-012 |
| 5.17 | Validate form fields on field completion | Validation is inconsistent: many forms validate on submit/change, while clear blur/touched behavior and accessible error association are not systematic. | `src/main.tsx:2119-2125`; forms in `src/components/SettingsView.tsx`; Player onboarding/auth; A11Y-001. | Fields validate after touch/blur at an appropriate time, retain server validation, and expose errors programmatically without noisy premature feedback. | Yes | A11Y-001, SEC-010 |
| 5.18 | Paginate database queries | Telemetry events have a cursor, but dashboard clients/venues/summaries, several Firestore collections, and Firebase cleanup are unbounded or capped to one page. | `apps/api/src/routes/client.js:65-107`; `apps/api/src/firebasePublisher.js:450-483`; `player-app/src/data/firebase/clubSnapshotRepository.ts`; PERF-007. | Every growing collection uses stable cursor pagination/bounded subscriptions; expected growth and sort/index contracts are documented. | Yes | PERF-007, PERF-004 |
| 5.19 | Asynchronous / parallel queries | Player discovery waits for local API before Firebase and some tournament reads are unnecessarily sequenced; Firebase entity writes are serial, while ordering of durable commit/marker remains necessary. | `player-app/src/data/firebase/clubSnapshotRepository.ts:54-112`; `player-app/src/data/firebase/playerTournamentRepository.ts:12-28`; `apps/api/src/firebasePublisher.js:488-617`; PERF-004/011. | Parallelize independent reads and safe batches while preserving auth, transactional, dependency, and commit-marker ordering. | Yes | PERF-004, PERF-011 |

### 6. Security

| ID | Requirement | Current State | Exact Evidence/Location | Desired P2 State | Implementation Required (Yes/No) | Related Finding |
| --- | --- | --- | --- | --- | --- | --- |
| 6.1 | Dynamic conditions | Body/query-supplied player, venue, device, role, and pilot identifiers influence ownership/authorization; several are not bound to the authenticated principal. | `apps/api/src/routes/player.js:35-103`; `apps/api/src/http/auth.js:70-96`; `apps/api/src/routes/client.js`; `src/main.tsx` active staff flow; SEC-001/002/005/015. | Derive tenant/user/role from verified identity, allowlist dynamic resource scopes, and reject cross-tenant IDs at the server boundary. | Yes | SEC-001, SEC-002, SEC-005, SEC-015 |
| 6.2 | Prune API payloads | Public club documents can include contacts, renewal/internal paths, and credential fallback; state APIs return whole state and publication metadata. | `apps/api/src/firebasePublisher.js` club projection; `apps/api/src/routes/client.js:116-119`; `apps/api/src/routes/player.js:57-67,94-103`; SEC-003/PERF-010. | Define minimal public/player/management/admin DTOs and omit PII, credentials, internal paths, roles, and backend-only metadata by default. | Yes | SEC-003, SEC-004, PERF-010 |
| 6.3 | Strict backend API rules | Prepared SQL, JSON limits, Firebase token middleware, and webhook signatures exist, but two mutation routes are optional-auth, legacy bootstrap trusts body state, and tenant binding is incomplete. | `apps/api/src/app.js:19-20`; `apps/api/src/routes/player.js:112-118`; `apps/api/src/http/auth.js`; `apps/api/src/paymentService.js`; SEC-001/002/015. | Every endpoint has explicit schema, authentication, authorization, tenant/resource binding, bounded inputs, and stable failure semantics. | Yes | SEC-001, SEC-002, SEC-007, SEC-015 |
| 6.4 | No way to point backend at internal systems | No route accepts an arbitrary remote URL/hostname for server-side fetch, so no present SSRF path was found; service destinations come from environment/config. Electron external navigation allows any HTTP(S) URL but does not make a backend fetch. | `apps/api/src/services/`; `apps/api/src/firebasePublisher.js`; `electron/orbitApiClient.cjs:120-165`; `electron/main.cjs:62-68`. | Keep server destinations allowlisted/config-only, reject user-controlled schemes/hosts/paths, and narrow Electron external-link hosts. | Yes | SEC-018 |
| 6.5 | Stored XSS | React escapes rendered text and dashboard templates call `escapeHtml`; no unsafe persisted rich-text renderer was found. Validation/minimization remains inconsistent for stored fields. | `apps/api/public/dashboard.js:48-68,91-183`; React render paths in `src/components/` and `player-app/src/`; SEC-013. | Preserve contextual escaping, prohibit raw HTML by default, validate/normalize stored text at boundaries, and add regression tests for high-risk fields. | Yes | SEC-013 |
| 6.6 | Configured CORS policy | Express applies unrestricted `cors()` globally with no route-specific origins/credentials policy. | `apps/api/src/app.js:17`; SEC-007. | Explicit allowed origins, methods, headers, and credential behavior apply per public/authenticated route and environment. | Yes | SEC-007 |
| 6.7 | Password reset links | Desktop management calls Firebase password reset; Player exposes no reset/recovery flow for email/phone-mapped accounts. | `src/lib/firebaseClubSync.ts:185`; `src/main.tsx:2195-2202`; `player-app/src/data/firebase/playerAuth.ts`; SEC-010. | Every password identity has a secure, usable recovery flow; phone identity uses verified phone auth rather than synthetic email. | Yes | SEC-010 |
| 6.8 | Expiring password reset links | Firebase-managed desktop reset links are used, but provider expiry/reuse/logging/enumeration settings were not established from repository evidence; Player recovery is absent. | `src/lib/firebaseClubSync.ts:185`; Firebase console/provider settings unavailable; SEC-010. | Provider-enforced strong single-use expiry, generic responses, no token logging, and tested completion/reuse behavior cover every supported identity. | Yes | SEC-010 |
| 6.9 | Graceful error handling | Some boundaries use stable messages, but API global and Stripe handlers return raw exception messages; Player promise failures are sometimes swallowed. | `apps/api/src/http/middleware.js:11-20`; `apps/api/src/paymentService.js:138`; `player-app/src/application/usePlayerLiveData.ts:90-155`; SEC-014/REL-007. | Typed errors map to safe user messages/statuses; redacted detail goes to correlated logging; every failure has a deliberate UI state. | Yes | SEC-014, REL-007, REL-010 |
| 6.10 | Different error pages for different error types | No dedicated Orbit 404/5xx page exists, and application/API error handling does not consistently distinguish 401/403/404/429/500/network/unavailable states. | §12; `apps/api/src/http/middleware.js:20`; `player-app/src/data/api/playerHttpApi.ts`; SEO-003/SEC-014. | Public and product surfaces present materially distinct recovery for auth, permission, not-found, throttled, server, network, and unavailable cases. | Yes | SEO-003, SEC-014, REL-007 |
| 6.11 | Form fields cannot run malicious code | React/dashboard escaping and prepared SQLite queries reduce XSS/SQL injection, but broad payloads, inconsistent schemas, and unbounded local file parsing leave malformed/oversized input gaps. | `apps/api/public/dashboard.js:48-68`; `apps/api/src/db/*.js`; `apps/api/src/app.js:20`; `src/main.tsx:1784-1791,1916`; SEC-019. | Shared boundary schemas enforce type/length/format; prepared operations and contextual escaping remain mandatory; files/URLs/paths are allowlisted and bounded. | Yes | SEC-007, SEC-019 |
| 6.12 | Implement alerts | Console/file/SQLite telemetry exists, but no owned actionable alert integration for error spikes, abuse, auth failures, deployments, exceptions, or degradation is configured in repo evidence. | `apps/api/src/http/middleware.js:11-18`; `electron/main.cjs:49`; REL-010. | Redacted structured signals feed owned thresholds, deployment/auth/availability alerts, escalation, and runbooks. | Yes | REL-010, SEC-013 |
| 6.13 | Blue-green rollbacks | Release publishing runs on every main push, tests only, unsigned; Vercel route/traffic/rollback configuration and migration compatibility are not defined in repository evidence. | `.github/workflows/release.yml:6,20,54-57`; `package.json:122`; no `vercel.json`; REL-005. | Founder-approved immutable environments, gated traffic promotion/canary, rapid rollback, signed desktop channel, and backward-compatible migration policy are rehearsed. | Yes | REL-005, ARCH-001, Stage 0 |
| 6.14 | User token cap safeguard | No LLM/model-call/AI endpoint exists, so no present token-cost exposure was found. The required input/output/per-user/cost/context guard infrastructure also does not exist. | All manifests and product/API source: no LLM SDK/model-call path; only legal references to possible AI features. | Before any AI feature ships, server-side model policy enforces input/output/context limits, per-user quotas, cost ceilings, abuse controls, and telemetry. | Yes | Future safeguard; no current finding |
| 6.15 | Token streaming | No active model-response path exists, so no current non-streaming AI weakness exists. Safe authenticated streaming, cancellation, backpressure, partial-error, and quota accounting are also absent. | All manifests and source: no model/AI streaming implementation; SSE at `apps/api/src/http/liveUpdates.js` is dashboard events, not AI. | Any future model response streams through an authenticated bounded server path with cancellation, backpressure, safe framing, moderation/error handling, and usage accounting. | Yes | Future safeguard; no current finding |
| 6.16 | Sanitize and escape inputted user data | Rendering escaping/prepared SQL are strengths, but validation, normalization, sanitization, and output escaping are not consistently separated across text/email/IDs/URLs/files. | `apps/api/public/dashboard.js:48-68`; `src/domain/profileImport.ts`; `apps/api/src/routes/player.js`; `apps/api/src/db/*.js`; SEC-013/019. | Shared schemas normalize/validate by data type; sanitization is purposeful; output is escaped for its context; no blanket destructive sanitizer. | Yes | SEC-013, SEC-019 |
| 6.17 | Check file type | There is no remote upload endpoint, so no current remote upload-type bypass exists. Local JSON/key/CSV/XLSX imports rely on picker `accept` plus parsing, not authoritative MIME/signature checks. | `src/components/SettingsView.tsx:107-108,262-263`; `src/components/ProfilesView.tsx:558-559`; `src/main.tsx:1784-1791,1916`; SEC-019. | Current local imports validate magic/structure and allowed content before use; any future upload validates server-side MIME/signature independent of extension. | Yes | SEC-019 |
| 6.18 | Check file size | No remote upload endpoint exists, so no current server upload-size exposure exists. Local imports read whole text/array buffers without pre-read byte limits. | `src/main.tsx:1784,1791,1916,2314,2388`; SEC-019. | Enforce small per-flow client limits before reading and authoritative server limits before accepting any future upload. | Yes | SEC-019 |
| 6.19 | Store files somewhere code cannot execute | No server upload/storage/serving flow exists, so no current executable-upload vulnerability was found. The future non-executable storage safeguard is not implemented. | API route/dependency inventory: no multipart/upload handler; local imports in `src/components/SettingsView.tsx` and `src/components/ProfilesView.tsx`; SEC-019. | Before uploads exist, use private non-executable object storage/quarantine, generated names, access control, safe content disposition, scanning, and no direct code execution. | Yes | Future safeguard; SEC-019 |
| 6.20 | OTP / email verification | Phone login maps digits to deterministic email/password, email verification is not required, and no SMS OTP proves phone ownership. | `player-app/src/data/firebase/playerAuth.ts:27-50`; SEC-010. | Phone uses verified OTP/provider ownership; email identities require appropriate verification; protected actions reauthenticate/step up. | Yes | SEC-010 |
| 6.21 | Rate limiting | No server rate limiter, per-identity quota, SSE connection cap, or endpoint-specific abuse control exists; client debounce is not treated as protection. | `apps/api/src/app.js:17-30`; package manifests; `apps/api/src/http/liveUpdates.js`; SEC-007/REL-009. | Trusted-proxy-aware limits/quotas cover auth, reset, verification, mutation, webhook, streaming, upload, search, invitation, and future AI endpoints. | Yes | SEC-007, REL-009 |
| 6.22 | Error boundaries | Desktop and Player roots have no React error boundary/componentDidCatch; a render exception can blank a major surface. | `src/main.tsx`; `player-app/src/PlayerApp.tsx`; repo search for `ErrorBoundary`/`componentDidCatch`; REL-004. | Root and route/feature boundaries preserve navigation, emit a redacted incident ID, and offer safe reload/retry. | Yes | REL-004 |
| 6.23 | Form validation | Client checks and prepared server operations exist, but schemas and field rules are duplicated/inconsistent and body-supplied identities can bypass intended trust. | `src/main.tsx:2119-2125`; `player-app/src/data/firebase/playerAuth.ts:27-50`; `apps/api/src/routes/player.js:35-103`; SEC-001/010. | Shared or contract-aligned schemas enforce client UX and authoritative server validation with tenant/auth binding and consistent errors. | Yes | SEC-001, SEC-010, SEC-019 |
| 6.24 | Error logging through Vercel | API logs JSON to console and Electron/SQLite telemetry exists, but Vercel retention, correlation, traceability, redaction, and alerts were not verifiable from the repo. | `apps/api/src/http/middleware.js:11-18`; `apps/api/src/http/domainEvents.js`; REL-010/SEC-013. | Vercel/platform logs are structured, correlated, redacted, access/retention controlled, traceable, and connected to actionable alerts. | Yes | REL-010, SEC-013 |
| 6.25 | API authentication | Many client/owner/payment routes authenticate, but membership/waitlist mutations allow anonymous optional Firebase identity and loopback bypass depends on `NODE_ENV`. | `apps/api/src/routes/player.js:112-118`; `apps/api/src/http/auth.js:70-96,147-153`; SEC-001/008. | Every nonpublic endpoint requires verified, audience-appropriate identity with no environment-accidental bypass. | Yes | SEC-001, SEC-008 |
| 6.26 | API key permissions | `ORBIT_CLIENT_API_KEY` can span client, owner, and dashboard access; dashboard stores it in localStorage and sends it in an SSE query; no scoped rotation record exists. | `apps/api/src/http/auth.js:6-61`; `apps/api/public/dashboard.js:2,254,279`; SEC-006/016. | Keys/tokens are tenant-, audience-, capability-, expiry-, and rotation-scoped; dashboard uses a short-lived server session. | Yes | SEC-006, SEC-016 |
| 6.27 | One user can only see their information | Public club/notification rules expose cross-user data; anonymous mutation routes trust supplied player IDs; telemetry venue IDs are not bound to pilot tenant. | `player-app/firestore.rules`; `apps/api/src/routes/player.js:35-103`; `apps/api/src/routes/client.js`; SEC-001/003/004/015. | Server/rules derive user/tenant scope from auth and reject User A/tenant A access to User B/tenant B resources across every store. | Yes | SEC-001, SEC-003, SEC-004, SEC-015 |
| 6.28 | Do not store session token in localStorage | Dashboard persists a master API key in localStorage; management browser persistence stores full state and a long-lived stay-signed-in marker. Firebase SDK token persistence details were not explicitly configured in repository evidence. | `apps/api/public/dashboard.js:2,279`; `src/app/persistence/browserStateRepository.ts`; `src/main.tsx:662-675`; SEC-006/009. | Browser sessions use short-lived HttpOnly/Secure/SameSite cookies or equivalent protected transport; restricted state/tokens stay out of localStorage. | Yes | SEC-006, SEC-009, Stage 0 |
| 6.29 | Server-side admin checks only | Staff role selection and closeout privilege rely on renderer state without verifying the stored PIN; one shared API key also grants owner/dashboard privilege. | `src/main.tsx` active staff selection; `src/application/management/closeoutCommands.ts`; `apps/api/src/http/auth.js:30-61`; SEC-005/016. | Every privileged command is independently authorized at a trusted server/main-process boundary; client role checks remain UX only. | Yes | SEC-005, SEC-016, SEC-018 |
| 6.30 | Password rules | Management requires at least eight characters and blocks a small weak list during recovery; Player accepts six characters and synthetic phone-email password accounts. | `src/main.tsx:2119-2125`; `src/lib/accountRecovery.ts:13-42`; `player-app/src/data/firebase/playerAuth.ts:27-50`; SEC-010. | Provider-aligned minimums favor length/passphrases, reject known weak credentials without arbitrary complexity, and provide clear recovery/UX. | Yes | SEC-010 |
| 6.31 | SameSite=Lax for session cookies | Orbit currently has no application session-cookie architecture, so no misconfigured session cookie was found. The proposed dashboard/session safeguard therefore does not yet have HttpOnly/Secure/SameSite controls. | API/source search: no session cookie setter; dashboard key transport at `apps/api/public/dashboard.js:2,254,279`; SEC-006. | Founder-approved browser sessions use HttpOnly, Secure, SameSite=Lax by default, with any exception threat-modeled and CSRF-protected. | Yes | SEC-006, Stage 0 |
| 6.32 | Data classification | The audit classifies Restricted, Confidential, Internal, and Public Orbit data, but current storage/publication/logging violates parts of that model. | §6.32 classification table; SEC-003/004/006/009/013/017. | Classification drives collection, storage, encryption, access, projection, logging, retention/deletion, backup, and incident controls. | Yes | SEC-003, SEC-004, SEC-006, SEC-009, SEC-013, SEC-017 |
## 14. FINDING FORMAT

All findings use the requested negative-first fields. Security uses Current/Risk/Fix/Severity/Affected; performance uses Current/Impact/Fix/Expected benefit/Priority; design uses Current/Problem/Direction/Priority. Reliability, accessibility, architecture, and dependency findings use the closest applicable form.

## 15. SEVERITY STANDARD

- **Critical:** realistic unauthorized access, serious exposure, destructive corruption, or major outage.
- **High:** substantial security, reliability, performance, or scaling impact.
- **Medium:** important Refactor P2 weakness.
- **Low:** smaller required inconsistency or optimization.

Ratings were not raised merely because a topic is security-related.

## 16. NEGATIVES-FIRST RECONCILIATION

Each substantive finding states the current behavior, concrete harm, scaling consequence where applicable, and a bounded implementable correction. Satisfied matrix rows state inspected evidence and a preservation direction.

## 16.1 IMPLEMENTATION COMPLETENESS RULE

Once the founder explicitly approves implementation, every Refactor P2 requirement marked **Implementation Required: Yes** becomes mandatory implementation scope.

A requirement may not be:

- skipped
- deferred by the agent
- downgraded to a recommendation
- marked not applicable
- left as a TODO
- satisfied only through documentation
- omitted because implementation is difficult
- omitted because a larger refactor is required

unless it falls inside one of the founder-explicitly deferred scopes:

1. legal/company attribution, or
2. production-domain ownership/cutover.

Technical difficulty, architectural scope, dependency changes, migration work, test failures, or implementation size are not blockers. Perform the engineering necessary to satisfy the requirement safely.

Requirements currently marked **Implementation Required: No** are preservation requirements. Their satisfied state must remain true after implementation and must be re-verified before completion.

For tool/resource requirements such as:

- ui.watermelon.sh
- motion-primitives.com
- haikei.app

"implementation" means the required evaluation and explicit disposition must occur. A tool does not need to be installed when evaluation shows that doing so would worsen Orbit or duplicate Astryx functionality. The final implementation record must state what was evaluated, what was adopted or rejected, and why.

A requirement is complete only when:

1. the implementation exists,
2. it is actually integrated/used,
3. appropriate tests exist,
4. production-mode behavior is verified where applicable,
5. the requirement matrix is updated with implementation evidence,
6. the original desired P2 state is satisfied.

Do not count unused helpers, unused components, placeholder configuration, mock behavior, TODOs, or documentation-only stubs as implementation.

## 17. PROPOSED IMPLEMENTATION ORDER

No stage has begun.

### Stage 0 — Architecture Decisions

The founder amended Stage 0 on 2026-08-11. The four engineering architecture directions below are settled prerequisites; this settles direction, not implementation authorization. Legal/company attribution and production-domain ownership/cutover are explicitly deferred and do not block engineering work after the audit receives separate implementation approval.

| Decision | Current repository evidence | Founder disposition | Related findings |
| --- | --- | --- | --- |
| Authoritative datastore | Browser persistence can be treated as local authority (`src/app/persistence/managementPersistence.ts:107-116`); Electron also stores SQLite (`electron/localStore.cjs:217-293`); the API stores SQLite, defaulting to Vercel `/tmp` (`apps/api/src/db/connection.js:9`); Firebase holds published state. | **Engineering direction settled:** a durable server-owned database is authoritative; Electron/local persistence is offline/cache only; Firebase is a realtime projection. Use explicit revisions and conflict semantics, with a characterized migration from existing copies. | REL-001, REL-002, REL-003, PERF-006 |
| Authoritative state publisher | Renderer, Electron, and API can each publish Firebase state (`src/app/persistence/managementPersistence.ts:112-116`, `electron/main.cjs:213-220`, `apps/api/src/firebasePublisher.js:488-617`). | **Engineering direction settled:** the backend/API is the sole authoritative Firebase publisher. One mutation produces one durable commit, one revision, and one retryable publication path while preserving sync protocol v2 commit-marker ordering. | PERF-001, PERF-004, REL-003 |
| Auth/session architecture | Orbit mixes Firebase Player identity, local management passwords/stay-signed-in markers, pilot credentials, and one broad API/dashboard key stored in browser storage. | **Engineering direction settled:** Firebase Auth owns player identity; trusted server/main-process boundaries authorize tenant/role privilege; browser master credentials leave LocalStorage; applicable browser sessions use secure cookies; machine credentials are scoped/rotatable; staff privilege and player identity/recovery are verified. | SEC-001, SEC-002, SEC-005, SEC-006, SEC-008–010, SEC-016 |
| Production deployment and rollback architecture | Vercel routing/traffic/rollback configuration is not checked in; every `main` push can publish an unsigned desktop release after tests only (`.github/workflows/release.yml:6,20,54-57`; `package.json:122`). | **Engineering direction settled:** push-to-`main` is not a production release. Require full verification, immutable artifacts, signed desktop releases, explicit promotion, rollback capability, and backward-compatible database changes. | REL-005, REL-010, ARCH-001, SEO-006 |
| Legal/company attribution | The founder brief names Caminus Labs, LLC; public/legal pages name Orbit Technologies LLC (`download-site/index.html:52`; `download-site/privacy.html:43,105,109`; `apps/api/public/privacy.html:43,105,109`; `apps/api/public/terms.html:50,129,132`; `apps/api/public/support.html:23`). | **Deferred; non-blocking for engineering.** Preserve DESIGN-004 and current attribution. Do not change legal entity/controller attribution, “Developed by” wording, copyright/legal contacts, or related public/legal copy without later explicit approval. | DESIGN-004 |
| Production domain ownership and cutover | `orbitpoker.com` served a GoDaddy parking lander during the audit; configured `orbitapp-one.vercel.app` legal/support URLs returned 500, and repository evidence does not identify DNS/registrar/hosting owners. | **Deferred; non-blocking for engineering.** Repository-side SEO/public work may proceed using centralized origin configuration with the production value pending. Do not change DNS, registrar settings, certificates, canonical production hostname, production client links, or perform cutover without later explicit approval. | SEO-006, ARCH-001, REL-010 |

**Stage 0 gate:** the four engineering directions are settled. Stage 1+ still requires the founder to confirm that they read this audit and explicitly approve implementation. This amendment is not that approval. The two deferred founder decisions do not block engineering implementation, but their prohibited legal/domain actions remain out of scope until separately approved.

### Stage 1 — Immediate Critical Security Containment

SEC-001, SEC-002, SEC-003, SEC-004, SEC-012.

Primary objectives:

- close anonymous player mutation paths
- disable/replace insecure legacy bootstrap behavior
- remove credentials/private data from public Firestore projections
- restrict targeted notifications
- make payment webhook effects idempotent and ordered

Do not perform unrelated architectural redesign during this stage unless required to close one of these vulnerabilities safely.

### Stage 2 — Authoritative State Architecture

REL-001, REL-002, REL-003, PERF-001, PERF-004, PERF-006 and directly dependent portions of ARCH-001.

Implement the settled Stage 0 architecture:

- one durable server-owned authoritative datastore
- Electron/local persistence becomes offline/cache state rather than independent authority
- Firebase becomes a realtime/player-facing projection
- backend/API becomes the sole authoritative Firebase publisher
- one logical mutation produces one durable commit
- one logical mutation receives one authoritative revision
- one logical mutation creates one retryable publication path
- use explicit revision/conflict semantics
- introduce the durable/retryable publication mechanism required to prevent a successful database mutation from depending on immediate Firebase availability
- preserve sync protocol v2 commit-marker correctness
- characterize and safely migrate existing state copies
- eliminate renderer/Electron duplicate authoritative publication
- distinguish durable-local/server commit from cloud publication state

Architectural invariant after this stage:

**One logical mutation → one authoritative durable commit → one revision → one publication path.**

Do not permit renderer, Electron, API, SQLite, and Firebase to independently act as competing authorities.

### Stage 3 — Authentication, Authorization, Sessions, and Data Isolation

SEC-005–011, SEC-015–019 and remaining applicable requirements 6.1–6.8, 6.16–6.21, 6.23, 6.25–6.32.

Implement the settled Stage 0 authentication/session direction:

- Firebase Auth owns player identity
- server/main-process boundaries own authorization
- tenant/resource identity is derived from verified authentication rather than caller-controlled fields
- privileged staff actions require actual verification
- browser master credentials leave LocalStorage
- applicable browser sessions use HttpOnly + Secure + SameSite=Lax
- machine credentials become scoped and rotatable
- player phone/email ownership becomes verifiable
- recovery flows are implemented
- rate limiting and abuse controls are enforced server-side
- cross-user and cross-tenant isolation is tested adversarially

### Stage 4 — Reliability, Performance, Network, and Database Efficiency

REL-004, REL-006–012, PERF-002, PERF-003, PERF-005, PERF-007–011, remaining ARCH-001 engineering work, and remaining performance requirements 5.1–5.19.

This stage should build on the authoritative state architecture rather than optimizing the architecture being replaced.

Implement:

- error boundaries
- loading/error/empty/retry states
- in-flight guards
- stale-request protection
- request cancellation/deduplication
- optimistic rendering where safe
- N+1 removal
- bounded discovery
- pagination
- query-aligned indexes
- caching
- parallel independent queries
- payload pruning/compression
- bundle optimization
- latency instrumentation
- SSE recovery/capacity controls
- platform-independent green verification
### Stage 5 — Public Architecture, Static Rendering, and SEO

SEO-001–006, ARCH-001; requirements 3.1–3.24 and 5.9. This stage may implement repository-side static architecture, page paths, metadata, schema, sitemap/robots/llms content, tests, and centralized origin configuration. It may not set/change the final production hostname, production client links, DNS, registrar, certificates, or perform cutover.

### Stage 6 — Astryx Design System

DESIGN-001–002, DESIGN-005–010, DESIGN-015–016, A11Y-001–002; requirements 4.1, 4.3, 4.6, 4.9–4.14, 4.17, 4.24, 4.29–4.43, and all accessibility scopes.

### Stage 7 — Public Website Redesign

DESIGN-003, DESIGN-011–014, SEO-001–005; requirements 4.2, 4.4–4.8, 4.15–4.23, 4.25–4.28, 4.31–4.33. DESIGN-004 is preserved but deferred outside this stage; DESIGN-011 remains blocked until the founder defines Hallmarks.

### Stage 8 — Production Hardening and Verification

REL-005, REL-008, REL-010, REL-012, DESIGN-014, DEP-001; requirements 3.17–3.19, 6.12–6.13, 6.21, 6.24; full security, performance, accessibility, configured-origin behavior, rollback, and release verification. Production-domain verification/cutover remains deferred.

## 18. EXPECTED END STATE

- **Security:** every protected route has verified identity, scoped authorization, bounded validation, rate limits, and safe errors.
- **Authorization:** staff/admin/client credentials are server-verified, scoped, rotatable, and not browser-persisted master keys.
- **Data isolation:** user and tenant ownership is derived from auth; public projections contain only deliberate public fields.
- **Speed:** startup/route bundles are smaller; independent reads run in parallel; low-risk UI feedback is immediate and reversible.
- **Network usage:** one publisher owns a mutation; listeners, polling, refetches, and responses are deduplicated and bounded.
- **Database efficiency:** durable multi-instance storage, revisions/mutation IDs, batches, pagination, and query-aligned indexes.
- **Loading behavior:** hydration gates and skeletons prevent blank/wrong-screen flashes.
- **Error recovery:** root/route boundaries, differentiated errors, safe retries, and idempotent mutation recovery.
- **Public-site structure:** immutable Home/Product/Support/Privacy/Terms/FAQ/404 pages prepared behind centralized origin configuration; final production hostname/cutover is pending, and any Hallmarks surface waits for founder definition and approval.
- **SEO:** unique metadata, configurable canonicals, real OG asset, valid schema, sitemap, robots, and public-only llms.txt, with the production origin value pending founder approval.
- **Brand identity:** Orbit uses one logo pipeline; existing legal/company attribution remains unchanged until the deferred founder/legal decision is explicitly approved.
- **Design consistency:** Astryx governs type, spacing, surfaces, motion, controls, icons, states, and density.
- **Accessibility:** labelled forms, exposed state, keyboard/focus/dialog behavior, verified contrast, reduced motion, and mobile assistive-tech coverage.
- **Deployment safety:** signed gated releases, immutable public/API deployment, rehearsed rollback, and migration compatibility.
- **Observability:** redacted structured events, correlation, service/error/auth/deployment alerts, owners, and runbooks.
- **Maintainability:** one state/publish owner per mutation, explicit runtime boundaries, green platform-independent gates.

## 19. HUMAN READABILITY

Raw logs, secrets, database contents, lockfiles, and large profiler output are intentionally excluded. Evidence is summarized below and findings link behavior to founder impact.

## 20. REPORT QUALITY CHECK

- Problem, consequence, and planned correction are explicit in every finding.
- Duplicate background is consolidated in tables and timelines.
- Unverified or founder-dependent facts are stated explicitly instead of being invented.
- No fake timing, claim, screenshot, metric, customer, rating, or pricing was introduced.
- Severity follows the prompt standard.
- Vague “consider improving” language was replaced with observed behavior and bounded direction.
- The report was reconciled against the supplied prompt.
- Findings come from inspected source, builds, tests, renders, public responses, and dependency output.
- No implementation was performed.

## 21. COMPLETENESS RECONCILIATION

- Original numbered Refactor P2 product requirements in the founder-facing matrix: **118/118**.
- Public requirements: 24/24; design: 43/43; performance: 19/19; security: 32/32.
- Reliability: 14/14 scopes; accessibility: 15/15; dependency concerns: 8/8.
- Every matrix row states the observed current condition, exact evidence/location, desired P2 state, whether implementation remains, and a related finding or explicit future-safeguard disposition.
- Audit instructions, examples, methodology, severity/status labels, formatting rules, and approval-gate checklist fragments are excluded from the product matrix.
- “Hallmarks” is **Founder Definition Required**; no meaning, page scope, or claim was invented.
- Current absence of an LLM, remote upload, or session-cookie surface is recorded separately from the still-unimplemented future safeguards in requirements 6.14, 6.15, 6.19, and 6.31.
- The 2026-08-11 founder amendment settles four engineering directions: durable server-owned database authority, backend-only Firebase publication, Firebase Player identity plus trusted privilege/session boundaries, and gated immutable signed releases with rollback/backward-compatible data changes.
- DESIGN-004 and the domain-ownership/cutover portions of SEO-006/ARCH-001 remain preserved as deferred, non-blocking founder decisions. Repository-side SEO may proceed after implementation approval, but its production origin value remains pending.
- External owner evidence is still needed for Vercel logs/rollback/traffic config, Firebase provider/key restrictions, verified socials, custom-font licensing, and representative non-production load timings.
- Audit actions changed only this report.

### Evidence appendix

| Evidence | Result |
| --- | --- |
| `git status --short --branch` | Branch `audit/refactor-p2-phase-1`; only this report untracked. |
| `npm run audit:module-graph` | 170 files, 521 relative edges, 0 cycles, 0 violations, 0 unresolved; 2 candidate zero-incoming UI files. |
| `npm run measure:renderer-bundle` | 914,989-byte default entry (281,186 gzip); isolated sync-disabled build entry 911.03 kB (280.26 gzip). |
| `npm run download:build` | Pass; five static HTML pages, 1.86 kB JS entry, no source maps. |
| Isolated Playwright public render | Home desktop/mobile, Product, Support render; one H1 each; no canonical/OG/schema; external release request is a failure dependency. |
| Isolated Playwright desktop render | 8 route/viewport captures pass with no page errors; visual wrapping/hierarchy evidence confirmed. |
| Manual management smoke | Fails after 10 seconds because `.start-table-panel` remains hidden; harness is outside CI. |
| `npm audit --omit=dev` | Root 4 high; API 0; Player 16 high. No fix/install/change. |
| Direct dependency license metadata | All installed direct packages declare common permissive licenses; no custom font is shipped. |
| Initial audit `npm run verify` | Root TypeScript pass; Player TypeScript pass; build pass; tests 469 pass/2 fail in OneDrive-sensitive characterization discovery. |
| Focused failing test | Reproduces the same 2 failures. |
| Revision `npm run verify` | Root TypeScript pass; Player TypeScript pass; build pass; tests 468 pass/3 fail—the same 2 OneDrive-sensitive failures plus a 5-second API compiler-boundary timeout. |
| Focused API compiler rerun | Pass: 1 file, 6/6 tests; the timeout did not reproduce. |
| Stage 0 amendment `npm run verify` | Root TypeScript pass; Player TypeScript pass; build pass; tests 468 pass/3 fail—the same 2 OneDrive-sensitive lifecycle-discovery failures plus the 5-second API compiler-boundary timeout. No executable file changed. |
| Public production GETs | `orbitpoker.com` paths serve parking bootstrap/lander; intended Vercel legal/support paths return 500. |
| Founder Stage 0 amendment (2026-08-11) | Four engineering directions settled; legal/company attribution and production-domain ownership/cutover deferred as non-blocking decisions with explicit prohibited actions. This was not implementation approval. |
| Sensitive artifacts | Only ignored path categories were checked; contents were not read. Tracked SQLite was not opened. |

Key evidence paths: `apps/api/src/http/auth.js`, `apps/api/src/routes/*.js`, `apps/api/src/firebasePublisher.js`, `apps/api/src/paymentService.js`, `apps/api/src/db/*.js`, `player-app/firestore.rules`, `player-app/src/application/*.ts`, `src/app/persistence/*.ts`, `electron/main.cjs`, `electron/preload.cjs`, `.github/workflows/*.yml`, and `download-site/*`.

## 22. HARD HUMAN APPROVAL GATE

This report is the before-state record. Stage 1 and all later stages are proposals only.

The 2026-08-11 Stage 0 amendment settles four engineering architecture directions but is **not** approval to implement them. Do not implement, fix Critical issues, install/remove dependencies, change code/tests/configuration/routes/databases, deploy, publish, or begin design/performance/security work until the founder explicitly confirms that they read and approve this audit for implementation. “Continue auditing,” “expand,” “recheck,” “revise the report,” or another Stage 0 amendment is not implementation approval.

After that audit approval, Stage 1+ engineering and repository-side SEO/public-site work may proceed only within the four settled engineering directions. Even then, do not change legal entity/controller attribution, “Developed by” wording, DNS, registrar settings, certificates, the canonical production hostname, production client links, or perform production-domain cutover without later explicit approval for that deferred scope.

## 23. IMPLEMENTATION LEDGER

**Implementation authorization:** The founder approved this audit for repository-side implementation on 2026-08-11 through the attached “Orbit Refactor P2 — Execution Phase” directive. The before-state findings above remain unchanged. This ledger records implementation separately and does not authorize the deferred legal/domain scope or define Hallmarks.

### Stage 1 — Immediate Critical Security Containment

**Status:** COMPLETED

| Finding | Implementation evidence | Verification |
| --- | --- | --- |
| SEC-001 | Player membership and waitlist API mutations now require a verified Firebase token and verified-age middleware. `apps/api/src/playerRequestSecurity.js` rejects cross-user IDs/emails and derives identity from verified claims; remote/local Player transports require a signed-in Firebase user and send the token. | `apps/api/src/playerRequestSecurity.test.js`; anonymous route test in `apps/api/src/server.routes.test.js`; Player boundary tests. |
| SEC-002 | Self-asserted body-state pilot bootstrap and the legacy unknown-key path were removed. Unknown format-valid codes fail closed. New licenses can be provisioned only through authenticated `POST /dashboard/licenses`, which verifies the complete P-256-signed envelope before storing a one-way code identifier. | `apps/api/src/http/auth.security.test.js`; signed/forged envelope coverage in `apps/api/src/licenseService.test.js`. |
| SEC-003 | `buildCanonicalClubDoc` is now a strict public allowlist. It omits authorization/license identifiers, account/contact names, email, phone, renewal/tier data, internal snapshot paths, and last-session operational detail while retaining player-facing club facts. | Adversarial projection assertions in `apps/api/src/firebasePublisher.test.js`. |
| SEC-004 | Only notifications with explicit recipient IDs are published; target names are removed. Firestore notification reads require an authenticated recipient/admin, public announcements have a separate collection, and Player reads/listeners use `array-contains` recipient queries. | Publisher tests, `player-app/src/data/firestoreSecurityContracts.test.ts`, and `player-app/src/data/orbitSyncApi.boundary.test.ts`. |
| SEC-012 | Stripe fulfillment now transactionally claims the provider event and checkout session before wallet/membership effects. RevenueCat records event claims and rejects duplicate or non-newer entitlement events before updating Player premium state. | Repeated-event, duplicate-session, and stale-event tests in `apps/api/src/paymentService.test.js`. |

Stage verification on 2026-08-11:

- Focused security/API/Player gate: **8 files, 58 tests passed**.
- API check-JS: **passed**.
- Player strict TypeScript: **passed**.
- Root aggregate TypeScript: **passed** across renderer, tests, Electron, and API.
- Full Vitest discovery: **482 passed, 2 failed**. Both failures are the already-audited OneDrive `Dirent.isFile()` discovery defect in `src/lib/playerApplicationOrchestration.test.ts` (REL-012); no Stage 1 test failed. REL-012 remains mandatory Stage 4 work and the final gate is not considered green.
- Desktop renderer production build: **passed**, 1,957 modules. The audited ExcelJS `eval` and large-chunk warnings remain for later P2 stages.
- The API has no build step. A native Player build was not invoked because repository scripts use remote EAS workflows; local Player TypeScript and boundary behavior were verified.
- No production Firebase, payment provider, identity provider, license store, database, deployment, or secret was accessed.

### Stage 2 - Authoritative State Architecture

**Status:** COMPLETED

| Finding / requirement | Implementation evidence | Verification |
| --- | --- | --- |
| REL-001, REL-002, ARCH-001; 5.15 | `apps/api/src/db/connection.js` now selects durable PostgreSQL for hosted production and fails closed instead of using ephemeral `/tmp` SQLite. SQLite remains an explicitly non-authoritative local/test adapter. `apps/api/src/db/schema.js` provides additive, backward-compatible PostgreSQL and SQLite schemas. | Production persistence configuration cases in `apps/api/src/database.behavior.test.js`; API check-JS; legacy SQLite migration test. |
| REL-003, PERF-006; 5.19 | `apps/api/src/db/state.js` assigns a monotonically increasing tenant revision, requires `expectedRevision` and a stable mutation ID, returns an explicit `STATE_REVISION_CONFLICT`, and records duplicate retries without a second state commit. Top-level state arrays are stored as independently hashed entities; unchanged entities are not rewritten. | Compare-and-swap, idempotent retry, single-entity-change, and exact reconstruction coverage in `apps/api/src/stateArchitecture.test.js`; route-level 428/409 coverage in `apps/api/src/server.routes.test.js`. |
| PERF-001, PERF-004; 5.2, 5.3, 5.4 | Each accepted state transaction inserts exactly one revision receipt and one durable publication-outbox row. `apps/api/src/db/publicationOutbox.js` publishes in per-account revision order, retries with bounded backoff, and preserves payloads until success. Firebase child projection writes are batched, legacy full private snapshots are no longer published, and the sync-protocol-v2 parent commit marker is written last. | Outbox failure/order/retry tests; Firebase projection/batching tests; `src/lib/syncProtocolPublishers.test.ts`. |
| REL-002, REL-003; 6.27 | Runtime renderer and Electron call sites no longer publish authoritative Firebase state. Electron/local persistence is labelled `offline-cache` and `authoritative: false`; desktop and browser saves report server commit/conflict/publication status. Player membership, waitlist, and tournament mutations use the authenticated API, and Firestore projection mutation inboxes are backend-only. | `src/lib/stateOwnershipContracts.test.ts`, Electron client/backend tests, management persistence tests, Player boundary tests, and Firestore rule contract tests. |
| Safe migration and recovery | Legacy revision-zero `state_json` records remain readable and migrate on the first compare-and-swap write. A missing server venue may be initialized once from the characterized local cache at expected revision zero; a conflict leaves the cache non-authoritative. Owner-protected outbox inspection/drain routes and a long-running worker timer provide recovery paths. | `apps/api/src/stateMigration.test.js`; Electron API-first migration/conflict tests; architecture record in `docs/architecture/AUTHORITATIVE_STATE.md`. |

Stage 2 dependency disposition:

- Added exact `pg@8.23.0` for durable PostgreSQL access (MIT, Node 16+, server-only) because the existing API had no durable multi-instance adapter.
- Added exact `@vercel/functions@3.9.2` for supported background continuation after an accepted serverless request (Apache-2.0, Node 20+, server-only). Long-running deployments use the same outbox through an interval worker.
- API production dependency audit after installation: **0 vulnerabilities**. Rationale, runtime cost, compatibility, and recovery behavior are recorded in `docs/architecture/AUTHORITATIVE_STATE.md`.

Stage verification on 2026-08-11:

- Focused state, migration, publication, ownership, Electron, management, Player, Firestore, and API route gate: **14 files, 98 tests passed** after contract reconciliation; the two management lifecycle characterization tests also passed independently.
- Root aggregate TypeScript: **passed** across renderer, tests, Electron, and API.
- Player strict TypeScript: **passed**.
- API check-JS: **passed**.
- Full Vitest discovery: **490 passed, 2 failed**. Both failures remain the audited OneDrive `Dirent.isFile()` discovery defect in `src/lib/playerApplicationOrchestration.test.ts` (REL-012); no Stage 2 behavior test failed. Stage 4 must make this gate platform-independent.
- Desktop renderer production build: **passed**, 1,957 modules. Main entry output is 742.31 kB (231.03 kB gzip), with a 412.05 kB shared entry and a separately emitted 1,066.53 kB ExcelJS chunk. Bundle warning remediation remains Stage 4 scope; these figures are measurements, not claimed percentage improvements.
- `git diff --check`: **passed**.
- No production database, Firebase project, hosted endpoint, deployment, domain, certificate, or secret was accessed or changed. The tracked `data/orbit-api.sqlite3` artifact was not opened or modified.
