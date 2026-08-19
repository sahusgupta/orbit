# Orbit release and rollback

Pushes and merges are integration events, not production releases. `.github/workflows/release.yml` is manual-only and separates candidate verification/packaging from promotion. Running or approving that workflow is a production-facing action and requires separate authorization; this document does not grant it.

## Required GitHub controls

Repository owners must create one protected environment before any release:

- `production-release` requires independent review before the already-verified artifact can be promoted. Limit deployment branches/tags according to the founder-approved release policy.

The GitHub release workflow currently creates unsigned Windows artifacts and does not require signing credentials. It explicitly disables certificate autodiscovery and Electron Builder's code-signing requirement for that workflow invocation, while retaining immutable-source validation, the complete code and production-smoke gates, SHA-256 checksums, GitHub artifact attestations, and protected promotion. Operators should expect Windows to identify these artifacts as coming from an unknown publisher until signing is introduced in a separately approved change.

## Candidate and promotion sequence

1. Select an exact reviewed 40-character source commit, a new stable semantic version, a canary or stable channel, and the standard or rollback reason. Never reuse a version or tag.
2. Dispatch with `promote=false` when a separately reviewed candidate is required before promotion.
3. The workflow installs the root, API, native Player, and Player Web lockfiles and runs sensitive-path, advisory, release-control, module-boundary, packaged-runtime closure, full TypeScript/unit/build, bundle/public/brand, and production-bundle browser gates.
4. It creates an unsigned artifact with publishing disabled and boots the packaged Electron executable against an isolated loopback renderer with hosted API, Firebase, embedded-backend, and updater activity disabled. It then records SHA-256 checksums plus source/version/run metadata, creates a provenance attestation, and uploads a uniquely named immutable workflow artifact.
5. Review the run, attestations, checksums, smoke output, change scope, and operational readiness. A canary is promoted as a GitHub prerelease; normal clients have prerelease updates disabled. Validate it only on explicitly selected non-production/canary workstations.
6. Dispatch the same approved inputs with `promote=true`. The build is reproduced and its checksums are reverified, then the separate `production-release` approval controls GitHub release creation. Promotion failure never falls back to an unverified file.
7. Observe structured API/desktop signals and the configured owned alert route for the agreed window before broadening exposure. The repository cannot certify that external route until its owner configures and tests it in an authorized environment.

The application downloads an approved stable update but never installs it merely because a download completed or the app exits. An operator must choose **Install update and restart**. Orbit first requests a current renderer-state flush; a missing, failed, or timed-out acknowledgement blocks restart and leaves the update available for retry.

## Rollback is a verified roll-forward

Desktop auto-updaters and data schemas make version downgrades unsafe. Rollback therefore means a new, monotonically higher release version built from an exact previously verified known-good source SHA:

1. Stop further promotion and identify the known-good commit and affected version from immutable metadata.
2. Confirm that the known-good source can read every schema written by the affected release. Orbit database changes must remain additive/backward-compatible across the supported rollback window; destructive schema removal requires a separately approved expand/migrate/contract sequence.
3. Dispatch a new candidate with `release_reason=rollback`, `rollback_of` set to the affected version, the known-good SHA, and a never-used higher version.
4. Run every normal gate. Start with canary, verify authoritative revision continuity, publication outbox recovery, authentication/session behavior, and critical management/public paths, then obtain the production promotion approval.
5. Preserve both release records and incident references. Do not rewrite tags, replace artifact bytes, force-push, or bypass checksum/provenance checks.

The release gate explicitly exercises current legacy-state migration and revision/conflict tests through the complete test suite. A future database change must add forward and backward compatibility characterization at the migration boundary before it may use this channel.

## Public and API deployments

The static public bundle and API must follow the same exact-source, full-gate, immutable-candidate, protected-promotion, health-observation, and known-good roll-forward model at the selected hosting provider. Provider traffic splitting may be used for canary/blue-green promotion only after an owner supplies authorized non-production and production environments. No provider, final hostname, domain owner, DNS, certificate, or cutover value is inferred here. Repository-side SEO work continues through centralized origin configuration; production-domain ownership and cutover remain founder-deferred.

The API and Player Web package manifests pin Node 22.x so their Vercel builds use the same major runtime as CI. Do not promote a deployment whose build log selects a different Node major without first reproducing the full gates on that runtime.

## Abort conditions

Do not promote if verification is red, checksums/attestation are absent, the candidate source or version differs, database compatibility is unproven, the owned alert path is unverified, critical smokes are noisy, or a required environment reviewer has not approved. Record the failure through the incident runbook; never repair a release by replacing bytes under an existing version.
