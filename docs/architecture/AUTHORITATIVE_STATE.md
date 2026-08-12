# Authoritative State Architecture

## Runtime ownership

Orbit has one authority chain:

1. The API validates identity, tenant scope, mutation ID, payload, and expected revision.
2. The server-owned database commits normalized state entities, the mutation receipt, the new revision, and one publication-outbox item in one transaction.
3. The response reports the durable server revision and the separate publication state.
4. The API outbox worker publishes the player-facing Firebase projection with the stable sync revision `<account-key>:<database-revision>`.
5. The protocol-v2 parent club commit marker is written only after every child batch completes.

PostgreSQL is required for hosted production and supports multiple API instances. SQLite remains the isolated local/test server adapter. Electron SQLite and browser storage are offline caches; neither is a production authority. Firebase is a realtime projection and is not a venue mutation authority.

## State layout and write behavior

`account_state` stores venue metadata, revision, and a small root manifest. Top-level state arrays are stored as independently hashed records in `account_state_entities`. A save updates only added, changed, moved, or removed entities. The legacy `state_json` column is retained additively for backwards-compatible migration but is cleared to `{}` after the first revisioned commit. The duplicate `account_profiles.raw_json` projection is removed during that commit.

`state_mutations` provides tenant-scoped idempotency. Reusing a mutation ID returns its original revision and does not apply a second body. `expectedRevision` is compare-and-swap: a stale value returns `STATE_REVISION_CONFLICT` with the current revision, so callers must refresh and intentionally replay or reconcile.

`publication_outbox` keeps the versioned checkpoint needed to publish the exact committed revision even after a newer database commit. Publication success clears that payload. Failed work retains it with bounded exponential retry metadata and prevents later revisions for the same venue from publishing out of order.

## Existing-state migration

The schema migration is additive and runs at adapter initialization. Existing `account_state.state_json` records remain readable at revision zero. The first accepted write with `expectedRevision: 0` converts the state transactionally to entity format, records revision one, removes the duplicated profile projection, and creates the first publication job.

For a new durable database, Electron may offer its characterized local state only when the API reports that the account is missing. The import uses revision zero and a stable mutation ID. If another instance already created the venue, compare-and-swap rejects the cache instead of overwriting server state. Firebase is never used as an import authority.

Before a real migration, an operator must:

1. Back up the source database through the approved provider mechanism.
2. Apply the additive schema against a non-production copy and run the migration/revision tests.
3. Configure the durable PostgreSQL URL without printing it.
4. Import each approved tenant through the revision-zero path and verify entity counts and revision one.
5. Verify outbox publication and protocol-v2 commit markers.
6. Retain the source backup until the rollback window closes.

No source data is deleted automatically. Rolling application code back is safe while the legacy columns/tables remain. A rollback must not decrement revisions or discard outbox entries; older clients may read the retained checkpoint only during the reviewed compatibility window.

## Publication recovery

Long-running API processes drain the outbox every 30 seconds. Vercel mutations attach the drain to the platform background continuation. An owner-scoped job can call `POST /publications/drain`; `GET /publications` exposes bounded status without payload contents. Missing Firebase credentials leave work pending rather than claiming cloud success. A failed publication reports `failed`, records a bounded error, and retries the same revision. The desktop shell distinguishes server-save state from end-to-end cloud synchronization and never labels a cache-only write as synced.

The legacy `scripts/publish-firestore-layout.cjs` entrypoint no longer reads arbitrary local/state files or holds an independent Firebase publication capability. It can only request the owner-protected API outbox drain, so administrative recovery follows the same committed revision path.

## Dependency decision

`pg` 8.23.0 is used only in the API runtime for the official PostgreSQL wire protocol and pooling. It is MIT licensed, supports the repository's Node 22 runtime, adds no renderer/player bundle cost, and replaces functionality that the repository did not have. `@vercel/functions` 3.9.2 is Apache-2.0, supports Node 20+, is server-only, and is used narrowly so queued publication work can continue after a serverless response. Both were checked for current package metadata and the API lockfile audit was clean when introduced.
