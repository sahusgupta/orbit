# Internal Texas Poker Opportunity Map

This is a standalone browser application for geographically reviewing the supplied Texas poker-venue catalog and comparing modeled sales opportunities. It is not an Orbit route, is not included in the Electron package, and does not use Orbit application state, Firebase, API clients, analytics, or browser persistence.

## Local commands

Run from the repository root after `npm ci`:

```powershell
npm run sales-map:dev
npm run demo:reset
npm run sales-map:preview
npm run sales-map:typecheck
npm run sales-map:test
npm run sales-map:build
```

The development and preview servers listen only on `127.0.0.1:4176`. Run `sales-map:build` before `sales-map:preview`; the preview command serves that static build locally. Build output is written to the ignored `internal-tools/sales-map/dist/` directory. No deployment command is provided.

While `sales-map:dev` is running, `demo:reset` reloads every connected demo page. Because all editable sales-map data is session-only, that reload restores the first supplied venue, an empty search, the All filter, a 50/50 weighting balance, the state-wide map, no planning models, and an empty cold-call route. The command writes only an ignored local reset signal under `.orbit/`; it does not delete files, launch Orbit, or contact an API or Firebase. Static preview pages do not have Vite's development reload channel and must be reloaded in the browser.

## Venue map and scoring

The checked-in catalog contains all 132 supplied venues across 63 listed Texas cities. Venue names, cities, and advisories are preloaded; they are not assertions that a venue is currently operating. The source list contains cities rather than street addresses, so map markers use city representative points and must be treated as geographic approximations.

Nearby representative points are grouped into bounded clusters with a venue list behind each marker. On narrow screens the map scrolls horizontally instead of collapsing distant parts of Texas into a single cluster.

The map has three accessible view presets: the full Texas view, a regional window around the selected venue's city, and a closer city-area window. These are geographic map windows rather than official municipal or regional boundaries. Marker controls keep a fixed touch-target size as the underlying Texas viewBox changes.

Venues can be added to a session-only cold-call route. The ordered route list is authoritative; red directional connectors and numbered city badges visualize the same sequence. Stops can be moved manually, ordered by normalized sales priority, or ordered approximately by geographic proximity while preserving stop 1. Proximity uses representative city points, and the red connectors are straight sequence guides—not roads, turn-by-turn directions, or estimates of travel time. Region and city-area views show route legs attached to at least one visible stop instead of unrelated through-lines with both stops outside the view. Repeated legs in the same direction share a connector; opposite directions use separate lanes, while the badges and ordered list retain every exact stop position. Multiple venues in one city correctly share one point while retaining separate positions in the ordered list.

The Texas outline and most city points are derived from the U.S. Census Bureau's public 2025 Cartographic Boundary and Texas Places Gazetteer files. Cypress, which is not a 2025 Census place, uses the U.S. Geological Survey GNIS populated-place point. Those values are embedded in the application, so the map makes no runtime tile, geocoding, or other network requests.

- https://www.census.gov/geographies/mapping-files/2025/geo/carto-boundary-file.html
- https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html
- https://www.usgs.gov/us-board-on-geographic-names/download-gnis-data

Planning inputs remain session-only. Refreshing or closing the page clears modeled CAC, expected net value, and founder hours while leaving the supplied catalog available. The tool derives expected net value per founder hour and calculates cohort-relative weights using reverse min-max CAC normalization and forward min-max founder-hour-value normalization. Only venues with complete saved planning inputs enter normalization. Search and display filters never change that cohort.

Cold-call route membership and order are also session-only. Search, display filters, metric edits, and map zoom do not implicitly add, remove, or reorder route stops; priority and proximity ordering run only when their buttons are activated.

Compare only opportunities that use the same value horizon and founder-time assumptions. Flat metrics are treated as neutral and omitted from the discriminating score.
