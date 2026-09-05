# Orbit data classification and enforcement

This document turns the Refactor P2 classification into repository controls. It is an engineering control map, not a legal retention policy. Caminus Labs, LLC is the repository-authoritative operator identity; retention periods, record dispositions, controller roles beyond that identity, and production-domain ownership still require approved decisions.

## Classes

| Class | Examples | Required handling |
| --- | --- | --- |
| Restricted | Firebase Admin, payment, SMS, signing, dashboard-session, machine and pilot credentials; account/staff password and PIN material | Trusted process or approved secret store only; never URL, browser storage, client bundle, telemetry, logs, synced project folders, or Firebase player projection. Rotate on suspected exposure. |
| Confidential | Player contact/profile data, membership and waitlist records, precise operational and financial records, identity-verification state | Tenant/user authorization, minimum collection, encryption at rest where cached, private projection only, redacted logging, classification-aware deletion/anonymization. |
| Internal | Pseudonymous operational metrics, deployment diagnostics, revision/publication status | Authenticated/scoped access, bounded retention, no unnecessary identity fields. |
| Public | Deliberately published club/game summaries, public legal/support pages, static marketing content | Explicit projection and review; absence of a current vulnerability is not treated as completion of a future control. |

## Enforced boundaries

- The durable API database is authoritative. Electron storage is an OS-encrypted offline cache, browser management state is memory-only, and the Player profile uses OS secure storage with a volatile fail-closed fallback.
- Electron's optional management "Stay signed in" record is a separate OS-encrypted user-data file containing only an account key, a one-way fingerprint of the stored login verifier, and the pilot-license expiration. It contains no password, password verifier, Firebase credential, or reusable bearer token; sign-out, credential/license changes, corruption, and expiration invalidate it. An unchecked sign-in remains memory-only and idle-expires after 30 minutes.
- Firebase is a player-safe projection. Only backend publication writes operational projection data; client rules deny projection mutations and scope private records to authenticated recipients.
- Dashboard access uses a short-lived signed HttpOnly/Secure/SameSite=Lax cookie and CSRF header. Machine credentials are tenant, scope, expiry, and rotation-record bound. Owner access uses a distinct credential.
- Telemetry drops current-user payloads, protects stable identifiers, recursively redacts restricted keys, bounds detail size, and stores production stack fingerprints rather than raw stacks.
- Public health and error responses are stable and minimal. Detailed health requires owner authorization.
- Electron privileged IPC validates the sender/frame, bounds payloads, authorizes staff elevation in the main process, and allowlists external HTTPS destinations.
- Local profile, backup, and pilot-key imports enforce byte limits plus extension, MIME, and content/signature checks before whole-file reads.
- The API rejects multipart uploads. Any future upload implementation must first add private non-executable quarantine storage, generated object names, access control, server-side type/signature and size validation, malware scanning, safe download disposition, retention/deletion, and tests. The current absence of an upload endpoint is not recorded as completion of that future storage safeguard.
- `npm run security:paths` checks project path names without opening credential contents. CI runs it on every checkout. Any live local artifact it reports must be inventoried and rotated by an authorized operator, then removed from synced/project directories.

## Account deletion and retention configuration

`DELETE /player/account` is a resumable server-owned orchestration. It removes the Firebase player login and profile, operational membership/waitlist/tournament/private-game/notification data, anonymizes or deletes authoritative venue references, redacts telemetry, and records progress in `orbitAccountDeletionJobs`. A bounded scheduler resumes expired `running` leases from the durable authenticated subject and pseudonym, so a process exit cannot permanently strand an accepted deletion.

Orbit does not infer a legal retention policy. Production must configure all three explicit dispositions through `ORBIT_ACCOUNT_DELETION_POLICY_JSON`:

```json
{
  "financialRecords": "anonymize",
  "auditRecords": "anonymize",
  "providerRecords": "retain"
}
```

Repository-controlled financial and audit values must be `delete` or `anonymize`; raw `retain` is rejected. Provider records currently support only `retain`, because Orbit cannot invent a provider/legal deletion obligation or erase provider-controlled records from this repository. The JSON above illustrates the schema only; it is not an approved production policy. `ORBIT_DELETION_PSEUDONYM_SECRET` must also contain an approved secret of at least 32 characters. Until both are configured, deletion fails honestly with `DELETION_POLICY_NOT_CONFIGURED`. A successful response and the Player UI enumerate every retained category and disposition.

Deletion permanently retains two server-controlled anti-resurrection records: `playerDeletionBlocks/{firebaseUid}` keeps the Firebase Auth UID in its document path so Firestore rules can deny later self-profile writes, while `orbitPlayerDeletionMarkers/deleted_<sha256(uid)>` uses a one-way document identifier for API, webhook, and delayed-provider checks. Clients cannot read or write either collection. The repository defines no deletion schedule for these security records. While cleanup is active, the pseudonym-keyed `orbitAccountDeletionJobs` record temporarily retains the pending Auth UID, an opaque running lease, exact linked identifiers/account keys needed for idempotent retry, and exact sanitized publication revisions. `orbitPublicationFences` temporarily blocks affected accounts from accepting stale projections. A live lease admits one running worker; the bounded server drain can claim an expired lease and resume without another user login. Completion replaces the job payload and removes its UID, lease, cleanup manifest, linked identifiers, and publication requirements.

The server-only `orbitIdentityProviderCleanup` collection is a temporary provider-reference inventory for an Identity session whose creation has not yet been committed to the private Player identity record or whose provider redaction is still pending. It holds deterministic retry parameters, an opaque provider idempotency key, a protected deletion-marker reference, and, when known, the provider session reference. The exact create parameters temporarily include the Firebase immutable subject identifier required by the current Stripe webhook linkage, but omit email and all scanned/verified identity contents. A successful identity transaction deletes its creation intent atomically; an abandoned or deletion-raced creation session is replayed idempotently if necessary and that intent is deleted only after cancellation or redaction is confirmed. A session already linked to the private identity record instead receives a redaction-only intent: provider `processing` and `canceled` states remain pending, and only `redacted` or confirmed resource absence completes it. Confirmed cleanup wakes the durable account-deletion finalizer, including the serverless continuation hook. No retention duration is invented for an unavailable provider: the restricted record remains pending for the bounded opportunistic cleanup worker, is not exposed to clients, and must be treated as an unresolved provider-cleanup item rather than a completed Orbit deletion.

## Operational responsibilities

- Credential validity and rotation require authorized access to the relevant provider/secret store. Repository automation must never read or print secret contents.
- Retention durations, legal holds, controller roles beyond the repository-authoritative operator identity, and provider deletion obligations require approved policy outside this document.
- DNS, registrar records, certificates, canonical production hostname, and production cutover are not changed by this architecture.
