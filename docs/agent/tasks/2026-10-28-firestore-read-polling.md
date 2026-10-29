# Firestore read polling and local iOS build

The user requested a current quota check, rollout of reduced read polling, and a local iOS build instead of EAS cloud build/submission. This authorizes the desktop update and its release process. The user subsequently confirmed that no Mac is available. No Apple signing credentials, billing changes, Firebase data/rules changes, API deployment, or App Store submission are part of this change.

The starting checkout was clean and detached at `55de61d18f9aaa06fc2e5688484c8919656bfdb1`, the previously verified SDK 58 release source. Work proceeds on `codex/reduce-firestore-polling`; the existing release branch and primary checkout are preserved.

## Current quota evidence

Read-only inspection of the existing signed-in Firebase Console showed project `tabletalk-s` / tabletalk-server, default database, on Spark. For the dashboard's October 28–29 PDT quota period, rounded totals were 3.8K document reads and 1K writes, below the documented free allowances of 50K reads and 20K writes per day. Deletes showed no data. The dashboard warns that its metrics can differ from billing/quota accounting. This establishes dashboard headroom, not a successful production API/database probe. No customer documents, credential values, or billing settings were accessed. Narrow evidence is retained in ignored `out/read-polling-20261028/firestore-usage.json`.

The reported stack failed at a Firestore document read. Repository inspection identified a qualifying authenticated desktop session polling `/state/<account>` every three seconds. Each successful positive-revision response reads the account header, publication status, and state chunks. This is a concrete read-amplification candidate; the stack alone does not identify the originating endpoint or prove the production cause.

A separate read-only pinned EAS CLI account-usage check on October 28 Central confirmed `saussy` is still on Free with 15/15 iOS builds used for the October 1–November 1 UTC period. Its renewal is October 31 at 7 p.m. Central. Narrow evidence is in `eas-capacity.json`; no cloud build, submission, or billing change was attempted. Firestore dashboard headroom does not restore EAS capacity.

## Intended change

Only the hosted desktop-state poll cadence changes: a visible desktop performs its initial read, then schedules a new read 30 seconds after completion. Hidden documents pause scheduled reads. Failed, unavailable, or non-authoritative responses retry with bounded exponential delay, and visibility changes retain the retry deadline. Save-pending, stale-response, tenant, authoritative-state, cancellation, and no-overlap safeguards remain in place. The separate browser/local bridge poll is unchanged.

This reduces scheduled refresh frequency by about 90% under steady foreground use; actual Firestore read reduction depends on other operations and the number of documents loaded. Incoming player operations can take up to approximately 30 seconds plus request latency to appear. Existing installations require the desktop update before they gain this behavior.

## Verification and rollout

Runtime checks use loopback services with Firebase sync disabled. No production data is used as a fixture.

- Before changing the polling runtime, the existing merge/race/desktop integration coverage plus additional save-during-read and unmount characterization passed: three files, 29 tests. Log: `out/read-polling-20261028/characterization-before.log`.
- The new scheduling tests failed against the original three-second loop: 11 failed, one passed. This confirms that they distinguish the requested cadence, visibility, and backoff behavior. Log: `polling-regression-before.log` in the same evidence directory.
- The first changed-runtime run passed the new scheduling and race tests but exposed three remaining desktop integration waits tied to the old three-second interval. Those fixtures deliberately return no snapshot initially, so the expected next attempt is now the first 60-second retry. The waits were corrected without changing the state/notification assertions. The normal authoritative notification remains asserted at its exact new 30-second timestamp. Both runs are retained as `focused-after.log` and `focused-after-timing-adjustment.log`.
- An individual `npm run typecheck` initially failed in renderer/test compilation because `ReturnType<typeof window.setTimeout>` selected the ambient Node overload. The timer is now explicitly a DOM numeric identifier, with no assertion, ignored diagnostic, or compiler change. The subsequent focused run passed all four files and 41 tests (`focused-after-timer-type.log`), and all four root TypeScript stages passed (`typecheck-after.log`). The initial type failure remains in `typecheck.log`.
- Independent scheduler review found no actionable issue. Sensitive-path, release-control, independent-lockfile, and module-graph checks passed. Documentation link checks resolved all 17 local targets with zero failures.

