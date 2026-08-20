# Orbit Incident Response

This runbook covers repository-supported API availability, server-error, authentication-abuse, publication-backlog, and release-promotion signals. It does not authorize production access, deployment, DNS changes, or production-domain cutover.

## Ownership configuration

The operational owner must configure an HTTPS destination in `ORBIT_ALERT_WEBHOOK_URL` and explicitly allowlist its exact hostname (without scheme or path) in `ORBIT_ALERT_WEBHOOK_ALLOWED_HOSTS`. The endpoint must accept an arbitrary JSON `POST` and return a successful response within the API's three-second delivery window. The repository deliberately contains no destination or personal contact. Until an owner configures and verifies that route in an authorized environment, external alert delivery remains incomplete; structured events still reach the runtime log.

Before promotion, verify the route against an alias-withheld production candidate. Send one controlled malformed-JSON request to a public JSON route with a unique redacted request ID, confirm the candidate returns the expected validation error without a state mutation, and confirm the owner receives the matching `api-error` notification. Record only the UTC time, candidate identifier, event name, and request ID; never record the webhook URL or its secret path.

The production host, DNS/registrar owner, certificate owner, legal entity/controller attribution, and cutover decision remain founder-deferred. Do not infer them from preview or API hosts.

## Signal and response matrix

| Signal | Initial severity | First response | Escalation |
| --- | --- | --- | --- |
| API error event or availability probe failure | Critical | Correlate by request ID/error reference, confirm scope without exposing payloads, and stop promotion. | Page the configured engineering owner; involve the datastore owner if durable reads/writes fail. |
| Authentication-abuse/rate-limit event | Warning | Inspect redacted limiter and identity reference, preserve audit data, and check for a distributed pattern. | Escalate repeated or cross-tenant patterns to the security owner. Never rotate credentials from an unreviewed client. |
| Publication outbox retry/backlog | Warning, Critical if sustained | Confirm the durable commit remains authoritative, inspect revision/attempt state, and keep the backend as sole publisher. | Escalate to the API/Firebase owner. Do not enable Electron or browser publication as a bypass. |
| Release verification, signature, or promotion failure | Critical | Do not promote. Retain the immutable artifact and verification logs. | Escalate to the release owner; roll back only through the approved immutable channel. |
| Release workflow or promotion-control failure | Critical | Keep the candidate unpromoted and correlate the exact source SHA, version, workflow run, and failed gate. | Review the immutable evidence and solo-maintainer confirmation; never retry through a direct publish command. |

## Triage

1. Record UTC start time, environment, immutable release identifier, request/error references, and affected tenant references. Never paste credentials, raw player data, request bodies, or stack traces into the incident channel.
2. Check the minimal health response and provider dashboards only with authorized read access. Do not use production credentials from a browser or project directory.
3. Distinguish durable database health from Firebase projection health. A projection failure must remain retryable and visible; it must not trigger a second state commit.
4. For suspected data corruption or authorization bypass, stop promotion and mutation traffic through the approved control plane. Preserve evidence and do not run cleanup scripts.
5. Communicate user impact and known scope without guessing. State explicitly when the production domain or alert route has not been owner-verified.

## Recovery and closure

- Use the verified roll-forward rollback procedure in `docs/operations/RELEASE_AND_ROLLBACK.md`: build a new higher version from a known-good source commit. Database changes must remain backward-compatible with both source versions involved.
- Verify durable revision continuity, outbox drain state, player-safe publication, authentication/session behavior, and critical smoke flows before restoring promotion.
- Close only after the configured owner acknowledges the alert, affected services are stable, monitoring remains clear for the agreed observation window, and follow-up work has an owner.
- Run an alert delivery test and a rollback rehearsal only in an explicitly authorized non-production environment. Record the result without embedding destination URLs or credentials.
