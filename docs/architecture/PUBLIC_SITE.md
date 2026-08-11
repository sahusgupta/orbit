# Public site architecture

Orbit's public home, product, support, privacy, terms, and error documents are immutable static HTML built from `download-site/`. They do not depend on the API, Firebase, or a third-party metadata request to render meaningful content.

## Origin configuration

The final production hostname is intentionally not stored in the repository. `download-site/public-config.mjs` resolves the build origin in this order:

1. `ORBIT_PUBLIC_ORIGIN` for an explicitly approved deployed origin.
2. `ORBIT_PUBLIC_PREVIEW_ORIGIN` for an explicit preview.
3. `VERCEL_URL` for a provider preview hostname.
4. `ORBIT_PUBLIC_LOCAL_ORIGIN`, defaulting to `http://127.0.0.1:4174`, for local work.

The selected origin must be an absolute HTTP(S) origin with no credentials, path, query, or fragment. It drives canonical URLs, Open Graph URLs/images, JSON-LD URLs, `sitemap.xml`, `robots.txt`, and `llms.txt`.

Do not set a canonical production value, change DNS/registrar/certificates, update production client links, or perform a domain cutover without later explicit founder approval.

## Build and verification

`npm run download:build` creates `download-dist/`. `npm run check:public-site` performs a deterministic preview-origin build and verifies page metadata, one-H1 structure, schema parsing, index membership, crawler policies, emitted OG/favicon assets, meaningful static source, canonical-origin injection, and absence of public source maps.

The release manifest is same-origin and contains no fallback to a personal repository. A real installer URL is populated only by a later approved release-promotion process. The site intentionally contains no visitor counter, popularity metrics, testimonials, reviews, or unverified social links.
