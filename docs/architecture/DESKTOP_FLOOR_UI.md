# Desktop operations UI

The desktop Floor is a table-first operations surface over the existing management command boundaries. `src/components/FloorView.tsx` receives operational state and callbacks from `src/main.tsx`; seating, waitlist, timer, ledger, dealer, and lifecycle mutations continue to pass through the management commands.

## Spatial room map

`src/components/FloorRoomMap.tsx` renders persisted `PhysicalTable` records as spatial poker-table objects. A physical table remains visible while empty. An active `GameSession.physicalTableId` binds a fresh game run to that identity; selecting an occupied table calls the existing `openTableView(session.id)` route callback, while selecting an empty table opens the game chooser and creates a new forming session through the table command.

`PhysicalTable` is authoritative operational configuration in `AppState`, so it is included in persistence, backups, and the sanitized room-data export. A `GameSession` ID remains unique to one historical game run and is never recycled as a physical-table ID. Legacy unbound open sessions remain visible during migration.

The room-map stage fills the Floor container below the command bar. Its canvas expands from deterministic grid dimensions as table count grows, remains scrollable within that available space, and provides bounded zoom plus a density-aware Fit action. These controls change renderer presentation only.

Current Tables, Table Overview, and Forming Games retain their characterized lifecycle, dealer, drop, reconciliation, and game-start workflows. Their persistent bottom dock is overlaid within the room-map stage. Each button opens a centered, portaled, dismissible workspace above its backdrop instead of consuming space beneath the map.

The Floor header can switch between the spatial Graphic view and the list-based Classic view. Both surfaces expose the same Clear, Delete, and Merge table actions from a pointer context menu or Shift+F10/Context Menu keyboard command. Clear closes the current session, removes active players without inventing cash-out amounts, ends the dealer assignment, and retains the permanent table plus financial/audit history. Delete additionally removes the permanent table identity. Merge accepts only an open same-game table with the same Time/Drop collection mode and enough seats; it closes the source, moves active player sessions and their current-session financial/time attribution together, and retains both permanent table identities. The selected Graphic/Classic mode uses the existing `settings.showPlayerGrid` preference.

## Room utilities

The Floor header is the compact room command bar. It keeps running-table and seated-player counts visible while Timers, Activity, Waitlist, and Add player disclose their fuller workflows only when requested. Activity opens as a compact floating overlay by default and can be expanded or restored in place. The existing waitlist actions remain unchanged inside their dialog, including arrival, seating, removal, and the displayed timestamp/edit audit context.

`src/components/FloorUtilities.tsx` derives timer rows only from open sessions and active player sessions. Time collection counts down with the canonical urgency thresholds; an explicitly enabled legacy timer also continues to count down. Untimed Drop collection counts up from `seatedAt`. The per-second value is renderer-only and is never persisted or written back to a session.

`src/features/floor/floorActivity.ts` builds the room activity projection from the existing player ledger, table events, and drop logs after the most recent locked night close. It carries direct table identity and the exact persisted source type into the UI, then applies only narrow operator-facing classifications backed by exact stored values, so table and event filters operate before rendering. Room-scoped entries remain visible under All tables and are excluded from a specific-table filter. The projection does not infer missing seat changes, source-side moves, waitlist history, timer expirations, or other events that the current domain does not record.

## Layout preference boundary

Room-map coordinates are a renderer-only, non-authoritative UI preference. They are stored under the versioned, account-scoped key:

```text
orbit-floor-layout-v1:<account-key>
```

The value is a JSON object keyed by `PhysicalTable.id`, or by `GameSession.id` only for a legacy unbound session, with bounded numeric `{ "x": number, "y": number }` coordinates. Invalid data is ignored, out-of-range coordinates are clamped, and new or missing IDs receive deterministic automatic positions. Coordinates remain a device preference and are not added to `AppState`, sent through the management persistence adapter, published to Firebase, or exposed through the API.

## Table View presentation boundary

`src/components/TableView.tsx` remains a prop-driven renderer over the table projections and callbacks assembled in `src/main.tsx`. The graphical poker table is the primary surface. Activity, buy-in ledger, and timer/session details are compact header utilities that disclose their existing data in dismissible dialogs instead of occupying permanent rails around the table.

Table display settings are presentation-only. Theme, oval/round format, game/blinds visibility, and seat-timer visibility are stored locally under `orbit-table-display-v1:<physical-table-id>` (falling back to the legacy session ID when no physical identity exists). They are not added to `AppState`, persisted through the management adapter, or published to players. The occupied-seat action area swaps a fixed-size, internally scrollable workspace between position, time, and buy-in controls so selecting an action does not expand the surrounding player inspector.

The Activity utility continues to use the existing table-scoped activity projection, and Ledger opens the existing buy-in ledger modal. The Timers utility preserves the canonical countdown values and urgency thresholds. In Drop mode the same utility is labelled Sessions and shows a clock-derived elapsed duration for untimed players; an existing legacy timer still shows its countdown. This elapsed value is a transient presentation projection and is not persisted.

Expired countdown rows expose direct +30 and +60 minute actions through the existing `addPlayerTime` command; merely urgent, non-expired timers remain informational. Occupied seats show player identity and the mode-appropriate clock by default. Their inspector hides internal membership IDs and stages `Add time` separately from `Record buy-in` so the two money-affecting commands cannot be confused. Buy-in history and cash-out remain available, and cash-out still enters the existing confirmation workflow.

Time collection uses one room-wide hourly rate from `settings.defaultHourlyFee`. Per-game profiles continue to select Time or Drop and retain game-specific drop estimates; their historical `hourlyFee` field remains only for persisted-shape compatibility and is normalized to the room rate. Seating and add-on purchases create exact time-fee logs that retain the amount charged at purchase time, so later room-rate changes do not rewrite historical revenue. For legacy sessions whose cumulative purchased minutes exceed their logged minutes, reporting estimates only the unlogged remainder at the current room rate and labels that row as a legacy estimate.

The table center shows the table's revenue projection and current dealer control beneath the Orbit mark. Time-mode revenue uses recorded time-fee totals. Drop-mode revenue is explicitly labelled as an estimate and uses occupied seat-hours multiplied by that game's configured drop estimate. Dealer changes continue through the existing assign/end commands and their audit events.
