# Desktop release 0.1.78 delivery evidence

The user explicitly authorized main integration, dependency repairs, and complete desktop release rollout. The selected stable Windows release is `0.1.78`, built from exact source `12f66e0da803fffea4bc8b1d16e28f4a655bcbdc`. That commit contains only documentation differences from source-fix commit `19fa514220d2b5d740ea695c09978b7c1f95e9f9`. Both [source CI](https://github.com/sahusgupta/orbit/actions/runs/37756609779) and [selected-source CI](https://github.com/sahusgupta/orbit/actions/runs/37757699563) passed their Linux and Windows jobs. Follow [the release runbook](../../operations/RELEASE_AND_ROLLBACK.md); the [dependency review](../reviews/2026-10-08-desktop-release-dependencies.md) records compatible repairs and the bounded Player tooling exceptions.

## Reviewed candidate

[Candidate 37797125349](https://github.com/sahusgupta/orbit/actions/runs/37797125349) completed successfully. Inputs were the exact source above, version `0.1.78`, reason `standard`, channel `stable`, empty rollback target, `promote=false`, and empty confirmation. The promotion job was correctly skipped.

Every source/security/release-control/module-boundary gate, all thirteen aggregate verification checks, the unchanged bundle/public/brand budgets, backward-compatible state/revision migration tests, production management/mutation/OCR/public browser smokes, unsigned Windows packaging, packaged Electron startup, checksums, and executable/ZIP attestations passed. Root unit tests passed 207 files / 1,468 tests with one existing emulator file / eight tests skipped; the separate main CI emulator gate passed. Candidate initial gzip JavaScript was 186,148 bytes against the unchanged 190,000-byte limit.

The immutable candidate artifact is `Orbit-0.1.78-12f66e0da803fffea4bc8b1d16e28f4a655bcbdc-1`, artifact ID `11559952541`, archive digest `sha256:a8425e11ff6a5dd0eb0f167dcda066bcbc866b4fa48306ee5420390b2418c64d`. It was downloaded into an owned ignored review directory. All five SHA-256 entries passed, including installer, ZIP, blockmap, and YAML files. Metadata matched exact source/version/channel/reason/run/attempt. `latest.yml` matched installer bytes, SHA-512, and version; candidate installer size was 141,017,171 bytes.

Both downloaded executable and ZIP passed `gh attestation verify` with repository `sahusgupta/orbit`, signer workflow `.github/workflows/release.yml`, exact source and signer digest `12f66e0da803fffea4bc8b1d16e28f4a655bcbdc`, and denial of self-hosted runners. Verified provenance identified candidate run `37797125349/attempts/1`. An initial ZIP verification hit a transient Sigstore verifier initialization failure; the repeated verification passed with every constraint retained.

## Separate promotion

After the successful candidate was downloaded and reviewed, [promotion 37873129580](https://github.com/sahusgupta/orbit/actions/runs/37873129580) was dispatched with the same source/version/reason/channel/rollback inputs, `promote=true`, and exact confirmation `PROMOTE`. There was no concurrent release run and no existing `v0.1.78` tag. The reviewed `production-release` environment retained its existing sole-maintainer configuration. No security, approval, signing, or deployment setting was changed.

The promotion workflow rebuilt and repeated every gate, verified the checksums of its own immutable artifact, and completed both jobs successfully. It published [Orbit v0.1.78](https://github.com/sahusgupta/orbit/releases/tag/v0.1.78) at API timestamp `2026-10-09T02:26:48Z`. The release is neither a draft nor a prerelease and is GitHub's latest stable release. The tag points directly to the exact selected source `12f66e0da803fffea4bc8b1d16e28f4a655bcbdc`. Rebuilt bytes differ from the first candidate because packaging timestamps differ; the promotion's own evidence was verified against its published assets.

## Published-asset verification

All seven public release assets were downloaded into an owned ignored directory. All five [SHA-256 checksum entries](https://github.com/sahusgupta/orbit/releases/download/v0.1.78/SHA256SUMS.txt) passed. [Release metadata](https://github.com/sahusgupta/orbit/releases/download/v0.1.78/release-metadata.json) matched exact source, version `0.1.78`, `standard`, `stable`, empty rollback target, run `37873129580`, and attempt `1`.

| Published binary | Bytes | SHA-256 |
| --- | ---: | --- |
| Orbit-0.1.78-x64.exe | 141,017,171 | `f6cc3d1db1ad5dac7c5e3fe6d68ea7d8b3b26b179d4390770aa482f33e952936` |
| Orbit-0.1.78-x64.zip | 199,104,754 | `597ff163adbaea93df5fba19cea5c57e012eef2b7e0bb7d069b52d493ee21291` |

The published installer and ZIP both passed strict `gh attestation verify` with the same repository/workflow/source/signer/hosted-runner constraints used for the candidate. Their verified statements additionally identified the exact promotion invocation `37873129580/attempts/1`. No trust or identity constraint was disabled.

Anonymous HTTP checks returned 200 for all seven release assets, with content lengths matching downloaded files. The public stable route `https://github.com/sahusgupta/orbit/releases/latest/download/latest.yml` matched the verified 0.1.78 manifest byte-for-byte. Manifest version/path, installer SHA-512, and installer size matched actual downloaded bytes. Offline inspection of the published ZIP's `resources/app.asar` verified its own package version `0.1.78`, `orbitSourceSha` equal to the selected source, and entrypoint `electron/main.cjs`; no installer or application was run on the developer's live workspace.

The reviewed operator-facing GitHub release notes were published after binary verification. They explain durable seating/time-save outcomes, retained balances/audit history, dependency updates, and the explicit install step. No tag or artifact bytes were replaced. Final repository edits are delivery documentation only; local links and Git whitespace checks validate those edits instead of repeating unrelated code tests after the completed candidate/promotion verification.

## Access and workstation behavior

The initial dispatch was denied because the restricted `GH_TOKEN` overrode an existing saved maintainer login. Selecting that existing login by removing the override only from the temporary command process resolved access. No credential was read, exposed, replaced, or changed; no user permission change was required. The first request under that login also exposed PowerShell's JSON BOM, which was corrected in the ignored dispatch file before a candidate run existed. A later GitHub connectivity failure occurred before promotion dispatch; the checked request was retried successfully.

Scope is the stable GitHub Windows installer/ZIP and desktop updater feed. No API, Firebase rules/indexes, native Player/store, Player Web, or public/download website deployment is included. The existing workflow produces unsigned Windows artifacts. Desktop clients check stable updates at startup and every thirty minutes and download automatically. An operator must select **Install update and restart**; a failed or timed-out state-flush acknowledgement blocks installation. Publication does not prove every workstation installed the update.
