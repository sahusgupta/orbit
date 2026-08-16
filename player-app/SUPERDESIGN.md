# Orbit Player Design Philosophy

Orbit Player is designed as a calm, mobile-first companion for poker players who want to find games, understand club activity, manage memberships, and join waitlists without feeling like they are using a casino dashboard. The visual language is shared with the Orbit Player web landing page: a deep night-sky canvas, crisp operational panels, electric-blue actions, green live signals, and restrained poker-card imagery used to explain product state.

The app should communicate three things at a glance:

- Where good game opportunities are.
- Whether the player has a relationship with the club.
- What action is available now.

The interface favors practical discovery over spectacle. Screens should be dense enough to scan quickly, but never cramped. Cards, map regions, status pills, and bottom navigation should make the app feel touch-native and operational, with every visual decision serving orientation, confidence, or action.

## Core Principles

### Calm Utility

The player app should reduce uncertainty. It uses clear hierarchy, bordered navy surfaces, and restrained status color so players can compare clubs, games, seats, distance, and waitlist state quickly. Poker imagery is informational: playing cards identify live, forming, and registration states. Avoid casino cliches, neon, aggressive reds, gold trim, felt-table styling, and anything that implies exploitative play.

### Local Presence

Maps, distance language, club cards, and home-radius context are central to the product. The design should make the player feel anchored in a real local poker ecosystem rather than browsing an abstract feed.

### Trust Before Excitement

The player is sharing identity, location preferences, memberships, and waitlist intent. Onboarding, account settings, and sync states should feel polished and secure. Use sturdy typography, generous spacing, and high-contrast actions to convey reliability.

### Actionable Discovery

Every game card should answer: what game is running, where it is, how close it is, whether seats are open, and how to join. Visual hierarchy should privilege game name, seat/waitlist state, distance, and the primary action.

### Friendly Native Touch

The app uses rounded cards, pill buttons, animated press feedback, bottom tabs, and icon-led controls. Interactions should feel soft and responsive, with compact tap targets and clear active states.

## Core Color Scheme

The player app uses the same dark Orbit palette as Player web.

| Role | Color | Use |
| --- | --- | --- |
| Ink | `#F4F7FF` | Primary text, active tab text, important labels. |
| Muted | `#8A9ABD` | Secondary text, supporting details, placeholders. |
| Canvas | `#060C1A` | Base screen background. |
| Panel | `#10192C` | Solid card and account surfaces. |
| Line | `rgba(110,145,255,0.18)` | Borders, input outlines, dividers. |
| Primary | `#4D7CFE` | Main actions, home/club pins, hero surfaces. |
| Primary Dark | `#080F1F` | Deep surfaces, overlays, and app chrome. |
| Primary Soft | `#182746` | Soft buttons, badges, avatars, and selected context. |
| Live | `#35D3A1` | Live state, successful state, and hero proof. |
| Live Soft | `#102D2A` | Positive-status backgrounds. |
| Accent | `#A98BFF` | Secondary atmosphere and attention states. |
| Accent Soft | `#291D45` | Secondary status backgrounds. |
| Danger | `#FB7185` | Destructive or error accents, used sparingly. |

## Backgrounds

Main screens use the deep Orbit canvas:

```text
#060C1A
```

Layered blue, violet, and green waves sit behind the product shell. They are non-interactive, low contrast, and code-native so they scale without bitmap artifacts. The Games landing area adds an abstract overhead poker-table composition inside a bordered hero frame.

Color blocks provide hierarchy without becoming spectacle. Navy panels, near-white type, green live cues, and violet attention states carry the interface.

## Surface Language

Most app content lives on solid or nearly solid dark panels:

- Primary panels: `#10192C`
- Deep feature panels: `#0D1525`
- Selected surfaces: `#1A294B`
- Soft controls: `#182746`
- White is reserved for the faces of interactive playing cards and QR-code scan regions.

Borders use translucent electric blue. Elevation is conveyed primarily by border strength and surface color; shadows are reserved for overlays and selected playing cards. Controls use a 10px radius, panels 12px, and entry/hero surfaces 16px.

## Typography

The app uses system-native sans-serif typography with a strong weight scale. Headings and key statuses are heavy and compact; supporting text is smaller, muted, and still fairly bold for readability on mobile.

- Screen titles are large, near-white, and strong.
- Eyebrows are live green, uppercase, tracked, and concise.
- Card titles are bold and direct.
- Status and pill text uses high font weight to remain legible at small sizes.
- Body and card copy should avoid decorative tracking; compact uppercase eyebrows and brand descriptors may use restrained letter spacing.

## Interaction Color Rules

Primary actions use solid electric blue:

```text
#4D7CFE
```

Disabled actions use solid slate:

```text
#94A3B8
```

Active selections use deep blue backgrounds with light blue text. Live and successful states use green. Pending or attention states use violet. Warning/destructive cues may use coral, but should not dominate the screen.

## Player Web Landing Continuity

The native Games route incorporates every signature landing-page motif while keeping controls connected to app behavior:

- The Orbit brand lockup and “Current live poker starts here” eyebrow introduce the route.
- “Find your game” is the primary display line, followed by primary and secondary actions.
- A room-published proof line explains the authority of live data.
- An abstract table frame contains a tappable fan of Live, Forming, and Open playing cards plus a changing feature readout.
- “Now on Orbit” lists current games and opens their native detail routes.
- Registration and current-room spotlights navigate to Tournaments and Clubs.
- The Discover, Evaluate, Commit, Arrive journey closes the discovery flow.
- “Straight answers for live play” appears in Profile as an accessible disclosure list.
- Profile closes with the compact Orbit and Caminus Labs brand footer used on Player web.
- Ambient layered waves continue behind the authenticated app shell.

## Components

### Game Cards

Game cards are the core discovery unit. They use bordered navy surfaces with value pills for distance, seats, waitlist, joined status, and preferred-game context. The primary button remains visually dominant and anchored near the bottom of the card.

### Club Cards

Club cards read as quick comparison rows: club identity, distance or membership state, and an immediate affordance. Compact rounded-square monograms echo the web club listings.

### Map UI

Maps should feel integrated into the app, not embedded as a generic widget. Use rounded map containers, soft radius rings, navy home pins, green joined-club pins, and violet selected pins.

### Onboarding

Onboarding should feel guided and trustworthy. It uses the same deep canvas and orbit geometry, short action-oriented copy, a clear progress treatment, and high-contrast fields.

### Bottom Tabs

The bottom tab bar remains a deep floating panel anchored above the safe area. Active tabs use the selected blue surface and light-blue foreground; inactive labels use muted blue-gray. Icons remain familiar and simple.

## Voice And Product Feel

Language should emphasize coordination, visibility, game formation, wait reduction, occupied seat-hours, likely participation, and table fit. Avoid predatory poker terms or player-quality labels. The player app should never imply that users are hunting weaker players; it is helping them find legitimate games and manage participation.

## Design Guardrails

- Keep the app dark, clear, and practical.
- Use navy for authority, green for live activity, violet for attention, and coral only for caution.
- Use playing-card and table imagery only where it explains navigation or live state.
- Do not introduce neon, casino red/black, heavy gold, or felt-table green as dominant themes.
- Preserve rounded native controls and compact, scannable cards.
- Make maps and local distance context prominent whenever discovery is involved.
- Keep primary actions obvious and touch-friendly.
- Favor trust, clarity, and coordination over hype.
