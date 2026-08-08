# Post-Stabilization Verification Plan

Date: 2026-08-07

Branch: `fix/type-005-synchronized-list-tuples`

## Gate result

TypeScript stabilization is complete: renderer/root-test TypeScript, Player TypeScript, 35 files/188 unit tests, the 1,913-module renderer build, and `npm run verify` pass. The post-green review therefore evaluated TYPE-015 through TYPE-022 against the first authorized refactor boundary rather than treating every possible compiler project as a blanket prerequisite.

## Compiler-coverage decisions

| Task | Decision | Evidence and trigger |
| --- | --- | --- |
| TYPE-021 | Required now; complete in `2c62779`. | Root tests followed two Player implementation modules under desktop options. The unchanged nine tests now belong to the Player project and the root graph contains zero Player paths. |
| TYPE-015 | Required now; complete in `ef9156d`. | The first refactor extracts renderer types/helpers from `src/main.tsx`; production and test diagnostics need separate ownership. Renderer and root-test checks now run independently and non-short-circuiting. |
| TYPE-022 | Required now; complete in `f9ae262`. | Electron's renderer is sandboxed. The renderer compiler now exposes only `vite/client` ambient types and contains zero `@types/node` files. |
| TYPE-016 | Required at the REF-008 trigger; complete. | Dedicated non-DOM Electron check-JS now covers main, preload, and Firebase sync with zero diagnostics; the three findings were characterized before correction. |
| TYPE-017 | Trigger before tooling refactoring. | Vite/root-script checking is independent of renderer domain extraction; administrative scripts must remain static-only. |
| TYPE-018 | Required at the REF-009 trigger; complete. | Package-owned non-DOM API check-JS now covers source and JavaScript tests with zero diagnostics; the seven Firebase/licensing/payment findings were characterized before correction. |
| TYPE-019 | Defer until download-site work. | Download-site browser/tooling coverage does not guard the management renderer refactor. |
| TYPE-020 | Defer until a secret-free localhost-only harness exists. | TYPE-016 is complete, but the current stress harness still reads a local private key and can launch Electron against hosted defaults; it must not be executed during ordinary verification. |

No project references are justified yet. The repository still has no genuine shared package, and introducing references before a shared ownership boundary exists would add orchestration without closing a current blind spot.

## Boundary verification matrix

| Change boundary | Required checks |
| --- | --- |
| Renderer types, pure helpers, state, or screens | `npm run typecheck`, focused characterization tests, `npm test`, `npm run build`, `npm run player:typecheck`, `npm run verify` |
| CSS/layout | Renderer checks above plus rendered browser comparison at supported desktop widths; no production endpoint or Firebase sync |
| Player source | `npm run player:typecheck`, focused Player tests, full tests, build, aggregate verify |
| Electron main/preload | Complete TYPE-016 first, add boundary characterization, Electron static check, tests/build/verify; never run the current stress harness |
| API/shared sync | TYPE-018 is complete; add boundary characterization, run the API static check, focused/full tests/verify; do not start or contact production services |
| Tooling/download/e2e | Complete the corresponding TYPE-017/019/020 trigger task before changing that boundary |

## Immediate authorized scope

Begin with type-only and pure renderer extraction from `src/main.tsx`. Preserve persisted `AppState`, sync protocol v2, identity policies, ordering/idempotency, and existing UI behavior. Reuse the stabilization characterization suites before and after type-only moves; add direct tests before moving behavior that lacks an existing focused boundary.
