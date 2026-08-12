# Astryx design system

Astryx is Orbit's cross-surface design contract. It optimizes for fast, unambiguous poker-room operation before decorative novelty. The management renderer is the reference CSS implementation; the API dashboard, public site, and Player application consume the same roles with platform-appropriate controls.

## Sources of truth

- Desktop tokens: `src/styles/00-foundation.css`
- Desktop component and state rules: `src/styles/10-shared-controls.css`, `src/styles/180-app-shell.css`, and `src/styles/190-accessibility.css`
- Player tokens: `player-app/src/styles/playerTheme.ts`
- Canonical square logo and table mark: `public/orbit-logo.svg` and `public/orbit-table-logo.svg`
- Canonical desktop/mobile application icon: `build/icon.png`
- Canonical public social icon: `public/orbit-icon.png`
- Governed export/check command: `npm run brand:sync` and `npm run check:brand`

`brand:sync` makes local repository copies only. It does not deploy, publish, sign, alter DNS, or change a production hostname. `player-app/assets/favicon.png` and `build/icon.ico` are format-specific derivatives and must be regenerated from the approved source when changed.

## Foundations

### Typography and font loading

Astryx uses the operating-system sans-serif stack. No custom font is approved, licensed, or bundled, so there is no network font request, font flash, or avoidable font-driven layout shift. The supported weights are 400, 500, 600, and 700. Hierarchy comes from role, size, spacing, and color; synthetic 650/720/850/950 weights are prohibited.

If the founder later approves a custom family, the change requires license evidence, WOFF2 or native assets as applicable, explicit weight files, preload/subset review, metric-compatible fallback, and layout-shift verification before adoption.

| Role | Desktop token | Player role | Weight |
| --- | --- | --- | --- |
| Display / page title | `--type-heading-1` | `display` | 700 |
| Section heading | `--type-heading-2` / `--type-heading-3` | `heading` | 600-700 |
| Body / form value | `--type-body` | `body` | 400-600 |
| Label | `--type-label` | `label` | 600-700 |
| Metadata | `--type-meta` | `meta` | 400-600 |

### Spacing, density, and layout

Spacing follows the 4-pixel scale (`--space-1` through `--space-12`). Compact controls are 34-36 pixels only where pointer use and surrounding context are clear. Default desktop controls are 40 pixels; Player touch targets are at least 44 pixels. The reading, compact, wide, and maximum layout widths are 720, 920, 1360, and 1600 pixels.

Responsive behavior is content-led at 1180, 900, 680, and 420 pixels. At 1180 pixels the floor's secondary rail stacks below the operational workspace. Time-overview names truncate on one line with the full value exposed through the element title, while the game label moves to a second line. Horizontal overflow is reserved for data that cannot be safely reflowed.

### Radii, borders, surfaces, and elevation

- Ordinary controls use the 8-pixel control radius. Panels use 10 pixels; overlays use 12 pixels; a 16-pixel radius is reserved for a small number of prominent entry surfaces.
- Full pills are reserved for compact status, tag, timer, notification-count, and circular-geometry roles. Actions, tabs, inputs, navigation, and generic cards are not pills.
- Canvas, panel, subtle, selected, and overlay surfaces are solid or tonal. Frosted/translucent glass, backdrop blur, decorative fog, aurora meshes, gradient blobs, noise, and animated grids are prohibited.
- Borders and spacing group ordinary content. Shadows are absent on ordinary cards and controls. `--elevation-raised` is for a genuinely raised entry surface; `--elevation-overlay` is for dialogs, menus, drawers, and notifications. Focus rings and drag/drop rings are state indicators, not decoration.

### Color and interaction state

Every interactive component must expose default, hover, pressed, selected, disabled, loading, error, success, and warning behavior as applicable. Desktop uses `--state-*` and semantic color aliases; Player uses `colors` plus the same named roles. Color is never the only carrier of status: copy, icon, border, or accessible state accompanies it.

Focus must remain visible. Desktop uses `:focus-visible` without removing native keyboard semantics. A disabled control remains legible and exposes disabled state. Errors use a persistent label, programmatic description, and alert/live region. Success and background status updates use a polite live region unless interruption is required.

### Icons and tooltips

Desktop uses Lucide with 16, 20, and 24-pixel roles. Player uses Ionicons at the same semantic sizes because it is the platform-appropriate vector set. Emoji are not control icons. Decorative icons are hidden from assistive technology; icon-only controls have an accessible name and a hover/focus tooltip. Text remains on unfamiliar or consequential actions.

### Loading, empty, and recovery states

Predictable route loading uses layout-matched skeleton blocks with an announced busy state. Skeletons do not imply real data and stop animating under reduced motion. Empty states explain what is absent; errors state what failed and provide a safe retry or recovery action. Loading, empty, error, and success are separate states.

## Motion contract

