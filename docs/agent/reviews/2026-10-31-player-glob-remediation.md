# Player tooling glob resource advisory remediation

The fresh production dependency gate reported two additional originating
advisories: [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)
and [glob traversal after cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4).
The former lists versions below 11.0.1; the latter lists glob 9.0.0 through
14.0.1. No patched version fits Player's existing glob 13 / minimatch 10 ranges.

The compatible-fix authorization covers this isolated tooling correction after
behavioral characterization. The [Player manifest](../../../player-app/package.json)
adds selectors matching only `glob@^13.0.0` and `minimatch@^10.2.2`, resolving them
to exact versions 14.0.3 and 11.0.3. Legacy major versions elsewhere in the
repository are outside those selectors. SDK 58, React Native, React, Firebase,
Maps, direct dependencies and all eight reviewed Expo exception parent versions
remain unchanged. The advisory policy, its originating exceptions and November 3
deadline remain unchanged.

Glob's default package entry bundles its implementation. Updating external
minimatch alone would not establish that the bundled glob implementation was
patched. Glob 14.0.3 declares minimatch `^11.0.2` and contains the cancellation
fix; the selected external matcher is pinned independently for Expo fingerprint
consumers. Their published Node engine ranges accept the repository's Node
22.16.0; npm remains 10.9.2.

## Compatibility and bounded security evidence

An isolated private fixture package first compared the actual installed Expo
consumer source with injected original and candidate dependencies. Eighteen
consumer output groups, eight named sync/async glob cases and ten matcher cases
matched in two Windows runs. Coverage included native project discovery, iOS
paths/schemes, Android manifest paths, Metro workspace filtering, fingerprint
ignore negation and workflow classification, dotfiles, braces/extglobs and
Windows/UNC separators. Fingerprint VCS discovery was forced to its NoVCS
fallback; no production credentials or services were used.

The bounded cancellation fixture rejected after five directory reads on glob
13.0.6 and then performed 80 additional reads. The candidate rejected after one
read and performed no subsequent reads. An eight-repetition matcher pattern with
an explicit expansion budget of 64 compiled 256 patterns with minimatch 10.2.5
and 64 with 11.0.3. The candidate-only fixture audit reported zero findings.
These establish the covered synthetic behavior, not universal compatibility,
macOS compilation or production performance.

The committed [focused regression suite](../../../scripts/player-glob-security.test.js)
exercises the installed Player tools directly with isolated synthetic files and
explicit VM dependency injection. Its three consumer characterizations passed
against the original dependencies. Its two bounded resource regressions then
failed against those dependencies before the manifest or lockfile changed.
The matcher probe uses a five-second subprocess deadline; the cancellation tree
contains only 64 terminal directories. Temporary fixture deletion verifies the
absolute target and dedicated prefix first.

## Dependency scope and installation

The reviewed lock proposal changes seven package records: glob, minimatch,
path-scurry, its nested lru-cache, the new nonrecursive matcher helper, and
registry-integrity metadata on unchanged balanced-match and minipass versions.
The root package record, every direct dependency and all unrelated package
records remain identical. The lru-cache 11.5.2 to 11.5.3 selection is a compatible
transitive patch beneath the updated path-scurry dependency.

An initial lock-only command using `--prefix player-app` unexpectedly introduced
`table_manager: file:..` and unrelated records. The parsed guard rejected that
proposal before installation. Only the task-owned Player files were restored
from their original snapshots, then resolved from an explicit `player-app/`
working directory with scrubbed environment, disabled install scripts and the
official npm registry. The rejected proposal and command evidence remain
preserved; no parent file dependency is accepted.

Local installation, focused checks and release-tool results are recorded in
ignored `out/security-renderer-tooling-20261031/player/`. Full verification and
Linux CI are recorded by the enclosing remediation task. The repository's iOS
prebuild verifier explicitly requires Linux or macOS, so a Windows run cannot
supply that gate. No EAS build, native archive, signing or App Store submission
is part of this dependency correction.

## Actual local results

- Baseline `npm ci --prefix player-app` passed and retained the original lock.
  The explicit-directory candidate clean install passed with 607 packages;
  its lock SHA-256 remained
  `9f6beae1561ed39ccef6d06b9715f5b5acebcfce630c6928a1980f3232acad03`.
- All seven changed records' versions, resolved URLs and SHA-512 integrity
  values matched independently fetched official registry metadata. Balanced-match
  and minipass previously had no resolved/integrity fields; the candidate adds
  those verified fields without changing an existing artifact pin or other keys.
- The installed Player contains exactly one glob 14.0.3 and one minimatch
  11.0.3. All six actual Expo helper source hashes match the prototype's consumer
  sources. The five focused tests pass after installation, including the two
  resource regressions that failed before it.
- Production public/introspected configuration, the repository release contract,
  live Expo compatibility and independent bundled SDK compatibility passed.
  Raw Expo Doctor passed all 20 checks. Player strict TypeScript and native iOS
  schema/code generation passed.
- iOS Hermes export, inspectable JavaScript/source-map scanning and actual
  `export:embed` passed. The embedded path bundled 1,240 modules and copied 19
  assets; the two source scans checked three and two inspectable files. This is
  JavaScript/codegen evidence, not a compiled signed iOS binary.
- The fresh Player production audit reports exactly the original eight accepted
  entries: three High and five Low, no Moderate or Critical findings. The
  unchanged dependency-review constraint checker reports no policy failures;
  neither originating advisory, parent version nor deadline was broadened.
