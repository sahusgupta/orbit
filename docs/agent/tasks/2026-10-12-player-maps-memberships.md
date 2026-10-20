# Player maps and membership presentation

This focused portion of Orbit Match preserves the existing membership, identity, payment-confirmation, short-lived QR, and seat-request workflows. It does not deploy or access a live service.

## Presentation and directions

- Club selectors expose named button and selected states, show published city/activity without inventing player distance, and provide touch targets of at least 44 points.
- Membership presentation uses the shared dark palette, readable labels, published expiry where available, and an expired state when a stored Active membership is past its expiry. Expired access does not display a check-in action or a scan promise. Approved access retains physical-ID and in-person fee confirmation. Demo memberships retain their explicit preview notice and never mount the real QR issuer.
- Venue maps frame all validated published coordinates, including locations spanning the antimeridian. Missing coordinates produce the existing empty state; no fallback venue coordinates or player origin are introduced.
- iOS uses the existing Apple MapKit provider. Directions prefer a validated published coordinate, otherwise the published address. iOS 18.4 and later use Apple's unified driving-directions URL; older or unknown iOS versions keep the compatible legacy Maps URL over HTTPS. Android and browser handoffs retain their existing providers. Failed or missing-destination handoffs show a visible recovery alert and return an explicit result.

Apple's [unified Maps URL documentation](https://developer.apple.com/documentation/mapkit/unified-map-urls) defines coordinate/address destinations and the iOS 18.4 availability boundary. Opening external directions does not require Orbit to request device location.

## Verification record

All focused test commands selected `ORBIT_API_URL=http://127.0.0.1:9`, `EXPO_PUBLIC_ORBIT_API_URL=http://127.0.0.1:9`, and `VITE_ENABLE_FIREBASE_SYNC=false`. Native map/link and service boundaries were mocked.

- Before these changes, the Match, club routes, membership wallet, venue map, and platform characterization suites passed: 5 files, 40 tests.
- After the membership/map changes, the focused suites passed: 8 files, 61 tests. These included existing club action/hub tests and new map framing, URL, failure-recovery, expired-membership, selection-accessibility, and touch-target checks.
- A subsequent combined run during a separate dependency reinstall had 5 render suites fail to resolve `react-native` before tests could run; 4 remaining files passed 18 tests. The Player typecheck also reported missing native dependencies and an in-progress location-hook nullability error. These attempts failed and were repeated after the install completed.
- The final focused run passed: 9 files, 76 tests. It additionally covered compact Match preference disclosures, saved-list paging, reduced-motion and stale-gesture guards, and failed/concurrent preference saves. `npm run player:typecheck` passed after dependency restoration and the parallel fixes.
- `git diff --check` passed at this stage. No commit or push was made.

These mocked checks do not establish Apple Maps app handoff, native layout, or physical-device performance. Actual native-device validation remains a separate gate; the current Windows environment has no supported emulator tools on PATH.
