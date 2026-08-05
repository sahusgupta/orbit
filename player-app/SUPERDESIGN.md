# Orbit Player Design Philosophy

Orbit Player is designed as a calm, mobile-first companion for poker players who want to find games, understand club activity, manage memberships, and join waitlists without feeling like they are using a casino dashboard. The visual language should feel clear, local, and trustworthy: closer to a premium coordination tool than a betting product.

The app should communicate three things at a glance:

- Where good game opportunities are.
- Whether the player has a relationship with the club.
- What action is available now.

The interface favors practical discovery over spectacle. Screens should be dense enough to scan quickly, but never cramped. Cards, map regions, status pills, and bottom navigation should make the app feel touch-native and operational, with every visual decision serving orientation, confidence, or action.

## Core Principles

### Calm Utility

The player app should reduce uncertainty. It uses soft surfaces, clear hierarchy, and restrained status color so players can compare clubs, games, seats, distance, and waitlist state quickly. Avoid casino cliches, dark gambling-room aesthetics, neon, aggressive reds, and anything that implies exploitative play.

### Local Presence

Maps, distance language, club cards, and home-radius context are central to the product. The design should make the player feel anchored in a real local poker ecosystem rather than browsing an abstract feed.

### Trust Before Excitement

The player is sharing identity, location preferences, memberships, and waitlist intent. Onboarding, account settings, and sync states should feel polished and secure. Use sturdy typography, generous spacing, and high-contrast actions to convey reliability.

### Actionable Discovery

Every game card should answer: what game is running, where it is, how close it is, whether seats are open, and how to join. Visual hierarchy should privilege game name, seat/waitlist state, distance, and the primary action.

### Friendly Native Touch

The app uses rounded cards, pill buttons, animated press feedback, bottom tabs, and icon-led controls. Interactions should feel soft and responsive, with compact tap targets and clear active states.

## Core Color Scheme

The player app uses a clean Orbit palette built around deep navy, teal, electric blue, amber, white surfaces, and quiet slate neutrals.

| Role | Color | Use |
| --- | --- | --- |
| Ink | `#0B1020` | Primary text, active tab text, important labels. |
| Muted | `#64748B` | Secondary text, supporting details, placeholders. |
| Canvas | `#F9FAFB` | Base screen background. |
| Panel | `#FFFFFF` | Solid card and account surfaces. |
| Line | `rgba(100,116,139,0.16)` | Borders, input outlines, dividers. |
| Primary | `#4D7CFE` | Main actions, home/club pins, hero surfaces. |
| Primary Dark | `#0B1020` | Deep text accents, shadows, progress fills. |
| Primary Soft | `#EEF3FF` | Soft buttons, badges, avatars, sync panels. |
| Blue | `#2563EB` | Positive/active states, joined clubs, progress, eyebrow labels. |
| Blue Soft | `#DBEAFE` | Active tabs, preference bands, open/available states. |
| Teal | `#0F766E` | Selected map pins, joined clubs, and healthy activity. |
| Teal Soft | `#DFF4EF` | Membership and positive-status backgrounds. |
| Amber | `#D97706` | Attention states and selected items. |
| Amber Soft | `#FEF3C7` | Pending and waitlist backgrounds. |
| Red | `#DC2626` | Destructive or warning accents, used sparingly. |

## Backgrounds

The app should remain light by default. Main screens use a flat, quiet canvas:

```text
#F9FAFB
```

Onboarding uses a solid navy hero surface:

```text
#10233A
```

Color blocks should provide clear hierarchy without becoming decoration. White panels, navy type, teal status cues, and amber attention states carry the interface.

## Surface Language

Most app content lives on translucent white panels:

- Search panels: `rgba(255,255,255,0.82)`
- Club cards: `rgba(255,255,255,0.88)`
- Game cards: `rgba(255,255,255,0.9)`
- Onboarding step surfaces: `rgba(255,255,255,0.96)`
- Inputs and chips: `rgba(255,255,255,0.92)`

Borders are usually soft white or `rgba(100,116,139,0.16)`. Shadows are navy-tinted with low opacity, creating elevation without heaviness. Rounded corners are generous on mobile: 18-30px for cards and panels, 999px for pills.

## Typography

The app uses system-native sans-serif typography with a strong weight scale. Headings and key statuses are heavy and compact; supporting text is smaller, muted, and still fairly bold for readability on mobile.

- Screen titles are large, dark, and heavy.
- Eyebrows are Orbit blue, uppercase, and concise.
- Card titles are bold and direct.
- Status and pill text uses high font weight to remain legible at small sizes.
- Letter spacing should remain `0`; the current style depends on weight and color, not tracking.

## Interaction Color Rules

Primary actions use solid navy:

```text
#0B1020
```

Disabled actions use solid slate:

```text
#94A3B8
```

Active selections usually use soft blue backgrounds with dark navy text. Pending or waitlist states use soft amber. Warning/destructive cues may use red, but should not dominate the screen.

## Components

### Game Cards

Game cards are the core discovery unit. They should be white, rounded, and lightly elevated. Use value pills for distance, seats, waitlist, joined status, and preferred-game context. The primary button should be visually dominant and anchored near the bottom of the card.

### Club Cards

Club cards should read as quick comparison rows: club identity, distance or membership state, and an immediate affordance. Selected cards use an amber border accent (`#D97706`) inside the broader navy and teal system.

### Map UI

Maps should feel integrated into the app, not embedded as a generic widget. Use rounded map containers, soft radius rings, navy home pins, teal joined-club pins, and amber selected pins.

### Onboarding

Onboarding should feel guided and trustworthy. The hero uses a deep solid surface:

```text
#10233A
```

The step surface is a soft white card below it. Keep copy short and action-oriented. The progress bar uses navy, reinforcing the sense of steady setup rather than marketing flourish.

### Bottom Tabs

The bottom tab bar should remain a translucent white pill anchored above the safe area. Active tabs use `#dff4ef`; inactive labels use muted gray. Icons should be familiar and simple.

## Voice And Product Feel

Language should emphasize coordination, visibility, game formation, wait reduction, occupied seat-hours, likely participation, and table fit. Avoid predatory poker terms or player-quality labels. The player app should never imply that users are hunting weaker players; it is helping them find legitimate games and manage participation.

## Design Guardrails

- Keep the app light, clean, and practical.
- Use navy for authority, teal for healthy activity, amber for attention, and coral only for caution.
- Do not introduce neon, casino red/black, heavy gold, or felt-table green as dominant themes.
- Preserve rounded native controls and compact, scannable cards.
- Make maps and local distance context prominent whenever discovery is involved.
- Keep primary actions obvious and touch-friendly.
- Favor trust, clarity, and coordination over hype.
