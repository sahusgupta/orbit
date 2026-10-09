# Desktop release 0.1.79 delivery evidence

[Orbit v0.1.79](https://github.com/sahusgupta/orbit/releases/tag/v0.1.79) is published as the latest stable Windows desktop release. The corrected exact-source candidate and separate promotion passed every gate; published binary integrity, provenance, package identity, anonymous downloads, and the stable updater feed were independently verified. The initial promotion failure and its test-only correction are retained below.

## Source and integration

The initial release attempt selected exact source and workflow digest `9b005cae7e1afe6ea7a9209290054d9e6978b144` on `fix/desktop-modal-input-focus`. [PR 30](https://github.com/sahusgupta/orbit/pull/30) merged into main at `2026-10-09T09:34:46Z`, producing `343ccbdd953a58e3bf3f589ac0b7f727957294bf`; its full tree is identical to that initial source. [PR CI 37911272859](https://github.com/sahusgupta/orbit/actions/runs/37911272859) and [main CI 37912180583](https://github.com/sahusgupta/orbit/actions/runs/37912180583) both passed.

The final selected source and workflow digest is `77373a62f160bfdc70a06eaa151d84be347d4d70` on pushed branch `fix/command-focus-release-test`. Its only difference from the initial source is the test synchronization repair in `src/components/AppShell.test.tsx` (nine insertions / five deletions). [PR 31](https://github.com/sahusgupta/orbit/pull/31) merged at `2026-10-09T10:22:26Z` into main `842e90fa1e3f6f11be452dea45f5e32f5cf2f769`, after both jobs of [corrected-source CI 37916302411](https://github.com/sahusgupta/orbit/actions/runs/37916302411) and GitGuardian passed. The fetched main tree is identical to the selected corrected source. [Post-merge main CI 37917198483](https://github.com/sahusgupta/orbit/actions/runs/37917198483) completed successfully at that exact main SHA.

The [focus regression record](2026-10-09-desktop-input-focus.md) documents the fix and its native keyboard reproduction. Follow [the release runbook](../../operations/RELEASE_AND_ROLLBACK.md) and retain [the existing dependency review](../reviews/2026-10-08-desktop-release-dependencies.md). The release preserves the prior durable mutation fix, API/data shapes, security boundaries, and state/sync behavior.

## Superseded initial candidate

[Initial candidate 37911428106](https://github.com/sahusgupta/orbit/actions/runs/37911428106) completed successfully with the initial source above, version `0.1.79`, reason `standard`, channel `stable`, empty rollback target, `promote=false`, and blank confirmation. Promotion was correctly skipped. Its evidence remains valid for that source but is superseded for the final release by the test-only correction described below; it does not prove the final corrected source or final published artifact.

All thirteen aggregate verification gates passed. Root unit tests passed 208 files / 1,480 tests, with the existing one-file/eight-test Firestore emulator skip. Player Web passed 20 files / 209 tests; sales-map passed seven files / 85 tests. Security paths, release controls, module boundaries, production-dependency policy, bundle/public/brand budgets, migration rehearsal (three files / 12 tests), production management/mutation/focus/OCR/public smokes, unsigned Windows packaging, and isolated packaged Electron startup passed. Native focus smoke passed all fourteen scenario groups, including repeated Quick Add commands and successful cash-out restoration.

Initial JavaScript was 607,099 bytes / 187,383 gzip bytes against unchanged limits of 620,000 / 190,000. The desktop build retained existing ExcelJS eval and large-chunk warnings. Dependency-policy success includes eighteen reviewed native Player high-severity exceptions due for review on `2026-10-22`; it does not mean every dependency is advisory-free. Expected isolated mutation conflict, rejected oversized payload, and undelivered test-alert output preceded the mutation smoke pass.

The immutable artifact is `Orbit-0.1.79-9b005cae7e1afe6ea7a9209290054d9e6978b144-1`, artifact ID `11608020310`, archive digest `sha256:4185b69e18a44596ee7ffa19a74389f29bc3a62046638a538fa0ccaad86d09e8`. It was downloaded into an owned ignored review directory. All five SHA-256 entries passed, covering installer, ZIP, blockmap, and both YAML files. Metadata matched source/version/channel/reason/run/attempt. `latest.yml` matched version/path, installer size, and SHA-512. Offline packaged identity inspection passed; no installer or live workstation application was launched.

| Candidate binary | Bytes | SHA-256 |
| --- | ---: | --- |
| Orbit-0.1.79-x64.exe | 141,017,555 | `414e061ffdf989591df6d651ed3df895a383783aa36353e0e6b9a8684330fdde` |
| Orbit-0.1.79-x64.zip | 199,106,040 | `f9f3a1e40b185c11a82d64c5b17ca8668704242ad47b3d20fdc04f776fadc305` |

Both binaries passed strict provenance verification with repository, signer workflow, exact source/signer digest, and hosted-runner constraints retained:

```text
gh attestation verify <installer-or-zip> --repo sahusgupta/orbit --signer-workflow sahusgupta/orbit/.github/workflows/release.yml --source-digest 9b005cae7e1afe6ea7a9209290054d9e6978b144 --signer-digest 9b005cae7e1afe6ea7a9209290054d9e6978b144 --deny-self-hosted-runners --format json
```

Each saved verified statement identified invocation `https://github.com/sahusgupta/orbit/actions/runs/37911428106/attempts/1`. No trust or identity constraint was disabled.

## First promotion aborted before publication

[First promotion 37914102116](https://github.com/sahusgupta/orbit/actions/runs/37914102116) was dispatched at `2026-10-09T09:52:53Z` on the initial exact source/workflow ref, version, reason, stable channel, and empty rollback target, with `promote=true` and confirmation `PROMOTE`. It failed the root unit gate: the AppShell pointer-opener restoration test observed `BODY` instead of its exact command trigger. Root unit results were 1,479 passed / one failed / eight existing emulator tests skipped. All twelve other aggregate verification checks passed. Later packaging and publication were skipped; this attempt created no release.

Two independent reviews of installed React and Radix confirmed a test synchronization race: the test awaited its zero-delay timer inside async `act`, before the close commit could schedule Radix's own deferred restoration timer. The correction changes only [AppShell.test.tsx](../../../src/components/AppShell.test.tsx): commit Escape synchronously, then use the existing default `vi.waitFor` bound to require both dialog removal and the exact expected opener. Draft value, node identity, continued editing, and exact selection/caret assertions remain intact. Teardown now commits unmount before draining deferred cleanup. No runtime behavior, assertion, or timeout limit was weakened.

The initial focused rerun stopped before tests because the sandbox denied esbuild's ancestor-directory traversal. The approved local Vitest entrypoint then passed the six focused AppShell tests twice, and strict root TypeScript passed. Full `npm run verify` passed all thirteen gates: root unit results were 208 passed files / 1,480 passed tests with the same eight emulator skips; Player Web passed 209 tests and sales-map passed 85 tests. The final release must use the exact corrected source and newly reviewed candidate, followed by a separate successful promotion. No final-source provenance is inferred from the initial candidate.

## Final reviewed candidate

Both runs repeated every gate and verified their own immutable artifacts. The successful promotion published through the existing `production-release` environment. Rebuilt bytes differ because packaging timestamps differ; the successful promotion's own published bytes were verified separately.

[Final candidate 37916303470](https://github.com/sahusgupta/orbit/actions/runs/37916303470) was dispatched at `2026-10-09T10:13:47Z` with exact corrected source/workflow digest `77373a62f160bfdc70a06eaa151d84be347d4d70`, version `0.1.79`, reason `standard`, channel `stable`, empty rollback target, `promote=false`, and blank confirmation. It completed successfully; promotion was correctly skipped. Its immutable artifact is `Orbit-0.1.79-77373a62f160bfdc70a06eaa151d84be347d4d70-1`, artifact ID `11611231726`, archive digest `sha256:45c912a7839ff3ad4198a24e4c89ab6564a678ebab793611513030e0f0658f04`.

Independent review of this corrected-source workflow log confirmed all thirteen aggregate gates passed, including six AppShell tests. Root unit results were 208 files / 1,480 tests passed with the existing one-file/eight-test emulator skip; Player Web passed 20 files / 209 tests and sales-map seven files / 85 tests. Migration rehearsal passed three files / 12 tests. Management, mutations, all fourteen Electron focus groups, OCR, public smoke, and isolated packaged startup passed. Initial JavaScript remained 607,099 bytes / 187,383 gzip bytes against unchanged limits of 620,000 / 190,000. Warning classes and the eighteen reviewed Player dependency-policy exceptions were unchanged. Separate PR CI passed the eight emulator tests.

Downloaded final-candidate assets passed all five SHA-256 entries. Metadata matched exact corrected source, stable `0.1.79`, run `37916303470`, and attempt `1`. `latest.yml` matched installer path, size 141,017,521 bytes, and SHA-512. Offline ZIP inspection verified `resources/app.asar` package version `0.1.79`, `orbitSourceSha` equal to the corrected source, entrypoint `electron/main.cjs`, the configured public stable GitHub updater, and eleven compiled focus markers. No installer or workstation application was launched.

| Final candidate binary | Bytes | SHA-256 |
| --- | ---: | --- |
| Orbit-0.1.79-x64.exe | 141,017,521 | `ef1e27899d13abc88552bd26876c8e00613e64f820ce0a80b39e62655e8a8a28` |
| Orbit-0.1.79-x64.zip | 199,106,044 | `e08da3f269464f08c66110bbd5cba1315f6f6c961b2a25672aad29188e1dfe2d` |

Both final-candidate binaries passed the same strict `gh attestation verify` constraints shown above, with `--source-digest` and `--signer-digest` set to `77373a62f160bfdc70a06eaa151d84be347d4d70`. Saved verified statements identified exact invocation `https://github.com/sahusgupta/orbit/actions/runs/37916303470/attempts/1`, signer workflow `.github/workflows/release.yml`, and GitHub-hosted runners. No trust or identity constraint was disabled.

## Final stable promotion and publication

[Stable promotion 37918835200](https://github.com/sahusgupta/orbit/actions/runs/37918835200) was dispatched at `2026-10-09T10:38:29Z` after reviewing the corrected source, confirming no concurrent release run, and confirming `v0.1.79` was unused. Inputs exactly matched the reviewed final candidate except `promote=true` and confirmation `PROMOTE`. Both the verification/package job and the explicit promotion job completed successfully. Independent log review confirmed all thirteen aggregate gates, all fourteen native Electron focus groups, mutation/migration smokes, and packaged startup passed again. The promotion downloaded its own artifact and reverified checksums before publication. No release, approval, signing, or security setting was changed.

GitHub published the release at API timestamp `2026-10-09T10:57:11Z`. It is neither a draft nor a prerelease and is the latest stable release. The tag points directly to exact selected source `77373a62f160bfdc70a06eaa151d84be347d4d70`.

## Published assets and updater verification

All seven release assets were downloaded into an owned ignored review directory: installer, ZIP, installer blockmap, `latest.yml`, `builder-debug.yml`, `release-metadata.json`, and `SHA256SUMS.txt`. All five [SHA-256 entries](https://github.com/sahusgupta/orbit/releases/download/v0.1.79/SHA256SUMS.txt) passed. [Release metadata](https://github.com/sahusgupta/orbit/releases/download/v0.1.79/release-metadata.json) matched exact source, version `0.1.79`, `standard`, `stable`, empty rollback target, run `37918835200`, and attempt `1`.

| Published binary | Bytes | SHA-256 |
| --- | ---: | --- |
| Orbit-0.1.79-x64.exe | 141,017,485 | `3cd5099b7bd55376dbf58600f0b9fd01fbbdf1bf8bb409fc1d66bb0214c85450` |
| Orbit-0.1.79-x64.zip | 199,106,044 | `4b9c6c782c1835b90773566253163eacbe4afec52b16831dd8517b688871498c` |

Both published binaries passed strict provenance verification with the same repository, release-workflow, exact source/signer digest, and hosted-runner constraints used for the final candidate. Verified statements identified exact invocation `https://github.com/sahusgupta/orbit/actions/runs/37918835200/attempts/1`. No trust or identity constraint was disabled.

Offline inspection of the published ZIP verified package version `0.1.79`, exact `orbitSourceSha`, entrypoint `electron/main.cjs`, the public stable GitHub updater configuration, and all eleven compiled fix markers. Its extracted ASAR SHA-256 was `4c640b722b43b3b35ffd2e88dba30d6d4225564df85743db575e9c8790255146`, identical to the reviewed final candidate's ASAR. The installer and ZIP container hashes differ from the candidate because packaging timestamps differ.

Anonymous checks returned HTTP 200 for every public asset with content lengths matching the downloaded files. Public latest/tag APIs and the tag reference confirmed the same stable release and source. The stable [latest updater manifest](https://github.com/sahusgupta/orbit/releases/latest/download/latest.yml) matched the verified 338-byte manifest byte-for-byte; version, installer path, size, and SHA-512 matched actual installer bytes. The anonymous Atom feed contained the exact `v0.1.79` release entry. All public checks passed on the first attempt without a retry or skipped check.

Reviewed operator-facing release notes were published after binary and public-feed verification and read back successfully. They describe the input fixes, preserved durable mutation behavior, and explicit installation step. No tag or artifact bytes were replaced. Final repository edits are delivery documentation only; local-link validation and Git whitespace checks cover those edits after the completed local, candidate, and promotion verification.

## Client behavior and scope

The existing release model produces unsigned Windows installer/ZIP assets; attestation does not claim Authenticode signing. Scope is the stable GitHub desktop release and updater feed. No other service, API, Firebase, Player/store, Player Web, or website deployment is included. This record does not certify an external alert route or installation on any workstation.

Packaged clients check stable updates at startup and every thirty minutes and download automatically. Operators must select **Install update and restart**. A missing, failed, or timed-out renderer-state flush acknowledgement blocks installation. Publication alone does not prove workstation rollout.
