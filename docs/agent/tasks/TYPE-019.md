# TYPE-019: Add download-site compiler coverage

Status: `planned`

## Objective

Semantically check the download site's browser JavaScript and its Node/Vite configuration without changing publication behavior.

## Current missing coverage

`download-site/main.js` and `download-site/vite.config.mjs` are built/executed by Vite but are outside all TypeScript projects.

## Exact paths involved

- `download-site/main.js`
- `download-site/vite.config.mjs`
- proposed download-site browser and tooling check-JS configurations
- root typecheck aggregation only if approved

## Proposed compiler configuration

Use a browser check-JS project for `main.js` with `DOM` and `ES2022`, and a NodeNext/Node/ES2022 tooling project for `vite.config.mjs`. Keep browser and Node globals separate and do not add project references.

## Expected diagnostics

A read-only combined probe observed 2 diagnostics in `download-site/main.js` for `href` access on broadly typed `Element` values; the Vite config added none.

## JavaScript checkJs

Required for both JavaScript/MJS files.

## Required tests and builds

Download-site check-JS, `npm run download:build`, relevant link/navigation checks, and `npm run verify`. Do not publish the site.

## Security implications

The site distributes desktop artifacts and legal/support links. Compiler changes must not alter download URLs, publication paths, or artifact staging behavior.

## Dependencies

Independent future work after `TYPE-001`; coordinate its Node config ownership with `TYPE-017` without merging the tasks.

## Autonomous implementation

Not safe for autonomous implementation because download/link behavior and publication boundaries need human review.