The first complete `npm run verify` finished with 12 passing summary checks and the unit check failing: 2,335 passed, four failed, and 16 existing skips. Review had strengthened the integration recovery assertion to reach a retry rather than merely observe its absence. Its first exact-boundary assertion exposed a one-millisecond fixture offset introduced by the mount helper. The fixture now records the failed request's actual timestamp and proves no retry before 60 seconds and exactly one at that deadline. Its standalone rerun passed all 14 tests (`desktop-recovery-timestamp-boundary.log`); the original failure remains in `desktop-recovery-strengthened.log` and the aggregate `verify.log`.

The other three failures are an existing checkout-path limitation in unchanged API static routes. Express's default dotfile filter rejects absolute `sendFile()` paths containing this managed worktree's `.codex` ancestor; API error handling reports 500 for those rejected static assets. Isolated execution reproduced nine passes/three failures. A minimal actual-Express diagnostic confirmed the absolute-path rejection and successful rooted resolution of the same file. No API code or dotfile restriction was changed for this polling task.

The identical API route suite passed all 12 tests from the primary checkout's neutral path under the same CI/loopback/disabled-sync environment. The primary checkout remained clean at `55de61d`; all 125 tracked API/source/public/configuration inputs matched after normalizing line endings (108 byte-identical, 17 line-ending-only differences). Evidence: `server-routes-isolated-1.log`, `server-sendfile-path-diagnostic.json`, `server-routes-neutral-input-comparison.json`, and `server-routes-neutral-control-results.json`. The current managed-path aggregate rerun is retained as `verify-final.log`; this limitation is not described as a local pass. Neutral-path CI and release gates must pass on the exact pushed source before publication.

The complete verification and immutable release workflow results are recorded after execution. The published desktop release must use a new version above the currently published `v0.1.80`; existing installers keep their prior behavior until operators install and restart the update. No installer is installed on a user's behalf by this task.

## Compatible advisory correction

The fresh production dependency scan passed root/API but blocked publication for a newly reported High `re2js` advisory, [GHSA-gg6h-894w-4m9c](https://github.com/advisories/GHSA-gg6h-894w-4m9c), in both Player and Player Web. Their locked Firebase/Firestore dependency chain selected `re2js` 2.8.6 under the existing `^2.8.3` range. The compatible security patch is 2.8.7, with Node >=20 supported by this repository's Node 22.16.0.

Under the user's existing authorization to apply compatible security fixes, only the two `re2js` lock records are updated. Parsed comparison requires every other package record, manifest, and top-level lock value to remain identical. The npm update command initially selected 2.9.1 and reordered Web lock keys; the guard rejected that proposed version before installation, and the two records were narrowed to registry-verified 2.8.7 while preserving original key order. No advisory exception is added: the eight previously accepted Expo tooling entries, reviewed origins, severities, and November 3 review deadline remain unchanged.

Before/after pure compatibility checks exercise actual Firebase Firestore/pipeline imports and normal/lookbehind regular expressions without a Firebase app, database connection, or network operation. Evidence includes the original audits, exact registry metadata, parsed lock comparison, clean-install results, and compatibility logs under `out/read-polling-20261028/`. Full dependency and verification results follow execution below.

Both clean installs passed and preserved their lockfiles. Actual Firestore 4.17.0 imports and regex checks passed before and after the leaf patch in both scopes; all 157 pipeline export names retain the same digest. The focused Web data/profile/auth suite passed three files and 24 tests. The final production advisory gate passed: root/API/Web zero findings; Player only the existing three High/five Low accepted Expo tooling entries. No Critical findings or additional exceptions are accepted. Results: `re2js-remediation-results.json`, `re2js-lock-comparison.json`, and `security-dependencies-after.log`.

## Local iOS build limitation

This host is Windows, and the user confirmed no Mac is available. A supported local production iOS archive requires macOS, Xcode, and the intended Apple Developer signing team. The [local iOS runbook](../../../player-app/LOCAL_IOS_BUILD.md) records the direct Xcode/Apple upload path and production environment requirements. No local IPA or App Store upload is claimed.
