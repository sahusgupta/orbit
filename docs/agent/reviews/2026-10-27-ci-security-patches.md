# CI dependency security patches — October 27, 2026

After accepting the separately documented Expo tooling risks, the user explicitly authorized compatible security fixes for the root, API, and Player Web dependency trees before CI. These patches remediate the new findings; they do not add exceptions to those scopes or expand the Player-only risk acceptance. No production service, SMTP transport, signing, deployment, or App Store operation is part of this review.

## Reviewed selections

| Scope | Package | Locked before | Selected | Reason and compatibility boundary |
| --- | --- | --- | --- | --- |
| Root | Vite | `7.3.5` | `7.3.7` | Patched Vite 7 maintenance release; manifest minimum advances from `^7.3.5` to `^7.3.7`. Node requirement remains compatible with the pinned Node `22.16.0`. |
| Root | Nodemailer | `10.0.16` | `10.1.4` | Same-major security floor for address-parser fixes; manifest minimum becomes `^10.1.4`. No SMTP settings or report-envelope code changes. |
| API | body-parser | `2.3.0` | `2.4.0` | Transitive update within Express `5.2.1`'s declared `^2.2.1`; fixes compressed-request trailing-byte process termination. No direct dependency was added. |
| API | content-type | `2.0.0` | `2.1.0` | Required transitive minimum of body-parser `2.4.0`. |
| API | qs | `6.16.0` | `6.16.1` | Existing exact override advances to the patched release. All current API parent ranges admit the selected version. |
| API | Zod | `4.1.11` | `4.6.7` | Scoped exact override under `@vercel/cli-config`, preserving the installed Vercel Functions/OIDC packages. This intentionally replaces an upstream exact pin within Zod 4; it is not described as an in-range lock-only update. |
| Player Web | Next / eslint-config-next | `16.3.8` | `16.4.3` | Paired framework/lint update within Next 16, prepared by the enclosing task. Node `22.16.0`, React `19.2.8`, and ESLint `9.39.5` satisfy the published requirements. |

Primary upstream evidence:

- [Vite 7.3.7 release](https://github.com/vitejs/vite/releases/tag/v7.3.7) and [Windows editor-launch advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm). The audit also attributes GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-9jrq-w75r-8gcw, and GHSA-rq7h-c2jc-7f22 to the old Vite selection.
- [Nodemailer 10.1.4 release](https://github.com/nodemailer/nodemailer/releases/tag/v10.1.4) and [nested-comment recipient advisory](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8). The same security floor resolves GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h.
- [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828): patched in `2.4.0` and `1.20.9`.
- [qs advisory](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw): patched in `6.16.1`.
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): security floor `4.6.6`; the selected current stable patch is `4.6.7`.
- Next [image-optimization RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [typed-array cache RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr), and [Server Actions denial of service](https://github.com/advisories/GHSA-p3m5-59mp-jv5r): the affected Next 16 range ends at `16.4.0`.

## Bounded Vercel/Zod compatibility review

API application callers in `accountDeletionService.js`, `identityService.js`, and `db/publicationOutbox.js` consume `require('@vercel/functions').waitUntil` to attach existing background promises. They do not use the CLI configuration storage APIs. Vercel Functions remains `3.9.2`, OIDC remains `3.8.3`, and CLI Config remains `0.2.3`.

The installed CLI Config pins Zod exactly at `4.1.11`. Read-only registry inspection found that even the then-latest Vercel Functions `3.10.4` / CLI Config `0.3.4` chain still pins that vulnerable Zod version. Updating those packages alone would not remove the finding; npm's proposed downgrade to Vercel Functions `3.6.1` was not used. The scoped override changes only CLI Config's Zod implementation, retaining the same major and the application-consumed provider API.

Before changes, the actual package import and a credential-free harness passed: `waitUntil` remains a function; rejects non-promises; is a no-op without a request context; and attaches the exact promise to a synthetic request context. Pure CLI configuration schemas preserve accepted values and unknown-key passthrough and reject invalid enum/type values. The harness does not read credential files, call OIDC/token APIs, or contact a provider. Its ignored path is `out/player-sdk58-production-20261027/vercel-zod-compatibility.cjs`; it must pass again after the override's clean install.

## Verification evidence

Before dependency changes, `npx vitest run electron/reportEmailCompatibility.test.js apps/api/src/server.routes.test.js apps/api/src/accountDeletionService.test.js apps/api/src/identityService.test.js apps/api/src/publicationDeletionFence.test.js` passed five files and 93 tests. The mail compatibility test uses Nodemailer's in-memory stream transport, so no mail is sent. API route characterization uses a local memory-backed server and synthetic credentials.

The root lock update changes exactly two package records, Vite and Nodemailer. The API lock update changes exactly four records, the parser, its content-type requirement, qs, and Zod. npm temporarily reordered the root manifest's existing EAS CLI entry; that unrelated ordering change was restored. No dependency, source, API contract, data schema, identity flow, or service configuration was changed outside the selections above.

Post-change checks actually executed:

- Root `npm ci --no-audit --no-fund`: exit 0, 1,458 packages installed. API `npm ci --prefix apps/api --no-audit --no-fund`: exit 0, 262 packages installed. Independent production audits ran separately; install flags did not bypass the repository's security gate. Existing dependency deprecation warnings remain.
- Both clean installs preserved their lockfiles: root SHA-256 `f240d6b28ded6783fbf8f0d2dd1d0cc2740e20197aa5ec883818286820c53bad`; API SHA-256 `7080f166e3ed20211d4fd60061acd969baf9d7d84523e69ce7c5fc808d2fa1d2`.
- Installed selections match the table: Vite `7.3.7`, Nodemailer `10.1.4`, parser `2.4.0`, qs `6.16.1`, Zod `4.6.7`; all three Vercel package versions remain unchanged.
- The actual `waitUntil`/pure CLI schema compatibility harness passed again after the Zod override. No request-context, invalid-input, schema-validation, or passthrough behavior tested by that harness changed.
- `npx vitest run apps/api/src electron/reportEmailCompatibility.test.js`: **50 files / 460 tests passed**, exit 0. The ignored log is `out/player-sdk58-production-20261027/security-api-email-tests.log`. These existing behavior tests and the actual dependency-boundary harness cover the version-only changes; no application implementation or test assertions were rewritten.
- Root `npm audit --omit=dev --json`: exit 0, zero production findings. API `npm audit --omit=dev --prefix apps/api --json`: exit 0, zero production findings. These results do not assert that development dependencies are advisory-free.
- `npm run check:independent-locks`: passed. Independent read-only review found no actionable issue in the four package/lock changes; all six changed package records use public npm registry URLs and integrity metadata. `git diff --check` passed.
- The enclosing task reports the Player Web pair's clean install passed (570 packages), production audit returned zero findings, TypeScript and lint passed, and all 20 files / 209 tests passed. The Web lock changes 13 package records for Next, its matching compiler/platform dependencies, and lint configuration. npm's unrelated key-order churn was normalized with a parsed-content `deepStrictEqual` check. The full Web audit including development dependencies still reports seven affected entries (5 High / 2 Moderate); no corresponding production exception or assertion of an advisory-free development tree was added.

The enclosing task owns the retained Web proof, final `npm run verify`, source commit/push, and CI. No aggregate or CI passing result is inferred from the existence of a published patch or focused test results.
