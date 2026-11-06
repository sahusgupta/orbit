# Pending replay admission policy

This repair is limited to the Native Electron bridge and explicit management
authentication. It does not change API state authority, checkpoint wire shapes,
Browser retry policy, source limits, or the selected receipt namespace.

The encrypted offline cache now retains additive `retryPolicy` metadata bound to
the original mutation ID, source hash, and expected revision. HTTP 401/403 pause
until an explicit same-account sign-in supplies fresh server proof. Other
permanent 4xx failures and revision conflicts require reconciliation. Transient
failures retain an absolute retry deadline, honoring Retry-After across process
restart. Passive reads, update flushes, timers, and already-queued requests all
check the policy at dispatch. Blocked attempts do not increase the attempt count.
Actual HTTP status and application/transport failure categories remain distinct.

Transport may be selected once after an earlier capability failure; the same
operation policy remains valid when an unset transport becomes checkpoint-v1.
An already-selected transport cannot change. Old local records without a policy
remain readable. Unknown or corrupt policy data fails closed. An ACK mismatch
keeps its separate existing pause.

The new optional preload method `resumePendingManagementState` accepts access
only. A trusted explicit authentication path invokes it after successful sign-in
or signed-key adoption, with the original state/sequence fences. It obtains fresh
same-account proof without using a cached server proof, chunk hydration, revision adoption, or
replaying a save. Proof requires owned HTTP 200 and a strict checkpoint manifest,
or exact authenticated CHECKPOINT_STATE_NOT_FOUND/HTTP404 for expected revision
zero. A server without the manifest route may supply an owned HTTP200 bounded
legacy canonical record. Proof requests reject redirects. This preserves machine
credentials whose successful license response has no managed-license record.

Successful proof clears only the unchanged operation's authentication policy;
permanent, deadline, and ACK-invalid pauses remain. Its validated credential has
priority over stale passive credentials for that operation, retiring on ACK or a
new operation. Original body, mutation ID, hash, revision, and transport remain
unchanged. A successful local sign-in remains successful if the optional bridge
method is absent or recovery fails.

Renderer admission remains closed until canonical state is adopted. A separate
account hold prevents a matching background ACK from clearing admission after
authentication recovery. Ordinary-save counters alone still gate reads, allowing
the canonical read to proceed. The existing guarded canonical callback clears the
hold only after stateRef/UI adoption, or the established equal-JSON branch.
An announcement/storage error before adoption cannot clear it. The optional
non-authoritative browser-cache write still follows canonical adoption.

## Evidence retained during development

All commands use an isolated non-main worktree based on
`80934f0d7a8506ab95741c1038734563cf5a2069`, fresh OS-only child environments,
test memory/local port 9, both sync flags disabled, provider and environment-file
read guards, one Vitest worker, and unchanged five-second case deadlines.
Dependency junctions borrow the independently installed locked hotfix trees;
these are focused checks, not an independent installation audit.

- BEFORE: eight relevant suites, 140 tests passed. The wrapper printed a Windows
  encoding error after preserving the actual successful Node result; that first
  result remains intact.
- Initial regressions: 37 tests, 22 genuine failures and 15 controls passed.
- First implementation checks retained two expiry-fixture failures, then one;
  corrected unambiguous fixture instants yielded 49/49 passed without relaxing
  production expiry validation.
- Expanded 51-case check: 50 passed; one new proof fixture kept its synthetic
  revision17 manifest during a later revision1 download. The override was cleared
  before that later read. The transport-selection/restart regression passed.
- Credential priority: one genuine RED showed a stale poll replacing the proven
  credential; the exact regression and ACK/new-operation control passed after
  the operation-bound fix.
- Combined ten-suite check: 191/192 passed. The sole failure was the expected
  preload key list missing the explicitly added method. Adding that exact key
  yielded 12/12 composition tests passed. All 52 new policy/authentication cases
  and the original 42 persistence cases passed in the combined run. Existing
  persistence assertions remain; fixture retry clocks now advance to the actual
  persisted deadline and fresh authentication uses the explicit signal.
- Canonical adoption: all four unchanged hook suites passed (62 tests). An actual
  Main ACK callback with real SHA reproduced an early save admission. Two real
  hook regressions reproduced early release when announcement or its storage
  failed; the equal-JSON control passed. The first new hook run had zero test
  assertions because its jsdom source-loader URL was not a file URL; the fixture
  alone was corrected. After the Set and callback-order repair, all four targeted
  controls passed, including both original and canonical fractional ledger rows.
- An unreadable HTTP200 response reproduced status0/transport classification.
  The durable-state-only failure path now retains the owned status; its regression
  passed. Non-durable failure payload behavior remains unchanged.
- Combined final run: **15 files, 259/259 passed**, 71.48 seconds total, unchanged
  five-second case deadlines, source/index unchanged. This includes existing
  desktop/Browser hook, restoration, persistence, update, and bridge controls.
- Renderer and Root test strict programs passed first try. Electron check-JS
  first reported three owned typing diagnostics; precise property-presence
  narrowing and a validated literal variable fixed them. Electron and API strict
  programs passed. No casts, compiler/config relaxations, or skipped tests were
  introduced. After those two Native-only typing edits, the relevant original42
  and new33 Native tests passed **75/75**, 5.73 seconds total; Main/hook source was
  unchanged from the 259-case run.
- Module graph passed: 290 files, 906 edges, 20 packaged runtime files; zero
  cycles, dependency violations, unresolved imports, or packaging omissions.
- Compiler-only production renderer budget passed at **613,987 raw / 189,696
  gzip bytes**, below unchanged620,000/190,000 limits, with production React and
  the default-enabled Firebase compilation branch. An ignored wrapper preserves
  the actual budget helper byte-for-byte except Vite options (`envDir:false`,
  production mode, and an explicit compile-only true define). Node runtime sync
  remains disabled and the local API stays port9; output uses `write:false` and
  is never served or executed.
- Independent final review found that the new validated credential's backing
  replay override survived ACK. A production-style next save without an access
  argument reproduced use of old proven keyB instead of state keyC. The first
  new case stopped at a fixture checksum error because its fake job reused old
  chunks; partitioning the fake upload by operation reached the genuine header
  failure. Retirement now clears only the replay override still owned by that
  validated lease on ACK/new operation, preserving unrelated legacy behavior.
  The exact regression passed. The subsequent76-case Native run initially
  exposed an existing exact7000ms assertion receiving6999ms after a one-millisecond
  real-clock advance. That fixture clock was pinned; the assertion remains7000.
  **Current Native76/76 passed**, 5.90 seconds total, and current Electron strict
  passed. Main/hook/renderer/API files are unchanged from their successful checks.

Two ad-hoc ignored editing commands had Python syntax errors before source
writes; corrected isolated file scripts were used. No product assertion was
removed or deadline raised to address any failed attempt.

Immutable attempt logs, source/index hashes, provider-denial proofs, and raw
preimages live under ignored `out/retry-policy-verification/` and adjacent
`out/retry-policy-before-*` directories. Failed attempts are retained separately.
The final source receipt is ignored `out/pending-replay-policy.manifest.json`,
with explicit raw before/after files and a cumulative patch. This record describes
focused repair verification. Parent integration `npm run verify` and release
workflow results are tracked separately in the parent release evidence after
cherry-picking onto the current emergency fixture head; this record does not
claim those checks or a release. There is no hosted test, deployment, alias
change, new grant, or push in this repair phase. API source is unchanged.
