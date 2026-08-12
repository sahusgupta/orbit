# Production dependency security

`npm run security:dependencies` audits the root, API, and Player production dependency graphs directly against the npm advisory service. Unknown advisories and every critical advisory fail the gate. Reviewed exceptions expire on the date in `config/dependency-audit-policy.json`; an expired policy fails closed.

## 2026-08-11 compatible remediation

No blanket or forced audit fix was used. The following transitive corrections stay within the compatible package lines selected by their parents:

| Package | Before | After | Scope and reason |
| --- | --- | --- | --- |
| `brace-expansion` | 5.0.8 | 5.0.9 | Removes the current unbounded-intermediate-array advisory in root and Player build/package chains; MIT, Node 20 or 22+. |
| `js-yaml` | 4.3.0 and Player 3.x/4.x paths | 3.15.1 or 4.3.1 by parent range | Removes the current quadratic `!!omap` advisory without forcing 3.x consumers onto the 4.x API. MIT. |
| `nanoid` | 3.3.16 | 3.3.17 | Removes the zero-size custom-generator advisory within the existing 3.x API. MIT. |
| `fast-uri` | 3.1.4 | 3.1.5 | Removes the Player toolchain host-confusion advisory within the existing 3.x API. BSD-3-Clause. |

After the lockfile-only changes, the root and API production audits report zero vulnerabilities. The Player audit falls from 16 High entries to 11 High entries.

## Player residual advisory reachability

The remaining eleven npm entries form one Expo SDK 54 / React Native 0.81 Metro build-tool chain. The originating vulnerable parser is `image-size@1.2.1`, reached by `metro@0.83.3`; npm currently marks every `image-size` version as affected and proposes downgrading Expo to SDK 53, React Native to 0.72, and RevenueCat Purchases to 8.12. Those are incompatible major/platform downgrades, not safe fixes for the current supported Expo 54 application.

Metro and `image-size` parse repository-controlled application assets during local/CI bundling. They are not included as a Player feature that parses remote user images at runtime. The direct `expo`, `react-native`, and `react-native-purchases` entries are effects of that transitive build chain in npm's graph; repository searches found no application import of `image-size` or Metro parser API. This narrows exposure to a denial of service against a developer or CI build supplied with a malicious repository asset. It does not prove the advisory harmless or complete a future safeguard.

Current mitigation is to accept assets only through reviewed repository changes, keep build jobs time-bounded, fail on any new advisory/package/severity, and re-evaluate no later than 2026-09-30 or when Expo ships a compatible Metro/parser correction. Native Player builds and purchase/auth flows must be retested before any Expo SDK migration. The policy must not be extended without a fresh graph, advisory, compatibility, and runtime-reachability review.
