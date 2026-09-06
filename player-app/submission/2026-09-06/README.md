# September 6 release evidence

[The release manifest](./release-manifest.json) records actual source, provider, build, and verification identifiers. It is an in-progress record; null/pending fields are not release approvals. The completed simulator artifact comes from an earlier SHA than the current code candidate, as explicitly recorded.

- [App Store metadata, privacy worksheet, reviewer steps, and capture matrix](../../APP_STORE_SUBMISSION.md)
- [Current launch checklist and authority gates](../../LAUNCH_READINESS.md)
- [Execution and failure ledger](../../../docs/agent/tasks/player-release-execution.md)
- [Security regression and secret-scan review](../../../docs/agent/reviews/player-release-security-20260906.md)
- [Compiled privacy-manifest inspection](../../PRIVACY_MANIFEST_AUDIT.md)

Binary archives, provider configuration backups, compiler logs, and sanitized browser captures remain outside version control. Local evidence is under ignored `out/release-20260906/` and `test-results/player-web/screenshots/`. Download GitHub simulator artifacts before their 14-day retention expires. No reviewer password, production token, private key, or real player data belongs here.

Both recorded native builds compiled successfully on earlier SHAs. The GitHub job was cancelled during CoreSimulator runtime discovery and produced no device-flow results or screenshots; compiler success is recorded separately. All eight dedicated Firestore rules tests passed locally using the demo-project emulator and an isolated portable Java runtime.

Rollback targets are preserved in the manifest. Before any alias promotion, verify the immutable candidate's `/health`, `/version`, legal routes, configuration, and authorized synthetic flows. An API/Web critical smoke failure requires restoring its recorded prior deployment. Restore Firestore rules from the recorded ruleset/source backup only after checking compatibility with the still-active clients; do not overwrite provider indexes wholesale or remove unrelated existing configuration.

No signed iOS build or App Store Connect upload exists yet. App Review remains prohibited while the recorded ownership, legal, privacy, production-integrity, or critical QA gates remain open.

## Access and approval gates

| Owner | Exact action and location | Evidence / why human action is required | Blocks |
| --- | --- | --- | --- |
| Repository owner | Answer the pending Codex approval for pushing the verified local release fixes to `sahusgupta/orbit`, branch `codex/player-attestation-release`, existing PR #26. | Automatic approval rejected the push; it did not execute. No alternate transport is authorized by that rejection. | Exact-source CI/native QA, follow-up merge, candidate deployments. |
| Service owner | Answer the three pending Codex questions for CORS OPTIONS probes, Firebase key-resource/restriction metadata in `tabletalk-s`, and metadata-only identification of the production Vercel Firebase credential. | Each operation was separately rejected by automatic approval. The Firebase private key and token values must remain undisclosed. | Production compatibility proof, native key restrictions, safe credential rotation. |
| Caminus Labs, LLC Apple Account Holder | Authenticate the intended team in Apple Developer/App Store Connect and configure its signing/submission access through EAS for `com.orbit.player`; confirm seller identity and accept outstanding agreements. | Existing EAS access has no Apple team/signing credentials or App Store Connect API key. Passwords and MFA codes must be entered in the provider interface. | Signed build, TestFlight upload, App Review. |
| Qualified counsel and venue owner | Supply approved venue/territory authority and the retention/deletion dispositions required by `ORBIT_ACCOUNT_DELETION_POLICY_JSON`, following the [data-classification policy requirements](../../../docs/architecture/DATA_CLASSIFICATION.md). | The production policy variable is absent; the repository example cannot establish legal authority. | Functional account-deletion promotion and public launch/App Review. |
| Privacy owner / Account Holder | Resolve the worksheet's payment-channel, provider/IP retention, and SDK data classifications, then approve the reconciled signed-archive privacy/age/export answers in App Store Connect. | Technical facts and unsigned-archive evidence are prepared; final declarations require an accountable owner and the signed archive. | App Review/public launch. |
| Device holder | Make a compatible iPhone available for the documented TestFlight, camera/PDF417, background/foreground, VoiceOver, and real App Attest checks. | This Windows session has no available Apple device; simulator compilation cannot prove hardware attestation. | Physical-device acceptance and App Review. |
| Product owner / Account Holder | Approve actual captured store screenshots, final copy/rights-holder year, and eventually authorize Submit for Review in App Store Connect. | Screenshots must come from a working candidate; subjective approval and final submission authority cannot be inferred. | App Review. |

Once these prerequisites arrive, the remaining compilation, simulator diagnosis, deployment, credential rotation, synthetic-flow QA, archive inspection, and upload tasks belong to engineering. They have not been reclassified as completed human-only work.
