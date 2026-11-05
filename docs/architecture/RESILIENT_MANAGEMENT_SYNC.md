# Resilient management sync

## Completion boundary

The November 3, 2026 incident handoff has two milestones: an emergency whole-state continuity bridge, then durable domain commands and bounded catch-up. This change implements the bridge. **Whole-state saves are not retired; the command redesign is not complete.** A published artifact does not prove that an installed venue upgraded or that its data was validated.

The authority remains the [existing API transaction and publication outbox](AUTHORITATIVE_STATE.md). There is no second datastore, Electron authority, independent Firebase writer, history pruning, or financial last-write-wins policy.

## Write paths

| Path | Boundary |
| --- | --- |
| Desktop business actions, imports, settings, undo | Renderer admission, trusted preload/main IPC, encrypted pending snapshot, negotiated API transport. |
| Browser | Negotiated API transport and protected IndexedDB pending journal for supported operational snapshots. The ordinary browser cache remains memory-only. |
| Legacy clients/API | Existing bounded `POST /state` and compare-and-swap revision semantics remain. New clients never send an oversized envelope through that parser. Installed legacy executables still require a real upgrade. |
| Embedded HTTP | Health, non-authoritative player snapshot and reports. It has no management `/state` authority or relay. Configure browser `VITE_ORBIT_LOCAL_API_URL` to the compatible API. Report limits now count UTF-8 bytes. |
| API-generated changes | Existing payment, membership, player, self-check-in, tournament, recovery and deletion endpoints use the same `saveState` transaction. |
| Publication | The existing durable outbox retries the exact committed revision. Protocol-v2 child writes precede the parent commit marker. Publication failure never repeats the business action. |

## Checkpoint protocol v1

All routes use the existing authenticated `/state` boundary. Authenticated identity binds the tenant; supplied accounts and decoded state must match it.

1. `GET /state/capabilities` advertises `checkpoint.protocol = checkpoint-v1` and fixed budgets.
2. `POST /state/checkpoints` takes `protocol`, `accountKey`, stable `mutationId`, `expectedRevision`, exact UTF-8 `sourceBytes`, `chunkCount`, and lowercase SHA-256 `sha256`. It returns deterministic upload `id`, received indices and expiry. Identical manifests resume; changed content under the same identity fails.
3. `POST /state/checkpoints/:id/chunks/:index` takes account binding and base64 `data`. Reordering and identical duplicate chunks are allowed; changing an acknowledged chunk fails. Partial uploads never replace authoritative state.
4. `POST /state/checkpoints/:id/finalize` verifies lengths/checksums, fatal UTF-8 decoding, JSON/state validation, tenant, expiry and revision. Server-owned fields and privacy tombstones are preserved **inside** the state transaction. State, header, fingerprinted receipt and outbox commit together. Lost responses replay the original receipt.
5. `GET /state/checkpoints/:id?accountKey=...` reports progress. Begin can return a committed result after staging cleanup.
6. `GET /state/checkpoint/:accountKey` returns a header-only recovery manifest without reading/decompressing state chunks. An exact `knownRevision` query returns `notModified`; clients reuse only a previously verified canonical copy. `GET /state/checkpoint/:accountKey/:revision/chunks/:index` returns bounded raw-source chunks for changed revisions. Clients verify tenant, pinned revision, exact bytes and complete-source checksum before hydration. Privacy invalidation rejects older pinned revisions.

Transfer uses identity JSON; clients cannot submit compressed data. Recovery bounds existing gzip output. Legacy account receipts retain their characterized semantics; checkpoint receipts opt into content fingerprints and an internal namespace. The selected transport is persisted before the first request, so an ambiguous legacy request cannot become a different checkpoint operation after an API upgrade.

One active upload slot per tenant bounds resource use. A different active upload receives retryable 429. Newly accepted chunks renew a 60-second idle lease; status requests, begin retries and duplicate chunks do not. An idle upload can be replaced; its original client's durable source remains recoverable. Generation-fenced cleanup uses small batches, preserving concurrent new chunks and Firestore's transaction-size limit.

## Local durability and confirmation

Desktop identity, expected revision, source hash, transport and state are committed together in the existing OS-encrypted cache through a flushed temporary file and atomic replacement. Reads, updates and later saves cannot replace unresolved intent. Only matching acknowledgements clear it. Restart retries the same operation/revision. Fresh credentials may authorize replay only for the same tenant. Unavailable API and confirmed missing account are distinct; only a confirmed missing account permits initialization from cache.

Browser IndexedDB transactions store AES-GCM ciphertext under a non-extractable origin key. Confidential operational data is encrypted. Pilot bearer keys, login/PIN salts and verifiers, and the self-check-in capability value are omitted from the durable projection. Replay requires the original authenticated account/credential binding, rehydrates restricted values in memory, and verifies the original full-source hash. Credential changes, missing keys, corruption and quota failures retain existing intent and fail closed. Storage access is not authentication. Never clear app/site data as recovery.

`ok: true` means authoritative server commit. `pending: true` means this exact attempted projection is durably retained locally and provisional. It never means server acknowledgement. New incompatible actions cannot replace it. The renderer keeps provisional intent and separates management commit from player publication. Background confirmations must match the exact source hash; a late acknowledgement cannot confirm a newer view.

Polling adopts the complete canonical state corresponding to the writer revision, rather than advancing the revision while merging selected collections. Only the currently authenticated pilot context and an unchanged locally verified staff selection survive that adoption. This prevents a later snapshot from erasing unrelated server changes. After a background acknowledgement following an outage, admission remains gated until that canonical read; the existing failure backoff can delay reconciliation for 60 seconds to five minutes. This is a known recovery responsiveness limitation. Do not clear admission or advance the writer revision from the acknowledgement alone.

