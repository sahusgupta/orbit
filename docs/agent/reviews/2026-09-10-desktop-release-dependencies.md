# Dependency remediation for the table/time desktop release

The user authorized dependency remediation, deployment, and availability through the in-app updater after PR #28's security gate failed.

## Changes

- Require electron-updater 6.8.9 or later within major 6 (the lockfile already resolved 6.8.9).
- Upgrade Nodemailer from 9.0.1 to 9.1.1.
- Upgrade root js-yaml to 4.3.2 and the Player's existing major-specific overrides to 3.15.2 and 4.3.2.
- Upgrade Player Web Next.js and its matching ESLint config from 16.3.0 to 16.3.4. The resulting locked Sharp/libvips and Next.js platform binaries are upgraded as required by that release.
- Bundle the existing Manrope and DM Mono Latin fonts with their licenses and use next/font/local. The initial upgraded web build failed to fetch Google Fonts; local assets remove this external build dependency.
- Load FloorUtilities as a separate React lazy bundle with an accessible loading state. The renderer initially exceeded its existing gzip budget by 737 bytes; the budget itself is unchanged.
- Preserve all existing dependency security gates and reviewed exceptions. No new allowlist entries were added.

The web lockfile retains its prior package order to keep the npm-generated changes reviewable. Package contents and integrity values are npm-generated.

## Verification

The production dependency gate passes: root, API, and web report no advisories. Player retains the existing eight reviewed Expo/Metro/image-size exceptions under the policy due for review on 2026-09-30. These are not represented as fixed.

Final `npm run verify`: all 13 gates passed, including 1,383 unit tests (8 existing skips), 209 web tests, 85 sales-map tests, all TypeScript checks, lint, and all production builds. Renderer budget passed at 609,297 raw / 187,955 gzip JavaScript bytes. Release-control, module-graph, independent-lockfile, public-site, and brand checks also passed. Installs use Node 22.16.0 and npm 10.9.2. Runtime verification uses TZ=UTC, localhost API endpoints, and disabled Firebase sync.

## In-app delivery

The packaged desktop app uses the sahusgupta/orbit stable GitHub release feed, checks on startup and every 30 minutes, and automatically downloads stable updates. It then asks the user to install, preserving workspace state first. Prereleases are excluded. The existing release workflow must produce and promote the Windows installer and latest.yml together; committing source alone does not make an update available.

Target the next unused stable version (0.1.76 at the time of this review) through `Verify and Promote Desktop Release`, using the exact approved commit SHA and the existing production-release environment. No workflow triggers or approval controls were changed.

## Advisory sources

- https://github.com/advisories/GHSA-p293-qw3h-jr36
- https://github.com/advisories/GHSA-2xp9-vwfh-vxw4
- https://github.com/advisories/GHSA-rgj7-g3m4-5g8c
- https://github.com/advisories/GHSA-2883-xcg3-v3hh
- https://github.com/advisories/GHSA-8m3c-c648-2xjj
