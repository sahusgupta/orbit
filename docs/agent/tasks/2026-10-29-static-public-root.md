# Serve fixed public assets beneath an explicit public root

This independent reliability fix starts from `9c726a55fc353c0edda31c6d1e8843c76a8a652c` on `codex/reliability-static-public-root`. Scope is nine fixed-file calls in [system routes](../../../apps/api/src/routes/system.js), [dashboard routes](../../../apps/api/src/routes/dashboard.js), and [self-check-in routes](../../../apps/api/src/routes/selfCheckIn.js), a [focused HTTP suite](../../../apps/api/src/routes/staticAssets.test.js), and this record. No dependencies, authentication, route policies, global error handling, CSP, dotfile policy, data schemas, or deployments change.

## Defect and boundary

The installed Express 5.2.1 `sendFile` passes absolute paths to send 1.2.1. Without an explicit root, send checks every absolute path component for dotfiles. An otherwise ordinary fixed public file under a `.codex` application ancestor is rejected with a native 404; the existing API error middleware maps that unhandled file error to 500. This caused the three previously reproduced legal/self-check-in/dashboard failures in the unchanged route-composition suite.

With a `root` option, send validates the relative requested filename for traversal and dotfiles before joining it to the root. The fix supplies the same trusted `publicDirectory` and the existing fixed filename at all nine call sites. `sendPublicAlias` still receives only its three internal constant filenames. No requested filename, URL parameter or filesystem path is added to a product route. Native relative hidden-file, missing-file and traversal rejection stays intact; no `dotfiles: 'allow'` override is introduced.

## Characterization and reproduction

Before tracked source edits, an ignored synthetic loopback prototype loaded the actual route modules, Express/send and security middleware with service/auth stubs under both neutral and `.codex` roots. All 14 fixed public URLs returned 200 under the neutral root, but 500 under the dot ancestor with native 404 errors. A VM-only version of the proposed nine substitutions returned 200 in both cases. The prototype verifies hidden-file 404, traversal 403, unknown-route 404 and the existing protected/disabled route boundaries. Its first fixture incorrectly expected an unknown Express 404 to keep the ordinary route CSP; the corrected fixture characterizes Express's existing `default-src 'none'` behavior, and the failed attempt is retained.

The new HTTP tests first passed four characterization cases against unchanged production source. They cover all 14 fixed targets, ignored filename query input, MIME/content, legal canonical headers, gzip and HEAD behavior, private self-check-in/CSP headers, unchanged missing-target error handling, unknown assets, and native relative-root hidden/traversal rejection under both neutral and dot roots. Three added legal/dashboard/self-check-in dot-ancestor regressions then failed with 500 instead of 200 while the four characterization cases still passed.

The focused suite VM-loads actual route, security, compression and error modules, uses actual Express/send and native loopback HTTP, and creates only owned synthetic temporary files. Service/auth callbacks are deliberately stubbed and do not prove real credential validation. The unchanged [real API route-composition tests](../../../apps/api/src/server.routes.test.js) supply that integration coverage. No hosted server, Firebase/provider connection, credentials or environment files are used; owned files and empty directories are removed explicitly.

## Validation

- `static-characterization-before.log`: four tests passed before source edits; the initial three-case run is also retained.
- `static-regression-before.log`: the expected three failures / four passes before source edits.
- `static-focused-after.log`: both focused/static and unchanged real route-composition files passed all 19 tests after the nine substitutions. In particular, all three former baseline route failures now pass without editing their assertions.
- API type checking passed (`static-api-typecheck.log`). All three changed CommonJS files passed syntax checks, and whitespace checks passed.
- Prototype evidence and its initial fixture failure remain ignored in `out/reliability-20261029/sendfile-root-prototype*.json`; no prototype source substitution was written to tracked files.
- Literal `npm run verify` ran through the reviewed minimal-environment wrapper and finished at 11:12:59 UTC on 2026-10-29 with exit code 0 and all 13 aggregate checks passing. Main unit tests passed 2,493 tests with 16 existing skips (260 passed files / one skipped file), including the three unchanged formerly failing route cases. Root/Player/Web TypeScript, release contract/artwork, Web lint/focused tests/build, sales-map TypeScript/tests/build and desktop build all passed (`static-full-verify.log`).
- All five source/test/document inputs and the runner matched their frozen SHA-256 hashes after the full run, before these results were appended (`static-verify-inputs.json`, `static-verify-freeze-result.json`). Root and independent peer reviews found no introduced findings in the focused source/test/document scope. The original route-composition test file remains byte-unchanged from the base.

All logs/prototypes remain ignored under `out/reliability-20261029/`. The change restores existing pages/assets in dot-directory checkouts while retaining the existing public root and file-access boundaries; it makes no throughput or production-latency claim.
