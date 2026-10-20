# iPhone App Check team association review

This follow-up records the initial read-only findings and completed Apple-team association for the current [iPhone Map build](./2026-10-13-player-iphone-map-build.md): physical job `3b01935a-9e2e-40fb-8e4e-4c04dace9288`, immutable commit `cbc60d1e65e8e3738da370cce28c38b1c756ed72`, selected source `6d4b38106a72fbaaaa95eb6e7d26067b027bca07693100142dc6cc0b56c71342` /128 and 132-file manifest `9e4f5afc9e146db3330c02f2ff608bf0583aff0daadc0ad57811fd8165aa967d`. Genuine physical attestation remains unverified.

## Read-only findings

Root's normal Firebase 15.29 SDK helper, `node out/read-current-iphone-appcheck-metadata.mjs --run`, exited 0 after four exact GETs. Results were recorded at `2026-10-13T22:39:47Z`; individual request timestamps were not captured. The target was project `tabletalk-s` / `133175572500`, iOS app `1:133175572500:ios:de1514cf1736c1bdfd8f01`, bundle `com.caminuslabs.orbit`.

| Resource | Observed result before the association below |
| --- | --- |
| iOS registration | Exists, `ACTIVE`, bundle matches; `teamIdPresent:false`, `teamMatchesSignedIpa:null`. This is an absent association, not a verified team mismatch. |
| App Attest configuration | Exists with explicit token TTL 3,600 seconds; `usesProviderDefaultTtl:false`. |
| Firebase Authentication service | Exists; `enforcementMode` and `replayProtection` absent (`null`). |
| Cloud Firestore service | Exists; `enforcementMode` and `replayProtection` absent (`null`). |

Absent service fields do **not** establish explicit `OFF` settings or the deployed API's enforcement policy. The current IPA was rehashed; its signed team was used only in child-process memory. No private identifiers were returned or printed. Evidence: `out/player-iphone-appcheck-review/firebase-metadata-readonly.json`.

The Vercel connector's exact approved project/team `get_alias` and environment-list operation with `decrypt:false` both returned `INVALID_ARGUMENT`. API policy values and live deployment policy remain unknown. No fallback CLI environment pull or raw deployment environment read was performed. Evidence: `out/player-iphone-appcheck-review/vercel-connector-readonly.json`.

## Completed team association

The user had explicitly approved this exact new Firebase iOS registration and requested setup help. Root completed its missing team association under that existing registration/setup authorization; automatic command review accepted execution. This did not authorize a new provider, API allowlist or project-wide enforcement policy. The separate helper `out/associate-current-iphone-firebase-team.mjs` was fully reviewed, its uncertainty handling corrected, and syntax/local-only `--plan` checks passed. Its pre-run SHA-256 was `bde481b5827ce596b4077a433d05f7f4489e3bb3ab4deb5fc6c00a34c0811c28`.

1. GET the same app and require `ACTIVE` plus the exact bundle match.
2. If its team is absent, take the team only from the rehashed current signed IPA. An already matching team is a no-op; any different team stops the action.
3. PATCH only `teamId` with `updateMask=teamId` and the current etag, then GET and verify the result.

The actual `--run` exited **0**: `ok:true`, `alreadyAssociated:false`, `patchAttempted:true`, `patchAccepted:true`, `verified:true`, `usedEtag:true`, `errorCategory:none`. The successful same-resource GET verified that the registration now matches the signed package's team, without returning the team value. The result was recorded at **`2026-10-13T22:43:10Z`**; individual request timestamps were not captured. Evidence: `out/player-iphone-appcheck-review/team-association-result.json`. A failed or ambiguous write is never retried automatically; the helper reports uncertainty rather than claiming no mutation.

The provider TTL, other app fields/registrations, service enforcement/replay settings and API policy were preserved. Firebase documents the [App Attest team-ID prerequisite](https://firebase.google.com/docs/reference/appcheck/rest/v1/projects.apps.appAttestConfig) and the [iOS app PATCH resource and update mask](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects.iosApps/patch). Enabling enforcement or changing an API app allowlist remains a separate [App Check boundary](../../architecture/PLAYER_APP_CHECK.md). No iPhone rebuild, new signing or store submission was required or performed.

## Verification and remaining gates

Root prepared and reviewed an HTTP boundary probe using only unsigned GET `/version` and GET `/player/match` at the approved production origin, with exact reviewed release-source checks, bounded responses, no redirects, and no credentials or mutation payloads. Syntax, an inert preparation check and seven pure agent checks passed; the helper's pre-run SHA-256 was `20919d04c04aaa66534908eec3737333ed6895f55e818d96c443b544d8c8cc0f`.

**Automatic approval review rejected that command before process creation. Neither request ran.** The reviewed production `app.js` schedules pending account-deletion and identity-provider cleanup drains on every request. Those existing background jobs could perform destructive work with unknown scope, so the earlier API/iPhone setup authority was insufficient for these checks. Root requested explicit approval for the exact two requests and their background processing; the answer remains pending. No indirect retry or workaround was attempted. Evidence: `out/player-iphone-appcheck-review/api-boundary-attempt.json`. This does not roll back or invalidate the separately verified Firebase team association. The deployed API's actual attestation boundary and new-app allowance remain unverified.

This operational follow-up changed no shipping source and ran no application tests/builds. New unit tests were unnecessary for this field-only registration completion: the existing reviewed IPA parsers are reused, local syntax/inert-plan checks passed, and the actual post-write GET verified the behavioral boundary. The canonical Map record retains the actual `22:09:04.110Z` to `22:12:57.605Z` verification: all 13 gates passed, including 1,887 root tests. Physical installation/interaction, genuine App Attest token and protected-API acceptance, current API allowlist, controlled real-venue acceptance, accessibility and normal-device performance remain unverified. The goal and pilot are not complete.
