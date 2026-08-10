# Orbit Player Web Planning

This directory remains an implementation-readiness inventory, not an authorization to design or build an Orbit Player website.

## Directly reusable platform-neutral source

- `player-app/src/domain/playerTypes.ts`: navigation, filter, opportunity, coordinate, and draft contracts.
- `player-app/src/domain/playerSync.ts`: canonical Player account, snapshot, membership, waitlist, tournament, private-game, and request contracts plus pure membership/request rules.
- `player-app/src/domain/discovery.ts`: discovery, distance, filtering, ordering, grouping, labels, validation, and immutable preference helpers.
- `player-app/src/domain/syncProtocol.ts`: protocol-v2 revision/commit selection.
- `player-app/src/domain/playerIdentity.ts`: canonical identity-verification contract.
- `player-app/src/domain/decoders/playerBoundaryDecoders.ts`, `playerGameDecoder.ts`, and `playerSnapshotDecoders.ts`: structural response/document validation and explicit legacy outcomes without Firebase, React Native, or Expo runtime imports.
- `player-app/src/domain/playerSnapshotTransforms.ts`: platform-neutral revision-aware filtering, merging, freshness, and projection.
- `player-app/src/data/playerRequests.ts`: pure membership/waitlist request construction and local snapshot transforms.
- Other focused pure Player modules under `domain/`, including access, visibility, preference, notification, and membership-QR rules.

## Reusable with an explicit web adapter decision

- `player-app/src/application/` contains React orchestration with no React Native imports, but its hooks currently import the concrete Player data facade. A web composition can reuse them only if that facade remains compatible or is supplied through a future port.
- `player-app/src/data/api/` and `data/firebase/` now have separate responsibilities, so a web client can select compatible Firebase Web/HTTP owners instead of inheriting the full native data monolith.
- `player-app/src/data/orbitSyncApi.ts` is a stable 66-line compatibility facade, not the implementation owner for new transport behavior.

## Platform-specific boundaries

React Native feature/components/styles, native maps, `app/playerPlatform.ts`, AsyncStorage wiring, RevenueCat, Expo browser/linking behavior, and native/EAS build configuration are not claimed as web-ready.

REF-021, REF-023, REF-025, and REF-029 established this inventory. No website routes, UI, deployment plan, framework choice, or web product behavior is defined here.
