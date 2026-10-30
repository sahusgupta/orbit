# Player Web platform metadata compatibility

This release follow-up starts from merged source `96dfe42e5dad08e01f390eaf7482533ddaf1d156` on `codex/player-web-vercel-metadata`. Scope is the [hosted configuration guard](../../../player-web/release-config.ts), its [boundary tests](../../../player-web/release-config.test.ts), and this record. Application targets, Firebase identity, App Check requirements, emulator rejection, authentication, schemas, dependencies and provider settings remain unchanged.

## Actual failure and narrow fix

The release coordinator observed alias-withheld Player Web candidate `dpl_9RnFtjy6AW7MPTqUvVAQRY9mCaeY` fail while loading `next.config.ts`: the guard rejected `NEXT_PUBLIC_VERCEL_PROJECT_ID`. The existing production aliases had not been promoted to that failed candidate. Local verification did not contain this platform-injected name.

Vercel documents [framework-prefixed environment variables](https://vercel.com/docs/environment-variables/framework-environment-variables) and its [system project identifier](https://vercel.com/docs/environment-variables/system-environment-variables). The official [Next.js builder](https://github.com/vercel/vercel/blob/main/packages/next/src/index.ts) invokes [the prefix helper](https://github.com/vercel/vercel/blob/main/packages/build-utils/src/get-prefixed-env-vars.ts) before the application build. The inspected helper copies eight named platform variables and Git metadata into `NEXT_PUBLIC_` names; the framework documentation additionally identifies the public hash salt. These primary sources were inspected on October 30, 2026 UTC. No provider environment values were pulled or removed.

The guard now recognizes an explicit set of twenty reviewed metadata names. Each public mirror must have `VERCEL` exactly `1`, an existing string-valued unprefixed counterpart, and an exactly equal value. A mirrored project ID must also match the independently verified canonical Player Web project `prj_22SN9L7TvAKHTye7x6PZmBhvNkoq`. Metadata does not supply or override the separately validated application URLs or Firebase settings. Documented empty Git fields remain valid string mirrors.

There is no general `NEXT_PUBLIC_VERCEL_` or Git-prefix exception. Unknown names, secret/token names and public OIDC/protection-bypass values remain rejected even when an unprefixed value matches. Rejections identify the variable name without echoing its value. The existing isolated local-build early return is retained.

## Characterization and regression evidence

All focused checks use installed locked tools, a minimal allowlisted process environment, unreachable loopback application APIs and disabled synchronization. The tests pass authored synthetic objects to the actual guard; they do not read provider configuration, authenticate, start application servers or request customer data.

- The unchanged existing boundary suite passed all 21 tests before tracked source edits.
- An ignored pure-source characterization loaded the exact starting revision through the installed TypeScript transformer. Twenty existing-behavior/security checks passed, and all twenty synthetic platform mirrors reproduced rejection, including the actual project-ID failure.
- The expanded tracked suite ran before the production change: 22 expected failures and 45 passes. The failed cases were twenty individual valid mirrors, the complete injected set, and documented empty Git mirrors.
- After the fix, all 67 tests passed. Coverage includes missing/mismatched/non-string counterparts, non-Vercel hosted configuration, the wrong canonical project, unknown Git/platform/secret names, retained Firebase/App Check/API/Web-origin checks and the emulator ban.
- Final standalone Web TypeScript and ESLint both passed after the source/test freeze. No type suppression, broad assertion, lint exception or skipped check was added.

Focused logs and metadata-only characterization proofs are ignored under `out/reliability-live-20261029/` in the retained release-evidence checkout. Commands are `node node_modules/vitest/vitest.mjs run release-config.test.ts --maxWorkers=1`, `node node_modules/typescript/bin/tsc --noEmit`, and `node node_modules/eslint/bin/eslint.js . --max-warnings 0`, from `player-web` behind the isolated runner.

The earlier exact-96 source passed all thirteen `npm run verify` checks and seven additional release gates. That evidence predates this fix. Fresh complete verification and the isolated production browser smoke must run on the final fixed source before it is claimed ready; a new hosted artifact must then confirm platform compatibility. No new build, deployment, alias promotion, enforcement change or native delivery is claimed by this source change.
