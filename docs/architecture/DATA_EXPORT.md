# Management data export

Orbit keeps two deliberately different JSON downloads in Settings:

- **Export Room Data** is a versioned portability export. It contains every operational and customer-data collection in `AppState`, including permanent physical tables, plus non-secret settings. It excludes account password hashes and salts, staff PIN hashes and salts, pilot authorization codes, and local key-file metadata.
- **Export Restorable Backup** preserves the existing full-state restore contract. Because it contains credential verifiers and license material, the UI identifies it as a sensitive backup rather than a general-purpose data export.

The portability projection lives in `src/lib/dataExport.ts`. Its collection-key list has a compile-time completeness check, deep-clones exported values, and must be updated whenever a top-level `AppState` collection is added.

An expired license does not prevent a room from retrieving its data. When a local account exists, the access screen verifies its email and password locally before creating the sanitized portability export. Legacy states that predate local sign-in still receive a direct sanitized export action because they have no application credential to verify. Neither path authenticates the operator, unlocks management routes, persists new state, or calls a hosted service. Normal signed-in exports are also produced entirely from the loaded state and do not depend on network availability.
