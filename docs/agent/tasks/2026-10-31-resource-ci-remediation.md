# Resource queue CI and packaging remediation

Fresh CI for resource PRs 53 and 54 stopped at the production dependency gate
after new glob/minimatch advisories appeared. Desktop mutation checks passed;
the later build and integration steps did not run on those heads.

The existing compatible-security-fix authorization covers this focused repair:

- Player uses scoped glob 14.0.3 and minimatch 11.0.3 overrides after actual Expo
  consumer characterization. SDK 58 and native/direct dependencies are unchanged.
  See the [Player review](../reviews/2026-10-31-player-glob-remediation.md).
- ExcelJS 3.10.0 remains byte-identical in the renderer. Its build-input
  classification removes its unused Node/archive tree from Electron packaging.
  A new supplemental audit retains the bundled browser component and only
  excludes the exact proven-unshipped Node origin. See the
  [artifact and audit review](../reviews/2026-10-31-exceljs-renderer-boundary.md).
- Root lock changes are the root declaration plus 91 development flags;
  package paths, versions, resolved URLs and integrity pins are unchanged.
  Player changes seven reviewed package records. The original eight Expo
  exceptions and November 3 review deadline are unchanged.

A direct minimatch 11 override beneath legacy glob 7 was rejected after actual
consumer tests reproduced crashes, missing files and an empty archive. It is
not part of the candidate.

## Measured packaging result

The controlled unsigned directory packages use the stock locked packager and
the same verified Electron runtime. Actual ASAR size falls from 259,635,695 to
233,141,311 bytes: 26,494,384 bytes saved (10.20%). The complete unpacked
directory is 4.12% smaller, with 91 fewer Node packages. No compressed-installer
size or startup-memory improvement is claimed.

All 48 renderer files match exactly inside both ASARs. The ASAR-served browser
probe retains synthetic workbook import, date/duration values and malformed-file
rejection. The official Electron cache and non-resource executable sections
remain unchanged. No desktop application, signing or publication was involved.

## Verification

The focused suites add 201 tests: 91 advisory/fixture constraints, 81 artifact
boundaries, 24 actual dependency-inventory cases and five Player consumer/resource
cases. New behavioral regressions were demonstrated before their corresponding
fixes, including cancellation work, matcher expansion, opaque Node loaders,
aliases and incomplete inventories. Empty npm optional placeholders require
explicit optional dependency or optional-peer metadata.

The actual `npm run verify` passed all 13 checks, including all production
builds. All 3,243 tests passed, with 16 existing skips. Existing test-adapter and
Vite eval/large-chunk warnings remain; renderer bytes are unchanged.

The final frozen-source `node scripts/audit-production-dependencies.mjs` passed:
root/API/Web each have zero production findings; Player retains exactly the
eight accepted entries (three High, five Low); seven propagated Node-only
findings remain visible in the supplemental artifact audit. The November 3
review deadline remains in force. This gate covers production artifacts and
retained browser dependencies, rather than every installed development tool.

Sensitive-path, independent-lockfile, release-control, module-graph,
renderer-budget, public-site and brand checks passed. Local commands use a
scrubbed environment, loopback API targets,
disabled Firebase sync and memory-only API fixtures. Public registry/advisory
reads are the intended external calls. Evidence remains under ignored
`out/security-renderer-tooling-20261031/`.

Linux CI, including managed iOS prebuild, remains pending the remediation PR.
Windows cannot provide that prebuild gate. Existing Player Doctor, configuration,
codegen and Hermes/embedded-export checks passed as recorded in the Player
review. This work produces no signed iOS binary or production deployment.
