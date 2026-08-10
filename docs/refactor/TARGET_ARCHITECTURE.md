# Orbit Target Architecture

Date: 2026-08-08

Status: achieved and terminally audited on 2026-08-10

## Dependency direction

Orbit should converge pragmatically on:

```text
runtime composition and presentation
  -> application commands, queries, and orchestration
    -> pure domain rules and canonical contracts
      -> repository/service ports
        -> browser, Electron, Firebase, HTTP, SQLite, Stripe, and native adapters
```

The rule is about ownership and test seams, not mandatory class layers. A pure function does not need an interface. A platform adapter does not need a wrapper that merely renames a library call.

## Management renderer

Target owners:

```text
src/
  app/
    App.tsx                    composition, route selection, top-level feature wiring
    persistence/              browser/preload/Firebase coordination and result policy
  application/management/
    waitlistCommands.ts       explicit AppState transitions
    seatingCommands.ts
    tableCommands.ts
    profileCommands.ts
    membershipCommands.ts
    tournamentCommands.ts
    closeoutCommands.ts
  domain/                     canonical types, validation, pure projections/rules
  features/                   route-specific hooks and presentation
  components/                 reusable presentation
  lib/                        bounded platform adapters and protocol owners
```

`App` should select state, compose feature hooks/components, and invoke application commands. It should not parse imported records, implement table/player transitions, construct domain objects ad hoc, or decide how the same state is written to three persistence targets.

Application commands should accept explicit state/input/time/ID dependencies and return canonical state plus explicit domain outcomes where the UI needs a notice or selection. They must not access React, the DOM, local storage, Firebase, or Electron.

## Player application

Target owners:

```text
player-app/src/
  app/                         Expo composition, navigation, application hooks
  application/                Player use cases and state orchestration
  domain/                     canonical Player types, decoders, selectors, rules
  data/
    api/                       authenticated HTTP adapter
    firebase/                  Firebase auth/Firestore adapters
    subscriptions/             live refresh ownership
    storage/                   AsyncStorage migration/persistence
  features/                    discovery, tournaments, clubs, identity, settings
  components/                  shared React Native presentation
  styles/                      feature-owned style definitions/tokens
```

Player domain and application modules must avoid React Native imports so a future Player web surface can reuse them. Native maps, RevenueCat, AsyncStorage, Expo linking/browser behavior, and React Native presentation remain platform-specific.

## API

The current process/app/routes/repositories structure remains. New work should focus only where evidence exists:

- one privileged Firebase Admin credential/app owner for identity, licensing, and payment consumers;
- one explicit Stripe client owner with identity/payment capability access;
- runtime validation before untrusted webhook/Firestore/HTTP data becomes a domain object;
- no change to route order, status bodies, database schema, publication semantics, or deployment containment.

## Electron

`electron/main.cjs` remains the composition root. Extract only a cohesive remaining use case when characterization shows that window/IPC/lifecycle composition is obscured. Do not create generic services around the already focused local store, API client, embedded backend, updater, or runtime utilities.

## Contracts and sharing

- Management `AppState` remains canonical in `src/domain/types.ts`.
- Player-facing snapshot/request contracts remain canonical in `player-app/src/domain/playerSync.ts` until a separately verified cross-lockfile package can own them.
- API/Electron server transforms remain canonical in `apps/api/src/shared/orbitCore.cjs`.
- Similar names across those boundaries do not prove identical behavior.
- New raw-data decoders should produce canonical objects or explicit rejection/legacy-normalization outcomes; assertions are not validation.

## Error policy

Expected optional/offline failures may retain fallback behavior, but the owner must make that policy explicit. Application code should distinguish:

- expected unavailable optional service;
- validation/rejected external record;
- retryable transport failure;
- user-action failure;
- invariant/programming failure.

The refactor must preserve current user-visible failure semantics unless a separate bug task proves and changes them.

## Performance policy

Keep the current build artifact sizes as the bundle baseline. Any performance task must record a before/after measurement and the workload. Route-level or feature-level lazy loading is preferred only when module ownership makes the split comprehensible. Do not replace readable calculations with speculative caches.

## Completion shape

At completion:

- management and Player entrypoints primarily compose state, effects, routes, and feature owners;
- important state transitions have direct pure tests rather than requiring entrypoint inspection;
- raw HTTP/Firestore data is validated before canonical use;
- persistence and external services have explicit adapters;
- remaining large files have one documented cohesive responsibility;
- the queue is complete, verification is green, and `FINAL_REFACTOR_REPORT.md` matches the code.
