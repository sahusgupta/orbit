# September 6 release evidence

[The release manifest](./release-manifest.json) records actual source, provider, build, and verification identifiers. It is an in-progress record; null/pending fields are not release approvals. The completed simulator artifact comes from an earlier SHA than the current code candidate, as explicitly recorded.

- [App Store metadata, privacy worksheet, reviewer steps, and capture matrix](../../APP_STORE_SUBMISSION.md)
- [Current launch checklist and authority gates](../../LAUNCH_READINESS.md)
- [Execution and failure ledger](../../../docs/agent/tasks/player-release-execution.md)
- [Security regression and secret-scan review](../../../docs/agent/reviews/player-release-security-20260906.md)
- [Compiled privacy-manifest inspection](../../PRIVACY_MANIFEST_AUDIT.md)

Binary archives, provider configuration backups, compiler logs, and sanitized browser captures remain outside version control. Local evidence is under ignored `out/release-20260906/` and `test-results/player-web/screenshots/`. Download GitHub simulator artifacts before their 14-day retention expires. No reviewer password, production token, private key, or real player data belongs here.

Rollback targets are preserved in the manifest. Before any alias promotion, verify the immutable candidate's `/health`, `/version`, legal routes, configuration, and authorized synthetic flows. An API/Web critical smoke failure requires restoring its recorded prior deployment. Restore Firestore rules from the recorded ruleset/source backup only after checking compatibility with the still-active clients; do not overwrite provider indexes wholesale or remove unrelated existing configuration.

No signed iOS build or App Store Connect upload exists yet. App Review remains prohibited while the recorded ownership, legal, privacy, production-integrity, or critical QA gates remain open.
