# Browser revision ownership — 2026-10-31

The isolated reliability pass found a browser fallback consistency failure at
source `1cbd3cdc0a82983f1c2c401c044c759d191ca11e`. A background GET could finish
after a local edit had queued saves. The incoming-sync hook discarded the
snapshot, but the persistence adapter had already adopted its server revision.
The next queued full-state POST could therefore pass compare-and-swap while
carrying fields from an older snapshot.

The real headless renderer/Express reproduction committed an unrelated profile
note at revision 2. The first held local POST used revision 1 and received 409;
the second queued POST borrowed revision 2, still carried the old note, and
received 201. Both local waitlist removals applied, the external note disappeared,
and the UI reported green `Server saved`. Request timing confirmed that the
background GET supplied revision 2 before the later conflict-reconciliation GET
returned. No production data or service was involved.

## Change

[Browser persistence](../../../src/app/persistence/managementPersistence.ts) now
accepts an optional synchronous read-acceptance predicate and evaluates it after
JSON consumption, before changing its revision map. A declined snapshot returns
`unavailable`, never `missing`. The public wrapper forwards the predicate.

[Incoming synchronization](../../../src/application/management/sync/useManagementPlayerUpdateSync.ts)
supplies its existing cancellation, pending-save and state-identity conditions.
Its post-await guards remain. Deliberate full-state conflict reloads omit the
predicate and retain their existing behavior. This change does not alter state
merging, polling intervals, request payloads, datastore shapes, authentication,
Electron revision fencing or financial/table automatic-replay policy.

## Characterization and results

- The original isolated unit prototype passed two normal-flow cases, then
  failed the rejected-read case: the next POST used revision 2 instead of 1
  despite no UI/cache adoption. Its initial test-library import error was
  corrected by using the repository's React `act`/`createRoot` pattern; that
  fixture error is preserved separately.
- Before production edits, 13 adapter/public-wrapper/composition
  characterizations passed. The expanded 19-case suite then passed those 13 and
  failed six finite ownership regressions: public rejection, pending save,
  changed state, both together, unmount and account switch.
- After the two-file fix, all 19 passed. Six additional regressions cover delayed
  JSON, throwing-predicate recovery, public error propagation, and unchanged
  fetch/JSON failure identity. All 25 pass; existing default reload assertions
  remain intact. Rejected reads issue no initialization POST.
- The seven-file focused run passed 65 tests before the final six additions.
  Strict renderer and test TypeScript passed. The first strict test check caught
  an incomplete synthetic profile (`TS2740`); the fixture now supplies complete
  inert fields without casts or relaxed diagnostics.
- The rebuilt real-browser baseline passes with both waitlist removals visible
  before the held server response, serialized POSTs, and both intentions saved.
- The post-fix contention run preserves the unrelated note in server state and
  browser cache. Both stale POSTs retain revision 1 and conflict; an authoritative
  revision-2 replay preserves the note and commits the second removal.

The original full-convergence oracle remains **failed** after the fix: the first
removal is restored with a visible `Sync issue` and a newer-local-change error.
It is not described as a passing full-convergence test. A separate, explicitly
named `race-safe-rejection` characterization passes while requiring that visible
conflict, the retained external note, the restored first row and the committed
second removal. The original oracle and before/after artifacts were preserved.
This fix prevents the demonstrated silent overwrite; it does not promise that
every queued staff intention automatically survives contention.

Both real-browser paths use actual production-transformed renderer code, real
Express routes, real tenant-bound synthetic machine authentication and an
isolated memory datastore. A missing-only exact-origin test header adapter
supplies browser credentials; this does not verify Electron preload credential
selection or desktop SSE behavior. The second tenant remains unchanged. No
external requests, expired barriers, page errors or header violations were
observed; owned sockets and controls are zero after cleanup.

`node out/resource-reliability-20261031/sdk-integration/run-isolated.mjs verify`
executed the actual `npm run verify` and exited 0: all 13 checks passed. The main
suite passed 3,046 tests with 16 existing skips, Web passed 322, and the sales map
passed 85 (3,453 total passes). All strict checks and the three production builds
passed. Existing React test, ExcelJS eval and chunk-size warnings remain visible.
All eight ancillary gates passed: sensitive paths, independent lockfiles,
release controls, module graph, production dependency audits, renderer bundle,
public site and brand assets. The 32 bound gate inputs remained unchanged.
Fresh production audits reported zero advisories in all four scopes with zero
allowances; the seven supplemental Node-only ExcelJS dispositions remain visible.
Exact commands, source/diff hashes, screenshots, red/green logs and comparisons
remain under ignored `out/resource-reliability-20261031/soak/`, including
`client-corroboration.json`, `client-after-fix-corroboration.json`,
`client-safe-rejection-summary.json`, and
`revision-ownership/AGENT_FINAL_REVIEW.json`, and
`revision-ownership/gates/FROZEN_EIGHT_GATE_REVIEW.json`. No production deployment, native
desktop interaction, EAS build or App Store submission was performed.
