# Fail closed on incomplete production dependency audits

Final verification review found that
[the four-scope production audit gate](../../../scripts/audit-production-dependencies.mjs)
ignored npm's process status and signal, parsed empty stdout as `{}`, and defaulted
missing vulnerability data to empty objects. A failed or incomplete audit could
therefore print zero findings and reach the bundled audit gate.

The gate now accepts only normally completed npm statuses 0 or 1 and a complete
version-2 JSON report. All six severity/total counts must be nonnegative safe
integers; package names, recognized severities, entry counts, severity histograms
and totals must agree. Error reports, missing data, interrupted commands and
status 1 with zero findings fail immediately. The fallback empty objects are gone.

A valid report with findings still reaches the unchanged advisory policy, even
if npm exits 0: its exit status can depend on
[the configured audit level](https://docs.npmjs.com/cli/v10/commands/npm-audit/#exit-code).
Valid policy failures still audit all four scopes before reporting them. Scope
ordering, original spawn/bundled errors, policy expiration and bundled artifact
validation are preserved. The four exception lists remain empty and the mandatory
2026-11-03 review deadline is unchanged. No dependency version or application API,
datastore, authorization, polling or deployment behavior changes.

## Verification

[The entrypoint tests](../../../scripts/audit-production-dependencies.test.js)
mock child-process results and the bundled gate before importing the actual
production script. They perform no npm, registry, Vite or service operation.

- Before editing the gate: 8 characterization cases and 22 existing advisory-policy
  cases passed. This includes valid zero reports, positive reports with both npm
  statuses, fixed scope commands, original failures and expired policy.
- The initial 42-case entrypoint suite then had 33 expected failures against
  unchanged source. Eight characterization cases and the whitespace case passed;
  whitespace was already rejected by JSON parsing.
- The same 42 cases plus 22 existing policy cases passed after the patch.
- Four additional complete-report/error-field cases (`null`, `false`, `0`, empty
  string) were added after the patch. Final focused result: 46 new + 22 existing
  cases passed. No baseline execution is claimed for those four added cases.
- `node --check scripts/audit-production-dependencies.mjs` passed.
- `npm run verify`: all 13 checks passed; 3,697 tests passed, 16 existing tests
  skipped, and all three production builds passed. The original process exited 0;
  its terminal result was observed at 2026-10-31 23:33:35 UTC. Existing React test,
  ExcelJS eval and chunk-size warnings remain visible in the raw log.

Actual commands, source/test/policy hashes and raw outputs are retained locally in
`out/dependency-audit-fail-closed-20261031/`. Runtime endpoints were loopback only,
storage was in memory, and sync, dotenv and telemetry were disabled. These mocked
tests establish failure handling; they do not establish current registry advisory
counts. A separate live public-registry audit is required for that claim.
The raw aggregate log SHA-256 is
`4c4526e7b93f322e45f19af4ff01d05835bce0cad286ee07884dd21327d58491`.
The source, tests and unchanged advisory policy retained their frozen hashes.

The previously failed nine-epoch/180-minute native sustained validation and its
unexecuted supplemental games gate remain unmet. This task started no production
deployment, native emulator, signed archive or EAS build/submission.
