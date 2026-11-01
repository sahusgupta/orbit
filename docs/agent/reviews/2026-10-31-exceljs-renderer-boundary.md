# ExcelJS renderer artifact and dependency boundary

The resource/reliability queue exposed a newly reported moderate minimatch
advisory in the legacy Node archive dependencies beneath ExcelJS 3.10.0. The
user's existing authorization covers compatible security fixes. A direct
minimatch 11 substitution was rejected after controlled tests demonstrated
glob 7 crashes, missing files and an empty archive. It is not applied.

This change retains ExcelJS 3.10.0 and its existing browser code. ExcelJS is used
as a renderer build input; the emitted browser chunk is the runtime dependency.
Its separate Node/archive package tree is removed from Electron packaging by
classifying that input as a development dependency. A supplementary audit keeps
the browser component visible after this classification.

## Source and artifact evidence

- The production source callsite is the lazy import in
  `src/lib/profileWorkbookImport.ts`, invoked from `src/main.tsx`. The reviewed
  Electron/API Node closure has no ExcelJS consumer.
- ExcelJS 3.10.0 declares Node entry `lib/exceljs.nodejs.js` and browser entry
  `dist/exceljs.min.js`. The actual renderer build selects the browser entry.
- Browser entry: 1,070,370 bytes, SHA-256
  `910c39409857444ff10c0f2340964f8e43800d321c11f7963b8349dfa3ecabc2`.
- Expanded browser artifact: 1,987,053 bytes, SHA-256
  `74c9cb026c3aac6aa6fe4b450e90d2542f099ac8e580478418b40f709bfe8217`.
- The expanded artifact contains one Browserify module table with 484 modules.
  Its dependency edges include `fast-csv`, `jszip` and `saxes`, and no
  archiver/glob/minimatch/rimraf edge. The pinned bytes and reviewed source
  boundary support the narrow Node-only disposition below.
- Vite observes the prebundled file as one library with CommonJS wrapper
  modules. Its graph and the source map's single source entry cannot inventory
  all embedded dependencies. Unknown origins therefore remain blocking even
  when their package names are absent from Vite's graph.

The baseline unsigned local Electron directory package was produced by the
stock electron-builder 26.15.3 dependency collector with the verified official
Electron 42.1.0 runtime. ASAR size is 259,635,695 bytes, with 12,357 entries and
332 Node packages. ExcelJS and its Node archive/matcher tree are present.
All 48 emitted renderer files match their actual ASAR bytes. A headless browser
served those ASAR-extracted files and successfully parsed a synthetic profile,
ISO date and numeric duration, while rejecting malformed input. No desktop
application was launched. Signing and publishing were disabled only for this
local proof; committed production signing settings remain unchanged.

## Retained advisory coverage

The existing root/API/Player/Web production audit and November 3 review deadline
remain in force. The existing eight Player tooling exceptions are unchanged.
ExcelJS's browser component additionally receives an audit of its exact locked
dependency closure:

1. Derive a private audit fixture from the root lockfile's actual ExcelJS
   dependency/optional/peer closure. Preserve locked versions, paths, resolved
   URLs and integrities; remove development classification flags only inside
   that generated fixture. No package is installed or re-resolved there.
2. Run a fresh public-registry audit against that virtual lockfile, retaining
   raw advisory evidence and a visible disposition for each affected ancestor.
