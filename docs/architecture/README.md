# Architecture Notes

Use this directory for evidence-backed architecture decisions and current-state maps.

- [Desktop operations UI](./DESKTOP_FLOOR_UI.md) documents the spatial Floor presentation, its non-authoritative layout-preference boundary, and the table-first Table View presentation.
- [Management data export](./DATA_EXPORT.md) separates the sanitized portability export from the sensitive restorable backup and documents expired-license export access.
- [Orbit Match persistence](./ORBIT_MATCH_PERSISTENCE.md) documents private Player state, transactional operations, cross-device conflicts, retention, and deletion.
- [Venue location and discovery](./VENUE_LOCATION_DISCOVERY.md) documents optional authored venue pins, public projection, bounded cursor scanning, and pilot configuration.
- [Player local search location](./PLAYER_LOCAL_LOCATION.md) documents optional foreground permission, manual origin selection, local retention, and map-provider disclosure.
- [Orbit Match ranking](./ORBIT_MATCH_RANKING.md) documents factual normalization, hard constraints, factor weights, schedule/exploration semantics, and measured computation.
