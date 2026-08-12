# Orbit release and rollback

Pushes and merges are integration events, not production releases. `.github/workflows/release.yml` is manual-only and separates candidate verification/signing from promotion. Running or approving that workflow is a production-facing action and requires separate authorization; this document does not grant it.

## Required GitHub controls

Repository owners must create two protected environments before any release:

- `desktop-release-signing` holds `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. Restrict secret access and require an approved release operator.
- `production-release` requires independent review before the already-verified artifact can be promoted. Limit deployment branches/tags according to the founder-approved release policy.

The signing certificate and password must never enter renderer code, repository files, workflow logs, or artifacts. `electron-builder` has `forceCodeSigning` enabled, and the workflow independently requires every emitted installer signature to be `Valid` before upload and again before promotion.

## Candidate and promotion sequence

1. Select an exact reviewed 40-character source commit, a new stable semantic version, a canary or stable channel, and the standard or rollback reason. Never reuse a version or tag.
2. Dispatch with `promote=false`. The signing environment approval unlocks only the signing job.
3. The workflow installs all three lockfiles and runs sensitive-path, advisory, release-control, module-boundary, full TypeScript/unit/build, bundle/public/brand, and production-bundle browser gates.
4. It creates a signed artifact with publishing disabled, verifies Authenticode, records SHA-256 checksums plus source/version/run metadata, creates a provenance attestation, and uploads a uniquely named immutable workflow artifact.
5. Review the run, attestations, signatures, smoke output, change scope, and operational readiness. A canary is promoted as a GitHub prerelease; normal clients have prerelease updates disabled. Validate it only on explicitly selected non-production/canary workstations.
6. Dispatch the same approved inputs with `promote=true`. The build is reproduced and reverified, then the separate `production-release` approval controls GitHub release creation. Promotion failure never falls back to an unsigned or unverified file.
7. Observe structured API/desktop signals and the configured owned alert route for the agreed window before broadening exposure. The repository cannot certify that external route until its owner configures and tests it in an authorized environment.

The application downloads an approved stable update but never installs it merely because a download completed or the app exits. An operator must choose **Install update and restart**. Orbit first requests a current renderer-state flush; a missing, failed, or timed-out acknowledgement blocks restart and leaves the update available for retry.

## Rollback is a verified roll-forward

Desktop auto-updaters and data schemas make version downgrades unsafe. Rollback therefore means a new, monotonically higher release version built from an exact previously verified known-good source SHA:

1. Stop further promotion and identify the known-good commit and affected version from immutable metadata.
2. Confirm that the known-good source can read every schema written by the affected release. Orbit database changes must remain additive/backward-compatible across the supported rollback window; destructive schema removal requires a separately approved expand/migrate/contract sequence.
3. Dispatch a new candidate with `release_reason=rollback`, `rollback_of` set to the affected version, the known-good SHA, and a never-used higher version.
4. Run every normal gate. Start with canary, verify authoritative revision continuity, publication outbox recovery, authentication/session behavior, and critical management/public paths, then obtain the production promotion approval.
5. Preserve both release records and incident references. Do not rewrite tags, replace artifact bytes, force-push, or bypass signature/provenance checks.

The release gate explicitly exercises current legacy-state migration and revision/conflict tests through the complete test suite. A future database change must add forward and backward compatibility characterization at the migration boundary before it may use this channel.

## Public and API deployments

The static public bundle and API must follow the same exact-source, full-gate, immutable-candidate, protected-promotion, health-observation, and known-good roll-forward model at the selected hosting provider. Provider traffic splitting may be used for canary/blue-green promotion only after an owner supplies authorized non-production and production environments. No provider, final hostname, domain owner, DNS, certificate, or cutover value is inferred here. Repository-side SEO work continues through centralized origin configuration; production-domain ownership and cutover remain founder-deferred.

## Abort conditions

Do not promote if verification is red, signing/attestation is absent, the candidate source or version differs, database compatibility is unproven, the owned alert path is unverified, critical smokes are noisy, or a required environment reviewer has not approved. Record the failure through the incident runbook; never repair a release by replacing bytes under an existing version.
