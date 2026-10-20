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
    expect(source).toContain('iOS v1 sign-in screen uses email/password and does not offer phone-passcode delivery');
    expect(source).toContain('Tournament interest is nonbinding');
    expect(source).toContain('does not save or upload a document image, raw barcode, or document number');
    expect(source).toContain('name, email address, optional phone number');
    expect(source).toContain('Firebase-verified email address');
    expect(source).toContain('optional expected-arrival time');
    expect(source).toContain('short-lived QR token itself contains no personal information');
    expect(source).toContain('validated venue-published coordinates');
    expect(source).toContain('requests foreground device location only when you choose Use my device location');
    expect(source).toContain('not sent to Orbit servers, your profile, or Match analytics');
    expect(source).toContain('Device points expire after 15 minutes');
    expect(source).toContain('Manual points remain until cleared or local account data is deleted');
    expect(source).toContain('Background location is not used');
    expect(source).not.toContain('does not request device GPS');
    expect(source).toContain('capture method/time');
    expect(source).toContain('optional venue-published plan classification');
    expect(source).toContain('Firebase App Check');
    expect(source).toContain('temporary verification cookie');
    expect(source).toContain('does not store these tokens in application records or logs');
    expect(source).not.toMatch(/Codex|AI-development disclosure/);
  });

  it('preserves the download-site metadata injection boundary only on static pages', () => {
    expect(renderDocument('support', documents.support, false)).toContain('<!-- orbit-public-metadata -->');
    expect(renderDocument('support', documents.support, true)).not.toContain('<!-- orbit-public-metadata -->');
  });

  it('keeps Match data, local location, retention, and venue disclosure consistent across canonical privacy copies', () => {
    const privacyCopies = [
      fs.readFileSync(path.join(root, 'apps/api/public/privacy.html'), 'utf8'),
      fs.readFileSync(path.join(root, 'download-site/privacy.html'), 'utf8'),
      fs.readFileSync(path.join(root, 'player-web/app/privacy/page.tsx'), 'utf8')
    ];
    for (const privacy of privacyCopies) {
      expect(privacy).toContain('Orbit Match discovery');
      expect(privacy).toContain('Match-specific preferences, saves, dismissals, and interaction history are not added to venue requests');
      expect(privacy).toContain('200 recent interaction events and 300 recent dismissals in a 30-day history window');
      expect(privacy).toContain('until account deletion so a delayed offline retry cannot apply twice');
      expect(privacy).toContain('not sent to Orbit servers, your profile, or Match analytics');
      expect(privacy).toContain('October 20, 2026');
      expect(privacy).toContain('Caminus Labs, LLC');
    }
    expect(documents.privacy.updated).toBe('October 20, 2026');
    expect(privacyCopies[2]).toContain("dateModified: '2026-10-20'");
  });

  it('describes private free-event entrant records without promising payments or automatic admission', () => {
    const privacyCopies = [
      renderDocument('privacy', documents.privacy, true),
      renderDocument('privacy', documents.privacy, false),
      fs.readFileSync(path.join(root, 'player-web/app/privacy/page.tsx'), 'utf8')
    ];
    for (const privacy of privacyCopies) {
      expect(privacy).toContain('linked venue profile identifier when available');
      expect(privacy).toContain('trusted account or linked-profile name');
      expect(privacy).toContain('verified contact details when available');
      expect(privacy).toContain('opaque entrant identifier, status, and registration time');
      expect(privacy).toContain('operational entrant list');
      expect(privacy).toContain('Registration creates no payment, ledger entry, or debt');
      expect(privacy).toContain('Paid events continue to offer nonbinding interest');
      expect(privacy).toContain('Public listings do not contain personal registration records');
      expect(privacy).toContain('signed-in registration status is returned only for your own account');
      expect(privacy).toContain('removes personal tournament entrant records linked to the account from Orbit-controlled venue state');
    }
    expect(documents.terms.updated).toBe('October 20, 2026');
    for (const apiTarget of [false, true]) {
      const terms = renderDocument('terms', documents.terms, apiTarget);
      expect(terms).toContain('October 20, 2026');
      expect(terms).toContain('Registration creates no payment, ledger entry, or debt');
      expect(terms).toContain('withdrawing nonbinding interest does not cancel an entrant-list registration');
      expect(terms).toContain('The venue still confirms eligibility, check-in, seating, and participation');
    }
  });
});