Motion must communicate one of four purposes: direct manipulation feedback, overlay entry/exit, bounded progress, or a material state change. Use `--motion-fast` (120 ms), `--motion-base` (180 ms), or `--motion-slow` (280 ms) with the Astryx easing tokens. Repeated section entrance, stagger-by-default, flicker, breathing glow, perpetual pulse, and ambient background movement are prohibited.

The desktop reduced-motion query collapses animation and transition duration. Player reads the native reduced-motion setting and suppresses touch lift/scale animation. Progress values may update without decorative movement.

## Accessible primitive strategy

Astryx keeps one web primitive direction: semantic HTML plus the repository's Radix-backed dialog, dropdown, tab, and tooltip dependencies, styled through the ShadCN-compatible `ui/` layer. BaseUI is not added. Raw controls remain acceptable when native semantics are sufficient, but they must follow Astryx states, labels, focus, density, and error behavior. Player uses React Native controls with explicit `accessibilityRole`, `accessibilityLabel`, and `accessibilityState` for selections and disclosures.

## Required external evaluations

### ui.watermelon.sh

Evaluated candidates: the [FAQ block](https://ui.watermelon.sh/block/faq-1), [notification block](https://ui.watermelon.sh/block/notification-4), and [Sonner component](https://ui.watermelon.sh/components/sonner). Their disclosure and feedback behaviors are relevant, but installing copied registry code would add a second styling ownership path beside Orbit's existing Radix/ShadCN-compatible layer. The generic FAQ block also does not supply approved Orbit FAQ content or Orbit-specific composition.

Disposition: do not install or copy a Watermelon block. Astryx adopts the useful behavior: native/Radix disclosure semantics, explicit expanded state, bounded live feedback, and one governed state vocabulary. Stage 7's FAQ will use approved factual content in a custom Orbit presentation rather than a registry layout.

### Motion Primitives

Evaluated candidates: [In View](https://motion-primitives.com/docs/in-view), [Animated Group](https://motion-primitives.com/docs/animated-group), disclosure/dialog primitives, and the broader [Motion Primitives catalog](https://motion-primitives.com/docs). The package is a Tailwind/Motion-oriented beta library. In View and Animated Group make repeated entrance/stagger effects easy, which conflicts with Orbit's operational scanability and explicit no-default-entrance rule. Adding Motion and Tailwind for behavior already covered by CSS, Radix, and React Native Animated would increase the dependency and styling surface.

Disposition: do not install. Astryx implements bounded duration/easing tokens, state-only transitions, overlay entry, progress updates, and reduced-motion suppression with current platform tools. Text effects, shimmer, glow, tilt, and repeated viewport entrance remain prohibited.

### Haikei

Evaluated output families at [Haikei](https://haikei.app): blobs, waves, blurry gradients, low-poly fields, grids, symbols, steps, and peaks. Blobs, blurry gradients, and waves would reintroduce the prohibited fog/blob direction; noise and animated grids are also prohibited. The remaining structured outputs do not improve task comprehension enough to justify another decorative asset or export pipeline.

Disposition: reject all Haikei output for P2. Orbit uses solid tonal sections, borders, spacing, canonical brand artwork, and code-native poker/card geometry. Generated Stage 7 atmosphere, required separately by the approved brief, must remain abstract and must never depict product UI, customers, venues, or metrics.

## Individually reviewable prohibited-pattern dispositions

| Pattern | Disposition | Enforcement / exception |
| --- | --- | --- |
| Glassmorphism | Removed | No blur-backed product surface; opacity is allowed only for modal scrims. |
| Aurora / fog | Removed | No decorative multiradial canvas or TV background. |
| Gradient blobs | Removed | Radial shading is allowed only inside literal poker-table geometry, where it communicates felt/rail depth. |
| Persistent decorative glow | Removed | Focus, selected, alert, and drag/drop rings remain explicit operational state. |
| Excessive pills | Removed | Full radius is limited to compact status/tag/timer/count or circular geometry. |
| Excessive shadows | Removed | Only raised entry surfaces and true overlays receive elevation. |
| Repeated entrance animation | Removed | One bounded overlay/notification entrance is allowed; sections and cards do not rise/fade by default. |
| Testimonials / reviews | Prohibited | No founder-supplied, rights-cleared evidence exists. |
| Fake UI / screenshots | Prohibited | Only current, redacted product captures may represent product behavior. |
| Decorative emoji icons | Prohibited | Lucide and Ionicons are the governed sources. |

## Verification

`src/lib/astryxDesignSystem.test.ts` checks required tokens, supported weights, prohibited CSS patterns, reduced-motion handling, key accessible state, and canonical logo/icon export integrity. Visual verification must cover the Electron minimum, 1180, 900, 680, and 420-pixel boundaries plus keyboard focus. VoiceOver and TalkBack device passes remain required before production promotion; source-level completion is not a substitute for device assistive-technology validation.
