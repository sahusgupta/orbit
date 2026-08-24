# Orbit data classification and enforcement

This document turns the Refactor P2 classification into repository controls. It is an engineering control map, not a legal retention policy. Legal/company attribution and production-domain ownership remain deferred founder decisions.

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

`DELETE /player/account` is a resumable server-owned orchestration. It removes the Firebase player login and profile, operational membership/waitlist/tournament/private-game/notification data, anonymizes or deletes authoritative venue references, redacts telemetry, and records progress in `account_deletion_jobs`.

Orbit does not infer a legal retention policy. Production must configure all three explicit dispositions through `ORBIT_ACCOUNT_DELETION_POLICY_JSON`:

```json
{
  "financialRecords": "anonymize",
  "auditRecords": "anonymize",
  "providerRecords": "retain"
}
```

Financial and audit values may be `delete`, `anonymize`, or `retain`. Provider records currently support only `retain`, because Orbit cannot invent a provider/legal deletion obligation or erase provider-controlled records from this repository. The JSON above illustrates the schema only; it is not an approved production policy. `ORBIT_DELETION_PSEUDONYM_SECRET` must also contain an approved secret of at least 32 characters. Until both are configured, deletion fails honestly with `DELETION_POLICY_NOT_CONFIGURED`. A successful response and the Player UI enumerate every retained category and disposition.

## Operational responsibilities

- Credential validity and rotation require authorized access to the relevant provider/secret store. Repository automation must never read or print secret contents.
- Retention durations, legal holds, controller/company attribution, and provider deletion obligations require approved policy outside this document.
- DNS, registrar records, certificates, canonical production hostname, and production cutover are not changed by this architecture.
