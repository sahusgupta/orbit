# Authoritative State Architecture

## Runtime ownership

Orbit has one authority chain:

1. The API validates identity, tenant scope, mutation ID, payload, and expected revision.
2. A Firebase Admin Firestore transaction commits the compressed state chunks, mutation receipt, new revision, and one publication-outbox item.
3. The response reports the durable Firestore revision and the separate projection-publication state.
4. The API outbox worker is the sole publisher of player-facing Firestore projections and uses sync revision `<account-key>:<revision>`.
5. The protocol-v2 parent club commit marker is written only after every player-facing child batch completes.

Firestore is Orbit's only persistent datastore. The server-only `orbit*` collections are authoritative. The public and player-readable `clubs`, `players`, `games`, and compatibility `clubStates` paths are projections or client-owned records according to the deployed rules; they are not management-state mutation authorities. Electron and browser persistence are offline caches only. The desktop cache is an OS-encrypted JSON file, not a database.

## State layout and write behavior

`orbitAccountStates/{accountId}` stores the current revision and a small manifest. The complete state for each revision is gzip-compressed and split into bounded documents under `stateChunks`. The compressed body is capped below Firestore's transaction-size limit so its chunks, account header, mutation receipt, and outbox record remain one atomic commit.

`orbitAccountStates/{accountId}/mutations/{mutationId}` provides tenant-scoped idempotency. Reusing a mutation ID returns its original revision and does not apply a second body. `expectedRevision` is compare-and-swap: a stale value returns `STATE_REVISION_CONFLICT`, so callers must refresh and intentionally replay or reconcile.

`orbitPublicationOutbox` keeps the checkpoint needed to publish the exact committed revision even after a newer commit. Failed work retains bounded retry metadata and prevents a later revision for the same venue from publishing out of order.

## Existing-state initialization

No relational or file-database migration runs. If an account is absent from `orbitAccountStates`, an authenticated desktop may offer its characterized local cache exactly once through `expectedRevision: 0` and a stable mutation ID. A concurrent initialization is rejected by compare-and-swap rather than overwriting an existing venue. After the Firestore commit succeeds, the local copy remains only an offline cache.

The compatibility `clubStates` projection is not treated as an authority. Older full-state documents may be read only by the existing characterized desktop fallback; initialization still goes through the API transaction and becomes authoritative only after that commit.

Before production promotion, an operator must:

1. Confirm the Firebase project identifier without printing credentials.
2. Deploy the reviewed Firestore rules and indexes.
3. Verify API health and a synthetic non-production revision/idempotency/outbox flow.
4. Confirm each existing card house has either an authoritative `orbitAccountStates` record or a recoverable encrypted desktop cache before relying on owner password controls.
5. Verify outbox publication and protocol-v2 commit markers.
6. Retain the preceding immutable application artifact for rollback. Rollback must never decrement revisions or discard outbox records.

## Publication recovery

Long-running API processes drain the outbox every 30 seconds. Vercel mutations attach the drain to the platform background continuation. An owner-scoped job can call `POST /publications/drain`; `GET /publications` exposes bounded status without payload contents. Missing Firebase Admin credentials fail hosted startup. A failed projection reports `failed`, records a bounded error, and retries the same revision. The desktop distinguishes server-save state from end-to-end projection publication and never labels a cache-only write as synced.

The administrative publication script can only request the owner-protected API outbox drain, so recovery follows the same committed revision path.

## Dependencies and deferred founder decisions

`firebase-admin` is the sole production datastore client. `@vercel/functions` remains server-only and is used narrowly for background continuation of queued publication work. No SQL client or SQL schema exists in the runtime.

Legal/company attribution and production-domain ownership/cutover remain deferred founder decisions. Repository-side work must not change legal attribution, DNS, registrar settings, certificates, the canonical production hostname, or perform a production-domain cutover without later explicit approval.
