# Club QR self-check-in

## Conservative-v1 disposition

The reusable printed, name-based self-check-in design is retired for conservative v1. Possession of a public club QR plus a display name is not proof of player identity and could let one visitor look up or mutate another player's operational state.

Current repository behavior is deliberately fail closed:

- `POST /management/self-check-in/qr` authenticates and tenant-scopes the caller, then returns `410 PUBLIC_SELF_CHECK_IN_KIT_DISABLED`; it never rotates or issues a printed capability.
- `POST /player/check-in/context`, `/lookup`, and `/seat` return `410 PUBLIC_PLAYER_CHECK_IN_DISABLED`; no submitted display name can authorize a profile lookup or seat mutation.
- `/check-in` is a static retirement notice. Its script clears legacy capability/session storage and URL fragments without making a network request.
- Core Settings labels printed self-check-in unavailable and disables its PDF-generation control.
- Venue staff instead scan the signed-in player's opaque, short-lived, single-use membership QR. Issuance is authenticated as that player, redemption is authenticated and tenant-bound to staff, and the server consumes it atomically.

The former capability, page, PDF, and state-transition helpers remain only as unreachable compatibility/characterization code pending a separately reviewed removal. They are not registered as live mutation handlers and must not be re-enabled through configuration.

## Verification boundary

- API composition tests prove authenticated kit issuance and every public action return `410`, while malformed JSON still fails at the shared parser.
- The public-page test proves there is no name input, lookup/seating endpoint, token header, or network request and that old credentials are cleared.
- The Settings renderer test proves the control is disabled and cannot invoke the Electron PDF bridge.
- Membership-QR service and Electron bridge tests cover the supported authenticated issue/redeem/scanner path.

Any future walk-in flow requires a new explicit identity and privacy design. Re-enabling exact-name lookup, anonymous seating, reusable printed bearer credentials, or display-name matching is not a rollback option.
