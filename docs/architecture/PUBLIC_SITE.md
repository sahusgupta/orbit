# Public site architecture

Orbit's public home, product, FAQ, support, privacy, terms, and error documents are immutable static HTML built from `download-site/`. They do not depend on the API, Firebase, or a third-party metadata request to render meaningful content.

## Public presentation and evidence

The Stage 7 Astryx presentation uses a specific operating narrative rather than testimonials, popularity numbers, pricing cards, or a logo carousel. Product capabilities are arranged as six restrained, uniform playing-card-inspired panels. The FAQ is a custom native `details`/`summary` disclosure system with visible keyboard focus, programmatic open state, responsive layout, and reduced-motion behavior. Its answers are limited to behavior established by the repository.

`download-site/public/art/orbit-table-rhythm-v1.jpg` is intentionally generated abstract artwork. It depicts blank card planes, rails, and restrained chip-like discs only. It must not be described as a product screenshot, room, customer, usage record, or metric. It was generated with the built-in image-generation path from this final production prompt:

> Create a wide premium abstract editorial illustration inspired by live poker-room rhythm using matte blank playing-card planes, table-rail arcs, and restrained chip-like discs on a deep graphite field. Use warm ivory, muted teal, and one burnt-orange accent with controlled studio light and selective natural shadow. Leave clean negative space. No text, letters, numbers, suits, logos, watermark, UI, dashboard, device screen, product mockup, people, customers, venue, usage, metrics, screenshots, glow, aurora, gradient blobs, noisy grain, glassmorphism, or casino kitsch.

`download-site/public/proof/orbit-core-empty-workspace.jpg` is a current application capture, not generated imagery. `npm run capture:public-proof` launches the management renderer with Firebase sync disabled, a deliberately unreachable local API, and a zero-record local workspace. The only workspace identifier is the explicit phrase `Workspace identity redacted`; the script fails if smoke-fixture names enter the capture. This gives reviewers reproducible evidence of the current UI without customer, player, or production data. It is intentionally an empty-state proof and must not be presented as customer usage.

## Origin configuration

The final production hostname is intentionally not stored in the repository. `download-site/public-config.mjs` resolves the build origin in this order:

1. `ORBIT_PUBLIC_ORIGIN` for an explicitly approved deployed origin.
2. `ORBIT_PUBLIC_PREVIEW_ORIGIN` for an explicit preview.
3. `VERCEL_URL` for a provider preview hostname.
4. `ORBIT_PUBLIC_LOCAL_ORIGIN`, defaulting to `http://127.0.0.1:4174`, for local work.

The selected origin must be an absolute HTTP(S) origin with no credentials, path, query, or fragment. It drives canonical URLs, Open Graph URLs/images, JSON-LD URLs, `sitemap.xml`, `robots.txt`, and `llms.txt`.

Do not set a canonical production value, change DNS/registrar/certificates, update production client links, or perform a domain cutover without later explicit founder approval.

## Build and verification

`npm run download:build` creates `download-dist/`. `npm run check:public-site` performs a deterministic preview-origin build and verifies page metadata, one-H1 structure, schema parsing, index membership, crawler policies, emitted OG/favicon assets, the abstract art and current product-proof assets, factual FAQ structure, prohibited marketing/visual patterns, meaningful static source, canonical-origin injection, and absence of public source maps. `npm run e2e:public` verifies all eight routes at desktop and mobile widths, keyboard operation of the FAQ, product-proof loading, release-manifest fallback, horizontal overflow, and clean page/console/network results.

The release manifest is same-origin and contains no fallback to a personal repository. A real installer URL is populated only by a later approved release-promotion process. The site intentionally contains no visitor counter, popularity metrics, testimonials, reviews, or unverified social links.