3. Permit only the reviewed moderate
   [minimatch origin](https://github.com/advisories/GHSA-g3hv-75wg-m249)
   in the exact unshipped Node chain below, after artifact and Node-production
   boundary checks pass.
4. Block direct ExcelJS findings, new/unknown or mixed origins, critical
   findings, malformed/cyclic/incomplete evidence, changed locked versions,
   changed browser bytes, Node consumers, externalization and changed packaging
   configuration. The review cannot extend to another origin through config.

| Reviewed Node-only package | Locked version |
| --- | --- |
| ExcelJS | 3.10.0 |
| archiver | 4.0.2 |
| archiver-utils | 2.1.0 |
| glob | 7.2.3 |
| glob's minimatch | 3.1.5 |
| rimraf | 2.6.3 |
| zip-stream | 3.0.1 |

The artifact guard checks the sole allowed renderer import, rejects recognized
Node loader indirection requiring a new boundary review, verifies that these reviewed Node
packages are absent from the actual production dependency tree, and builds the
actual renderer without writing shipping output to confirm browser bundling and
absence of external imports. It binds the scope to the production packaging
configuration, packager version, normalized Vite configuration and locked/installed
Vite tool versions. Findings remain visible in console output
and generated audit evidence under ignored `out/`.

This retains coverage supplied by the locked ExcelJS graph. It does not claim
that npm independently identifies every embedded dependency's historical version
inside a prebuilt browser bundle. The pinned artifact and blocking treatment of
unknown origins are deliberate boundaries of this review.
The source extractor covers recognized module-loading syntax in `src/`,
`electron/` and `apps/api/src/`; arbitrary JavaScript data flow or `eval` is
outside its analysis.

## Verification status

Root manifest comparison permits only moving the unchanged `^3.4.0` declaration
to development dependencies. Parsed lock comparison found 92 changed records:
the root classification and development flags on its dependency tree. Every
package path, version, resolved URL and integrity is unchanged.

The candidate root clean installation passed without changing its lockfile.
The controlled unsigned package comparison passed:

| Actual packaged measure | Baseline | Candidate |
| --- | ---: | ---: |
| ASAR bytes | 259,635,695 | 233,141,311 |
| Packaged Node packages | 332 | 241 |
| Renderer files verified inside ASAR | 48 | 48 |

The ASAR and unpacked directory each lose 26,494,384 bytes; ASAR size falls
10.20%, and the full unpacked directory falls 4.12%. ExcelJS, archiver,
archiver-utils, glob, minimatch and rimraf are absent
from the candidate's packaged Node tree. All 48 renderer paths, sizes and hashes
are identical before and after, including their bytes extracted from each
actual ASAR. The same headless import probe passed for a synthetic profile,
1990-02-03 date and 7.5-hour value; malformed input retained the same rejection.
The browser made no foreign-origin requests. Six candidate Node processes
recorded zero network attempts. The verified official Electron cache remained
unchanged; non-resource PE sections match the official executable, with only
the expected packaged ASAR-integrity resource difference.
The package-path comparison removes 92 paths and adds one: an unchanged
`@types/node@24.12.4` package moves from beneath protobufjs to the root. Its
packaged `package.json` and `LICENSE` content hashes match, leaving 91 fewer
packages overall.

Evidence is under ignored
`out/security-renderer-tooling-20261031/packaging-proof/`, including
`CONTROLLED_PACKAGE_COMPARISON.json`, `baseline-selected.json`,
`candidate-selected.json` and their selected `PACKAGE_PROOF.json` records.
This is an unsigned local directory-package proof, not an installer release or
a native desktop launch.

The actual `npm run verify` passed all 13 checks: strict TypeScript across the
applications, release contract/artwork, Web lint, all unit suites and the three
production builds. It passed 3,243 tests with 16 existing skips, including all
201 added focused cases. Existing React test-adapter and Vite eval/large-chunk
warnings remain; renderer bytes did not change.

The final frozen-source `node scripts/audit-production-dependencies.mjs` passed:
root/API/Web each report zero production findings, Player retains its exact
eight accepted entries (three High, five Low), and all seven propagated entries
from the reviewed unshipped Node chain remain visible with explicit artifact
dispositions. The next mandatory review remains November 3. This production
artifact gate does not assert that every installed development tool is free of
advisories.

Sensitive-path, independent-lockfile, release-control, module-graph,
renderer-budget, public-site and brand checks passed. Prototype and harness
failures remain preserved in ignored evidence; they are not application failures
or passing release results. Linux CI remains pending the remediation PR.