| Action class | Bridge offline policy |
| --- | --- |
| Inspect loaded room/history; preserve a recovery copy | Available from explicitly non-authoritative cache. |
| Seats, sessions, balances, accounting corrections | No confirmed offline result. One durable provisional snapshot can remain pending; incompatible new work is rejected. This cannot guarantee global occupancy/balances across disconnected devices. |
| Payments, identity, SMS/email or other external effects | Existing online authorization/provider idempotency rules apply; a state transaction does not include a provider call. |
| Browser credentials/PINs | Online credential-safe transfer; restricted values never enter its local journal. |
| Expired authentication | Retain intent and pause; authenticate the original tenant before replay. |
| Validation/revision conflict | Retain intent and stop automatic replay; reconcile explicitly instead of overwriting financial/shared state. |

## Budgets and measurements

| Resource | Limit |
| --- | --- |
| Complete UTF-8 source | 33,554,432 bytes, checked again after server-field preservation |
| Raw chunk/count | 262,144 bytes / at most 128 |
| Complete checkpoint request | 400,000 JSON bytes, including base64 and metadata |
| Authoritative compressed state | Existing 8,000,000-byte budget / 400,000-byte storage chunks; not raised by this bridge |
| Staging | One slot, 128 fixed paths/tenant, 24-hour source expiry, 60-second idle lease; explicit completion/privacy cleanup and asynchronous TTL for abandoned data |
| Desktop | One unresolved snapshot/tenant; aggregate pending source 64 MiB; encrypted-cache admission 128 MiB |
| Browser | One unresolved snapshot/tenant; aggregate ciphertext 32 MiB + 64 KiB; eight tenant slots; no eviction |
| Verified canonical memory | Two accounts per client; eviction refetches canonical data and never evicts pending intent |
| Browser credential work | Two transient snapshots / 64 MiB total; online-only and lost if the tab closes before confirmation, so never described as durably queued |
| Concurrency | Sequential chunks/client; one snapshot assembly/recovery allocation/API runtime, otherwise 429 with retry guidance |
| Delivery | At least once, idempotent effects; exponential backoff/jitter for transient failures, pause for permanent/auth/conflict errors |

These are admission limits, not peak-RSS guarantees or a scalable storage claim. JSON encoding, comparisons, compression and publication still materialize/rewrite bounded snapshots. Idle polls use the header and a verified canonical cache. Recovery of a changed revision rereads/decompresses the source for each returned chunk and can require up to 2,560 Firestore chunk reads at the maximum. History normalization and improved random-access recovery remain scale work.

Optional browser recovery code loads lazily. The existing initial renderer budgets remain 620,000 raw / 190,000 gzip bytes; the original bridge commit `b59a92317f8276bb59b02fef71dea83811e1f04f` measured 611,158 / 188,618 bytes, with its browser recovery chunk loaded only on use. The later emergency integration measured 613,187 raw / 189,407 gzip bytes with the default renderer sync flag in a guarded production-mode build, and also passed with sync disabled. These are local compiler measurements; final candidate CI records its own production artifact. No budget was raised.

Synthetic local evidence from that original bridge commit (not production service levels or verification of the later release integration):

- Real Chromium/IndexedDB + Express/memory store: 3,000 retained ledger rows, 2,676,262-byte initial state, 2,676,768-byte action state, 2,677,529-byte encrypted journal, largest envelope 349,575 bytes. Interrupted upload/process restart resumed in 773 ms; replay after discarded commit acknowledgement returned the original revision in 87 ms with no chunk resends. One business effect, two outbox items including the seed, zero legacy state POSTs; full history retained.
- Twenty direct service save/recovery iterations, 5,000 synthetic ledger rows, 2,209,041 source bytes: save p50 107.72 ms / p95 117.99 ms / max 151.65 ms; full recovery p50 159.13 ms / p95 172.69 ms / max 177.60 ms. HTTP, disk, real Firestore and providers were excluded. Sampled RSS was 49,737,728 bytes initially and at most 156,827,648 bytes; not a true peak-memory measurement.

Production dominant collection, installed versions, venue sizes, p95, publication lag and adoption remain unverified. Collection diagnostics expose counts/bytes, never raw records. Enforce resource admission and observe pending age, latency, cleanup and lag before a release gate.

## Durable command milestone still required

Ordinary actions must stop serializing historical state. Extend the existing authority with bounded versioned domain commands, stable IDs, authenticated tenant binding, entity IDs/preconditions, server ordering and fingerprinted original results. One transaction must validate/apply rules, preserve server fields/privacy, record receipt, advance revisions and enqueue publication. Financial corrections are compensating operations. Retain receipts throughout supported offline replay; old unknown operations need reconciliation.

Each client needs transactional command+optimistic-projection storage with dependencies, schema/retry/ack metadata, capacity warnings and recovery/export. Define command conflict rules and independent scheduling where safe. Add a bounded ordered change feed with cursor deduplication, gap detection, expiry and checkpoint recovery followed by pending reconciliation. Gate legacy writers before they can overwrite command-owned state. Existing chunked storage may remain initially, with full-state rewrite costs reported explicitly.

Exercise the handoff's offline restart, lost-response, multiple-device, wrong-tenant, disk/queue capacity, permanent-command, catch-up-gap, migration/rollback and publication matrix at every command boundary. Extend to **every** mutation path before declaring the overall redesign done.
