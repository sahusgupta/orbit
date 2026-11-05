# Resilient sync upgrade and recovery

This is a prepared runbook for the [checkpoint bridge](../architecture/RESILIENT_MANAGEMENT_SYNC.md), not deployment evidence. The durable command milestone has a separate completion gate. The user's release authorization and confirmed targets remain subject to the [repository release gates](RELEASE_AND_ROLLBACK.md); this document grants no provider or customer-data access.

## Inventory and preservation

1. Record affected installed desktop versions/source, account binding, authoritative revision, pending status, API `/version` and `/state/capabilities`. Collect only counts/bytes by top-level collection. Any legacy state near/above 2,000,000 UTF-8 bytes is an upgrade priority; measure the full request envelope separately. Do not assume duplicates or a dominant growing collection.
2. Keep the current app/tab open until unsynced work is preserved. Do not clear app/site data or import an old backup over pending intent. Preserve a restricted-access, approved encrypted pre-upgrade copy outside the repository/synced folders. Desktop recovery requires the OS-encrypted cache in the actual application's `userData` directory and its original OS account. Preserve operation/revision metadata with state; a state-only export is insufficient for ambiguous committed requests.
3. Legacy executables may reject their own update flush above 2 MB. A downloaded update is not a migration. If that handshake fails, keep the old process/live state available and use reviewed operator-assisted recovery/export; verify counts/balances before replacing it. Automated recovery of every older installed version has not been proven.
4. Former browser memory-only storage cannot restore unsaved work after the tab closes. Preserve that live tab until authoritative save or an approved recovery copy is verified. The new journal starts protecting work only after compatible source is loaded and durable storage succeeds.

## Server first, then clients

1. Review exact source and separate bridge/command milestone scope. Confirm canonical API/Firebase projects and desktop repository without printing credentials. Keep API Git auto-deployment disabled.
2. Run local verification and `npm run e2e:resilient-sync`. Build the immutable API candidate with aliases withheld. Review private `orbitStateCheckpoints` staging plus `checkpointChunks` payload index exemption and `expiresAt` TTL in `player-app/firestore.indexes.json`. Deploy reviewed inputs only to the confirmed target. Expiry is checked immediately; physical TTL deletion is asynchronous. Committed JSON is not proof of deployed TTL.
3. On an authorized synthetic tenant, verify capabilities, retained non-telemetry state above 2 MB, interrupted/resumable chunks, duplicate finalization, authoritative revision, count/balance reconciliation, privacy/server fields, idle-slot takeover, bounded cleanup and publication retry. Confirm unauthorized/oversized/unsupported requests never change authority and old small CAS clients remain compatible.
4. Promote that exact compatible API candidate before clients depending on it. Keep checkpoint support while any oversized venue/pending record needs it.
5. Build an exact-source Windows candidate with a new immutable version using the manual workflow. Review checksums, provenance, packaged runtime and recovery smokes. Artifacts are currently unsigned; this is not an iOS/Android management release.
6. Actually install the canary on selected workstations after preserving pending work. Stable updaters ignore GitHub prereleases. Verify source/version/account, capabilities, pending recovery, authoritative save, downstream protocol-v2 publication and restart.
7. Use a short canary with explicit observation/stop criteria, then make the validated stable artifact available promptly to every affected venue. Capability support is not a permanent venue allowlist. Stable clients check/download at startup and periodically; operators must select **Install update and restart**, with a successful preservation handshake. Record actual adoption separately from release publication. Do not contact clients without explicit instruction.

## Observation and stop criteria

Separate local durability, preflight/IPC, parser, validation, conflict, commit and publication failures. Record source/protocol, protected correlation ID, bytes/limit name, pending age/count, retry outcome, acknowledgement latency and publication lag. Never log records, full commands, credentials or payment details.

Stop promotion for false confirmations, lost intent, changed-ID retries, duplicate accounting, tenant mismatch, privacy resurrection, count/balance mismatch, failed durable storage, unbounded retry/allocation, failed cleanup, mixed protocol-v2 publication or unverified source/build. Retain permanent/conflicting operations for explicit reconciliation. Record actual deployment IDs, SHAs, artifact hashes, timings and adopted client versions. Local synthetic timings do not prove production rollout or configure an alert service; verify the owned alert route under the release gate.

## Interruption and rollback

Partial uploads have no authoritative effect. Reopen under the same account, retain source/identity/revision and resume received chunks. An expired source can begin again with the same manifest; an already committed receipt returns its original result. A lost acknowledgement never justifies a new operation ID. Reconcile current revision before incompatible work.

After commit, delayed/failed publication means management is saved while players are delayed. Retry the existing outbox via the authorized procedure, not the financial action. Privacy-invalidated recovery restarts from a current manifest.

Rollback is a higher verified version retaining compatible checkpoint and pending-cache readers. A flag/old executable must not route oversized venues back to the known 2 MB failure. Preserve server support, committed revisions, outbox/receipts and unresolved intent. Use a forward recovery build if older source cannot read the pending format or save the venue size. Never decrement revisions, rewrite tags, replace released bytes or discard unacknowledged financial/audit work.

The minimum compatible desktop is the first release containing the reviewed bridge commit. Populate its actual version/source/deployment during execution; no installed-version or successful-rollout value is invented here.
