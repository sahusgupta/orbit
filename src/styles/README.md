# Management renderer styles

`src/styles.css` is the single renderer entrypoint. Its import order is part of the UI contract: later files intentionally preserve historical overrides from the former monolithic cascade. Do not alphabetize or reorder the imports.

The owner files follow the cascade in these groups:

| Range | Owner |
| --- | --- |
| `00`-`10` | global tokens, access setup, and shared controls |
| `20`-`21` | Floor dashboard, table launchers, and seat/start-table flows |
| `30`-`32` | live table surface, menus, and player operations |
| `40`-`41` | reports/panels and shared forms/Game Builder |
| `50` | Players directory base styles |
| `60` | demand, operations, and Outreach signals |
| `70` | Settings |
| `80` | original shared motion and responsive rules |
| `90`-`91` | low-light base and the ordered dark-theme compatibility pass |
| `100` | Floor theme overrides |
| `110` | immersive Table route |
| `120`-`121` | cross-route surface and premium-detail compatibility passes |
| `130`-`160` | table ledger, table system, Floor financial operations, night close, and table density |
| `170`-`171` | tournament manager and tournament TV |
| `180` | application shell and primitive components |
| `190` | accessibility and focus guardrails |
| `200` | compact waitlist |
| `210`-`220` | historical reports and adjacent report/tournament responsive overrides |
| `230` | light-theme compatibility guardrails |
| `240` | Players activity and membership workflows |
| `250` | final desktop/laptop responsive density pass |
| `260` | staff notifications |
| `270` | spatial Floor room map migration |
| `280` | calm, table-first Table View migration |
| `290` | Floor command bar and room utility drawers |

The compatibility files deliberately retain selectors from multiple features when those rules were introduced as one ordered theme/detail pass. Moving individual rules across those boundaries requires its own rendered characterization because it can change equal-specificity winners.
