# Player release security review — September 6, 2026

Review remains in progress on `codex/player-attestation-release`, following the external merge of PR #25 at `5b5b18ec92ed94feb125eb8afd0a0140fdfb4ff8`. This record is evidence of the work listed here, not approval of every original PR hunk or production promotion.

## Reproduced persistence and session defects

1. `saveState` queued legacy/global receipt writes before reading the publication record on duplicate retries. The Admin SDK adapter forwards writes immediately; Firestore prohibits subsequent transaction reads. Three isolated regressions enforcing that actual ordering all failed before the fix and passed afterward. Reads now precede all receipt migration writes; duplicate results and persisted receipt shapes remain unchanged.
2. `invalidateAccountStateHistory` deleted every state chunk except the selected revision. A newer revision committed after the deletion boundary could lose its chunks while its authoritative header remained current. A regression reproduced the missing-state error. Cleanup now deletes only revisions older than the boundary, preserving both the sanitized boundary and newer commits. The regression also verifies that the old revision is removed.
3. Successful QR redemption responses could apply the prior venue's state after the staff session changed while the request was in flight. A deferred-response regression reproduced this. The response now requires the initiating session to remain current before state or player information is applied. Transport failure copy no longer falsely guarantees that no check-in occurred. The 45 QR/bridge/composition checks pass.
4. Firestore REST `batchWrite` HTTP success was incorrectly treated as acknowledgement of every write. [The provider contract](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchWrite) makes each write independently successful or failed. All 21 existing publisher tests passed before the change; 12 new failure/malformed-response regressions then failed against the old implementation. Every batch now requires exactly one valid successful status per write. Errors contain protected references, never provider messages or paths. All 36 publisher tests pass, including real publisher orchestration with local signing/transport doubles: failed projection or cleanup writes never publish the parent commit marker; complete acknowledgement publishes that marker last.

The initial concurrency fixture was placed before an existing ordered publication test, affecting that test's queue. Moved the independent fixture after the existing sequence. The combined state, publication-fence, deletion, and presentation suite then passed 66 tests. The later final aggregate verification passed; exact-source remote CI remains pending.

## Native and browser presentation checks

The iOS v1 screen now exposes email/password authentication only, because production SMS delivery is not provisioned. Existing authenticated phone-account compatibility remains unchanged. The account controller rejects a phone-start action before contacting a provider. Onboarding exposes explicit VoiceOver labels and disabled/checked states. Rendered/authentication checks pass; the presentation digests were updated only after reviewing these intentional changes, while style digests remain unchanged.

Local public-site smoke passed eight routes at desktop/mobile sizes. The first new Player Web smoke completed 90 captures and 42 interaction checks but failed five cold homepage content checks. Inspection showed the essential heading and action start at opacity zero, including in the server HTML. The homepage now renders those elements with opacity one, verified by a real server-render regression. The browser harness waits for actual readable content and fonts while retaining its content/layout assertions.

The next browser run cleared all existing checks but failed two newly added no-JavaScript heading/action assertions. Inspection of the compiled HTML showed Next's streamed page sits in a hidden `S:0` boundary until its script runs, independently of the corrected hero. The application now provides a visible no-JavaScript explanation and a direct static Privacy Policy link outside that boundary; the two browser assertions exercise this fallback. The separate server-render regression retains the heading/action opacity requirement. The corrected browser run passes all 15 routes, six viewports, 90 captures, and 44 interactions.

The subsequent aggregate run passed every check except API TypeScript, which correctly rejected the incomplete `crypto.Sign` test double. Replaced it with a real Sign object whose signing method is stubbed; no key or provider request is used. Focused API typing and 36 publisher tests pass. Final `npm run verify` passes all 13 checks: 1,328 root/API/Player tests, 205 Web tests, and 85 sales-map tests; eight emulator tests remain separate CI checks. Both focused staged Gitleaks scans passed with zero findings (13.57 KB integrity diff, 16.12 KB UI/QA diff).

## Repository history scan

Downloaded official Gitleaks `v8.30.1` and verified its Windows x64 archive against the upstream checksum file. Tooling and the fully redacted report stay under ignored `out/release-20260906/`. No scanner exclusions, history rewrites, or credential validation requests were used.

Command: `gitleaks git . --log-opts=--all --redact=100 --report-format=json --report-path=out/release-20260906/gitleaks-history-redacted.json --no-banner --no-color`.

The first invocation encountered Git's repository-ownership check, scanned zero commits, and nevertheless exited zero. It is **not a passing scan**. Repeated with a process-scoped `safe.directory` setting: **386 commits, approximately 15.76 MB, 22 findings, exit 1**. Every reported secret field was verified to be fully redacted before inspection.

| Finding group | Count | Classification |
| --- | ---: | --- |
| Google API-key patterns | 8 | Firebase client-configuration identifiers in native/Web/desktop configuration, a historical API environment file, and a Firebase utility. These are public client identifiers, not Firebase Admin private keys. Restrictions and App Check still require provider verification; this classification does not prove restrictions are sufficient. |
| Stripe/JWT/PEM patterns | 7 | Deliberately inert redaction-test fixtures in `database.behavior.test.js`, `operations/dataProtection.test.js`, and `server.routes.test.js`; the tests construct synthetic token/PEM material and assert removal from logs. |
| Generic key patterns | 7 | Three test account-key identifiers, three local mocked password-recovery fixtures, and prose in `docs/agent/tasks/REF-004.md`. Redacted match context and current test/document semantics were inspected. |

The scan found no GitHub-token pattern and no Admin private-key finding in the scanned history. It does not establish provider revocation or cover the external quarantine. GitHub secret-alert access returned 403 earlier; the enabled quarantined Firebase Admin key and dependent production credential remain an outstanding rotation gate.

## Hosted controls and pending provider access

Commit `e68f0a7` contains verified hosted error/log, cookie, CORS/HSTS, origin, source-version, retention, and Web configuration fixes. Its local aggregate verification passed all 13 checks before the later UI/persistence edits. The operational TTL deployment inputs are not deployed.

Automatic approval review separately rejected the three production CORS preflights, production Firebase key-restriction metadata inventory, and metadata-only inspection of the Vercel Firebase credential. Explicit user questions remain pending. No rejected operation was rerouted through another tool. The key inventory rejection cites untrusted attachment-derived production authorization; no native key restriction change has been made.
