# Dependency review for the October desktop release

The user explicitly authorized dependency remediation and complete desktop release rollout after the source-readiness work. This review targets the next unused stable Windows version, `0.1.78`, through the existing immutable-source candidate and promotion workflow. It does not publish the API, Player Web, or native Player application.

## Compatible repairs

| Scope | Locked changes | Reason |
| --- | --- | --- |
| Root | Nodemailer 9.1.1 to 10.0.16; brace-expansion 5.0.9 to 5.0.12; source-map-js 1.2.1 to 1.2.2 | Remove current report-email, parser, and source-map advisories. Nodemailer 10 requires Node 20+; the repository and Electron runtime satisfy that requirement. Its existing CommonJS caller remains unchanged. The real stream-transport characterization and Electron check-JS pass. |
| API | compression 1.8.1 to 1.8.2; proxy-addr 2.0.7 to 2.0.8; busboy 3.2.0 to 3.2.2; grpc-js 1.14.4 to 1.14.5 | Remove current response-lifecycle, IP spoofing, multipart, and gRPC advisories within the selected parent ranges. |
| Player | Exact Expo 57.0.27, Constants 57.0.21, Crypto 57.0.3, Splash Screen 57.0.9; Asset 57.0.19; compatible SDK patch dependencies; brace-expansion 5.0.12; shell-quote 1.11.0 | Satisfy Expo's compatible patch set and release pins; remove parser and shell-quote advisories while preserving the separate 1.x and 2.x brace-expansion overrides. |
| Web | Next.js and matching ESLint config 16.3.8; Sharp 0.35.5 and matching platform/libvips artifacts; source-map-js 1.2.2 | Remove current Next.js, image-renderer, and source-map advisories. |
| Root / Player / Web | Firestore-scoped grpc-js override 1.9.16 to 1.13.6 | Firestore's old `~1.9.0` range cannot select a patched version. The scoped override stays within gRPC major 1 and leaves other parents' selected ranges intact. No Firebase collection, transport contract, or application behavior is changed. |

The lockfile contents and integrity values are npm-generated. Web package ordering is preserved for review. npm's prefix install introduced an unintended Player parent dependency; it and its newly introduced, unreferenced `..` lock entry were removed. Independent-package verification passes before and after all four reproducible `npm ci` installs. No blanket or forced audit fix was used.

## Residual Player tooling review

Fresh production audits report zero advisories for root, API, and Web, and eighteen High entries with zero Critical entries for Player. All eighteen Player entries trace to exactly two originating advisories:

- [braces stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), in `braces@3.0.3` through `micromatch@4.0.8` and Metro's filesystem glob watcher. The advisory reports no patched release; npm still lists 3.0.3 as latest. Reviewed build patterns and repository files are the input boundary. Malicious source/config supplied to the build can still cause denial of service.
- [node-forge RSA verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv), in `node-forge@1.4.0` through Expo CLI's `@expo/code-signing-certificates` utility. The advisory reports no patched release; npm still lists 1.4.0 as latest. These utilities process development/build signing material; no untrusted signing certificate or signing-service operation is used for this desktop release. The cryptographic flaw remains unfixed upstream.

Repository searches found no Player application import of those APIs. Actual sanitized iOS exports passed in Hermes bytecode, inspectable JavaScript, and EAS embedded modes. Both JavaScript source maps were generated and checked; the reviewed parsers, Metro file-map, and Expo signing-certificate dependency were absent from the runtime source graph. A persistent scanner now rejects those paths, including escaped Windows paths, in exported artifacts. This is evidence of the present runtime boundary, not proof that the tooling is harmless. The desktop release does not package the Player's Expo/Metro toolchain.

The old SDK 54 image-size exception is retired. The renewed policy expires on **2026-10-22** and includes only the eighteen observed Player package entries, their exact locked versions, and the two exact originating advisory URLs. The original expiry, unknown-package, and always-fail Critical checks remain intact. Additional constraints reject a new advisory on an already listed package, a changed package version, an unreviewed transitive origin, incomplete evidence, or changed severity. Root, API, and Web have no exceptions. Seven negative/positive policy tests and the source-map scanner tests pass.

Re-review immediately if a compatible upstream fix becomes available, a build input or signing flow changes, a vulnerable tool enters an application bundle, or any dependency version/advisory changes. The existing CI export/scanner enforces the runtime boundary. These exceptions do not approve deploying a native Player binary or operating an untrusted signing service.

## Verification and delivery

Node 22.16.0 and npm 10.9.2 are installed. Locked installs completed for all four projects. Expo's dependency check, all 21 Doctor checks, public/introspected permission checks, three export modes, Nodemailer email compatibility, Electron check-JS, independent locks, the strengthened advisory gate, release controls, module graph, and focused advisory/bundle tests passed.

Actual native schema generation succeeded, but the old verifier failed because RN 0.86 moved codegen and application dependency provider artifacts into separate folders. The verifier now checks the same required nonempty files under `ReactCodegen/` and `ReactAppDependencyProvider/`; three tests reject missing/empty output and prevent an obsolete flat file from masking a missing provider. Actual `npm run player:codegen:ios` passes afterward. Managed iOS prebuild verification requires Linux/macOS and will run in GitHub CI rather than being claimed as locally verified on Windows.

`npm run verify` completed with exit code 0: all thirteen checks passed. Root unit tests passed 207 files and 1,468 tests, with one existing emulator file/eight tests skipped; Web passed 209 tests, and the sales map passed 85 tests. All strict compiler projects, Web lint, artwork, and production builds passed. The unchanged renderer budget passed at 186,146 initial gzip JavaScript bytes against 190,000; public-site and brand checks also passed.

The immutable Windows candidate and separate promotion are still pending; their actual results will be recorded before delivery is claimed.

The post-remediation desktop mutation smoke passed through the real renderer, preload/IPC, Electron client, and local authenticated API/CAS. A fresh fixture build verified saved receipts/final UI, conflicts, API failures, and oversized payload rejection without production datastore, sync, or credentials.
