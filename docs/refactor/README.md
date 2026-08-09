# Refactor Planning

The first authorized refactor queue, REF-001 through REF-010, completed on 2026-08-07. The continuation has now separated management mutation, persistence/synchronization, feature composition, reusable Player discovery/presentation, and Player application/storage orchestration through REF-023. REF-024's fake-only external-data/subscription gate remains the characterization base for the next dependency-ready task, REF-025's Player data-adapter split and validation.

- Fresh audit and starting metrics: `docs/refactor/ARCHITECTURE_AUDIT_2026-08-08.md`
- Active target architecture: `docs/refactor/TARGET_ARCHITECTURE.md`
- Sequenced plan and completion criteria: `docs/refactor/PLAN.md`
- Active dependency-aware queue: `docs/refactor/TASKS.yaml`
- Prior current-state record: `docs/architecture/CURRENT_STATE.md`
- Compiler-boundary decisions: `docs/agent/POST_STABILIZATION_VERIFICATION_PLAN.md`
