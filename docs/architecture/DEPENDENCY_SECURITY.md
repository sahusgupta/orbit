# Production dependency security

`npm run security:dependencies` audits the root, API, and Player production dependency graphs directly against the npm advisory service. Unknown advisories and every critical advisory fail the gate. Reviewed exceptions expire on the date in `config/dependency-audit-policy.json`; an expired policy fails closed.

## 2026-09-04 compatible remediation

No blanket or forced audit fix was used. The following transitive corrections stay within the compatible package lines selected by their parents:

| Package | Before | After | Scope and reason |
| --- | --- | --- | --- |
| `brace-expansion` | 5.0.8 | 5.0.9 | Removes the current unbounded-intermediate-array advisory in root and Player build/package chains; MIT, Node 20 or 22+. |
| `js-yaml` | 4.3.0 and Player 3.x/4.x paths | 3.15.1 or 4.3.1 by parent range | Removes the current quadratic `!!omap` advisory without forcing 3.x consumers onto the 4.x API. MIT. |
| `nanoid` | 3.3.17 | 3.3.18 | Removes the updated zero-size custom-generator advisory within the existing 3.x API. MIT. |
| `fast-uri` | 3.1.4 | 3.1.5 | Removes the Player toolchain host-confusion advisory within the existing 3.x API. BSD-3-Clause. |
| `qs` | 6.15.3 | 6.16.0 | Removes the array-limit and attacker-controlled `isBuffer` denial-of-service advisories from the Express/Stripe API graph within the compatible 6.x line. BSD-3-Clause. |
| `@xmldom/xmldom` | 0.8.13 / 0.9.10 | 0.8.15 / 0.9.12 by parent range | Removes the XML serialization fragment-injection advisory without forcing Expo's 0.8 consumer across a minor API boundary. MIT. |
| `browserslist` | 4.28.2 | 4.28.9 | Removes the unbounded-cache and malformed custom-stats denial-of-service advisories within the compatible 4.x line. MIT. |

After the lockfile-only changes, the root, API, and Player Web production audits report zero vulnerabilities. The Player audit reports eight reviewed High entries and no Moderate or Critical entry.

## Player residual advisory reachability

The remaining eight npm entries form one Expo SDK 54 Metro build-tool chain. The originating vulnerable parser is `image-size@1.2.1`, reached by `metro@0.83.3`; npm marks the installed toolchain as affected and currently offers only an incompatible Expo major upgrade as the automated repair. That is not a safe first-release lockfile change without the required native migration and regression work.

Metro and `image-size` parse repository-controlled application assets during local/CI bundling. They are not a Player feature that parses remote user images at runtime. The direct `expo` entry and the remaining Expo/Metro entries are effects of that transitive build chain in npm's graph; repository searches found no application import of `image-size` or the Metro parser API. This narrows exposure to denial of service against a developer or CI build supplied with a malicious repository asset. It does not prove the advisory harmless or complete a future safeguard.

Current mitigation is to accept assets only through reviewed repository changes, keep build jobs time-bounded, fail on any new advisory/package/severity, and re-evaluate no later than 2026-09-30 or when Expo ships a compatible Metro/parser correction. Native Player builds and purchase/auth flows must be retested before any Expo SDK migration. The policy must not be extended without a fresh graph, advisory, compatibility, and runtime-reachability review.
