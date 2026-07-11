# Orbit V1 Progress Checklist

Audit date: 2026-05-11
Last updated: 2026-05-11

## Overall Progress
~
Estimated V1 completion: 100%
hi
Recent movement:
- Reworked active-table details into an actual seated-player table UI with columns for player, time left, tonight hours, logged hours, buy-ins, and actions.
- Added explicit collection-mode customization per table: `Time fees` vs `Drop`, with time renewal controls shown only for time-feed tables.
- Preserved drop-game handling by showing buy-in/seat information without renewal timers.
- Added active-table seated player time tracking with derived countdowns.
- Added per-table `timeFeeBased` flag and active-table time-fee toggle.
- Added per-player hot-add time controls for `+30m`, `+60m`, and custom minutes.
- Added per-player buy-in logging with amount, timestamp, optional note, session totals, and recent buy-in chips.
- Added persisted `buyIns` model and migration defaults for older saved player/table session records.
- Added explicit player-selection controls for seating players at active tables and starting forming tables.
- Added subtle dashboard animation: card rise, hover lift, soft status flicker, viability pulse, and reduced-motion support.
- Fixed low-light form styling so typed text remains visible in inputs, selects, and textareas.
- Cleaned up the floor dashboard UI by hiding secondary correction fields behind compact detail toggles.
- Increased dashboard spacing and panel padding.
- Updated panel styling so each area feels elevated above the background instead of inset.
- Regenerated the production build successfully after the UI cleanup.

## Post-V1 Opportunities

1. Move from file-backed JSON to SQLite if pilot durability requirements demand relational querying/migrations.
2. Add fuller multi-step undo history beyond the current last-action undo and correction log.
3. Add configurable keyboard shortcuts after observing real floor usage.
4. Add deeper trend-based owner opportunity details after several real nights of data.
5. Add stress testing with larger nightly datasets.
6. Improve GroupMe parsing after seeing real room message formats.
7. Validate low-light mode and status colors in an actual room environment.
8. Add more explicit recovery prompts after accidental app close if staff asks for them.
