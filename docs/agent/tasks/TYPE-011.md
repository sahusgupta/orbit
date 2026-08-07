# TYPE-011: Prove an owned Web Crypto buffer source

## Objective

Resolve the Web Crypto `BufferSource` diagnostic without an assertion and without weakening pilot signature verification.

## Evidence

`verifyPilotSignature` passes `ArrayBufferLike` returned through `derToRawP256Signature` to `crypto.subtle.verify`; DOM types correctly allow that value to be `SharedArrayBuffer`.

## In scope

- Characterize DER-to-raw conversion and verification inputs.
- Return or construct an owned `ArrayBuffer`-compatible value by construction.

## Out of scope

Key rotation, license format changes, signing-service changes, pilot authorization policy, or cryptographic algorithm replacement.

## Allowed areas

Signature decoding/verification helpers and isolated browser-compatible crypto tests.

## Prohibited changes

Do not cast to `BufferSource`, cast through `unknown`, skip verification, accept malformed signatures, or log key material.

## Acceptance criteria

- The assigned diagnostic disappears through a proven buffer type.
- Valid signatures pass and invalid/malformed/wrong-key signatures fail exactly as characterized.

## Required tests

Valid, wrong-key, modified payload, malformed DER, wrong-length raw, and unsupported-key cases.

## Verification commands

`npm run typecheck`, focused browser-compatible crypto tests, `npm test`, `npm run build`, `npm run verify`.

## Risks

High: this is a licensing security boundary.

## Dependencies

None.

## Stop conditions

Stop if current verification cannot be characterized with non-secret test keys or if the fix would alter the signed payload/license format.

## Resolution record — 2026-08-07

- In-memory non-secret test keys characterize valid raw and DER signatures, wrong-key signatures, modified payloads, malformed DER, wrong-length raw input, and an RSA key unsupported by the P-256 verifier.
- The raw 64-byte fast path now copies with `Uint8Array.from(signature).buffer`, matching the DER path's owned `ArrayBuffer` construction.
- No `BufferSource` assertion, payload/format change, algorithm change, verification bypass, key logging, or external service was introduced.
- The owned diagnostic disappeared and all five focused cases pass before and after the production change.
