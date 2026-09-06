import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { documents, operator, renderDocument } = require('./import-legal-documents.cjs');
const root = path.resolve(import.meta.dirname, '..');

describe('repository-controlled legal and support documents', () => {
  it('are deterministic across the API and download surfaces', () => {
    for (const [kind, document] of Object.entries(documents)) {
      expect(fs.readFileSync(path.join(root, 'apps/api/public', `${kind}.html`), 'utf8')).toBe(renderDocument(kind, document, true));
      expect(fs.readFileSync(path.join(root, 'download-site', `${kind}.html`), 'utf8')).toBe(renderDocument(kind, document, false));
    }
  });

  it('uses the actual operator and conservative first-release disclosures', () => {
    const source = Object.values(documents).flatMap((document) => document.sections.map((section) => section[2])).join('\n');
    expect(operator).toBe('Caminus Labs, LLC');
    expect(source).not.toMatch(/Orbit Technologies LLC|RevenueCat/);
    expect(source).toContain('Stripe Identity');
    expect(source).toContain('does not use Stripe for payments or checkout');
    expect(source).toContain('no paid premium subscription');
    expect(source).toContain('no player-hosted/private game feature');
    expect(source).toContain('no venue checkout');
    expect(source).toContain('no push notifications');
    expect(source).toContain('Tournament interest is nonbinding');
    expect(source).toContain('does not save or upload a document image, raw barcode, or document number');
    expect(source).toContain('name, email address, optional phone number');
    expect(source).toContain('Firebase-verified email address');
    expect(source).toContain('optional expected-arrival time');
    expect(source).toContain('short-lived QR token itself contains no personal information');
    expect(source).toContain('validated venue-published coordinates');
    expect(source).toContain('does not request device GPS location or send a player-origin coordinate');
    expect(source).toContain('capture method/time');
    expect(source).toContain('optional venue-published plan classification');
    expect(source).not.toMatch(/Codex|AI-development disclosure/);
  });

  it('preserves the download-site metadata injection boundary only on static pages', () => {
    expect(renderDocument('support', documents.support, false)).toContain('<!-- orbit-public-metadata -->');
    expect(renderDocument('support', documents.support, true)).not.toContain('<!-- orbit-public-metadata -->');
  });
});
