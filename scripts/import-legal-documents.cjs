const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const operator = 'Caminus Labs, LLC';
const updated = 'September 4, 2026';

const documents = {
  privacy: {
    title: 'Orbit Privacy Policy',
    description: 'How Caminus Labs, LLC handles data for Orbit Player and related Orbit services.',
    summary: 'This policy describes the conservative first release of Orbit Player, including local and signed-in profiles, venue requests, tournament interest, check-in, and optional PDF417 identity capture.',
    sections: [
      ['operator-and-scope', '1. Operator and scope', `
        <p>Orbit and Orbit Player are product names. ${operator} operates the Orbit services covered by this policy. A participating venue remains independently responsible for its own records, staff decisions, poker operations, and legal obligations.</p>
        <p>This policy covers Orbit Player, Orbit Core, the Orbit API, and repository-controlled Orbit websites. It does not describe a venue's separate systems or practices.</p>`],
      ['information-we-handle', '2. Information we handle', `
        <h3>Local-only profile</h3><p>You can use local features without a cloud account. A local profile can contain your name, email address, optional phone number, adult-eligibility response, optional home-area text, preferred games and stakes, typical availability, favorite venues, search-radius preference, and cached venue information. It remains on that device unless you choose to sign in or submit information to a venue.</p>
        <h3>Signed-in account</h3><p>An authenticated account can contain your Firebase identifier, full name, email address, optional phone number, adult-eligibility response, optional home-area text, preferences, and authentication/security records. Passwords are handled by Firebase Authentication rather than stored by Orbit in readable form.</p>
        <h3>Venue activity</h3><p>We handle the venue, game, table, membership, waitlist, seat-request, check-in, and tournament-interest identifiers and statuses you choose to create, together with timestamps, idempotency identifiers, arrival or availability information you provide, and venue responses. Tournament interest is nonbinding; it is not an event registration, seat reservation, debt, payment, or prize claim.</p>
        <h3>PDF417 identity fields</h3><p>If you choose the in-app government-ID barcode flow, the app reads the PDF417 barcode on your device and previews the extracted full name, date of birth, and address before submission. Orbit does not save or upload a document image, raw barcode, or document number. Only the fields you confirm, the capture method/time, resulting age/provisional status, review status, and audit timestamps may be sent to your signed-in account and venue-authoritative state.</p>
        <h3>Technical and support data</h3><p>We may handle IP address, device and browser type, request time, response status, security events, crash or diagnostic details, and the information you provide when requesting support. Orbit Player does not use this information for cross-app tracking.</p>`],
      ['how-we-use-information', '3. How we use information', `
        <ul><li>Authenticate accounts and protect access.</li><li>Show factual venue, game, and tournament information.</li><li>Send membership, waitlist, seat, check-in, and nonbinding tournament-interest requests to the venue the player selected.</li><li>Issue and validate short-lived venue check-in credentials.</li><li>Maintain service integrity, prevent replay or abuse, investigate errors, and respond to support or privacy requests.</li><li>Comply with applicable law and enforce the Terms of Service.</li></ul>
        <p>The first iOS release has no paid premium subscription, no player-hosted/private game feature, and no venue checkout. There are no push notifications or general game-update messaging service. Phone one-time passcodes may be sent only when a user chooses phone authentication.</p>`],
      ['venue-disclosure', '4. What participating venues receive', `
        <p>When you direct an action to a participating venue, its authorized staff may receive your immutable Orbit account identifier and display name. The venue-authoritative profile also receives a Firebase-verified email address when the authentication token provides one, or the Firebase-verified phone number for phone authentication; a phone-authenticated request does not forward a client-supplied email. A membership request includes the selected published option identifier and name, duration, displayed price label, optional venue-published plan classification, in-person payment method, request/status timestamps, and the bounded profile preferences sent with that request: optional home-area text, search-radius preference, preferred games and stakes, favorite venues, and typical availability.</p>
        <p>A waitlist or seat request includes the selected venue and game, optional table, join or cancel action, arrived/confirmed/interested attendance choice, optional expected-arrival time, optional availability start and end, a note derived from typical availability when present, and request/status timestamps. A tournament-interest action includes the selected venue and tournament, interested or withdrawn status, timestamps, and an opaque idempotency identifier. A check-in issue request sends the authenticated player identifier, selected venue, and an opaque mutation identifier to Orbit. The short-lived QR token itself contains no personal information; after authenticated redemption, venue staff receive the linked player display name and check-in status, while Orbit records the token identifier, purpose, issue/expiration times, and redemption state.</p>
        <p>If you separately confirm PDF417-derived details for an eligibility flow associated with that venue, authorized venue staff may receive the confirmed full name, date of birth, address, capture method/time, and provisional or staff-review status. Orbit does not provide the venue with a stored ID image, raw barcode, or document number because Orbit does not retain those items.</p>`],
      ['service-providers', '5. Service providers', `
        <ul><li><strong>Google Firebase and Google Cloud</strong> provide authentication, database, server, and security infrastructure and may process account identifiers, contact details, tokens, profiles, requests, and operational records, including an optional account phone number when entered.</li><li><strong>Vercel</strong> hosts public pages and API services and may process network/request metadata and data sent to those services.</li><li><strong>Twilio</strong> may process the phone number used as an OTP destination, one-time-passcode delivery status, and related metadata only when phone authentication is used.</li><li><strong>Stripe Identity</strong> may conditionally process an identity document and verification data when the separately configured hosted Player Web compatibility flow is deliberately started; Orbit receives bounded verification results and provider-session metadata. That hosted flow is separate from the iOS v1 on-device PDF417 preview, and the iOS v1 does not use Stripe for payments or checkout.</li><li><strong>Apple Maps or Google Maps</strong> may receive the displayed map region, validated venue-published coordinates, and ordinary network/device request metadata when you open the Maps tab. Choosing Directions additionally opens or sends the venue's factual published address. Orbit Player does not request device GPS location or send a player-origin coordinate in this release.</li><li><strong>Expo Application Services and Apple</strong> process developer build/distribution information and tester or device information as part of native app distribution.</li><li><strong>Support and email providers</strong> process the content and contact details a person chooses to send.</li></ul>
        <p>Providers process information under their own terms and privacy commitments. We do not sell personal information or use it for behavioral advertising.</p>`],
      ['retention-and-deletion', '6. Retention and deletion', `
        <p>Orbit keeps personal information only while needed for the purposes above, security and audit integrity, or an applicable legal obligation. No universal retention period is stated because the necessary period depends on the record and controlling obligation.</p>
        <p>A local-only user can choose <strong>Delete local profile and data</strong> in the app. A signed-in user can initiate account deletion in Profile and Settings. Once the server accepts a remote deletion, Orbit-controlled cleanup and finalization are server-resumable and do not depend on the user reauthenticating to resume them. The app reports pending or failed finalization rather than claiming completion early. Completed deletion removes or irreversibly de-identifies Orbit-controlled personal data unless a documented legal obligation requires a limited record to be retained.</p>
        <p>To prevent deleted accounts from silently recreating prior data, Orbit retains two server-only security records: a minimal deletion block whose record key contains the Firebase account UID, and a separate one-way pseudonymous deletion marker. These records contain no profile or contact fields. The current service policy does not set an automatic deletion date for them; their retention disposition must be approved as part of launch privacy and legal review.</p>
        <p>A participating venue may independently control records it needs for its own operations or legal obligations. Contact that venue about its records. Contact Orbit if you cannot access the in-app deletion control.</p>`],
      ['choices-and-security', '7. Choices and security', `
        <p>You can decline the camera and enter agreed information another way where available. You can enter optional home-area text without granting GPS access, choose whether to open the Maps tab, and open Directions only when you choose. You can refresh or cancel operational requests where the app offers that action.</p>
        <p>Orbit uses access controls, authenticated identifiers, bounded request formats, and replay protections. No system can guarantee absolute security.</p>`],
      ['contact-and-changes', '8. Contact and changes', `
        <p>Privacy questions and deletion assistance: <a href="mailto:privacy@orbitpoker.com">privacy@orbitpoker.com</a>. Support: <a href="tel:+13464341402">346-434-1402</a>.</p>
        <p>We may update this policy as the services change. The updated date above identifies this version. Material changes should be reviewed before publication.</p>`]
    ]
  },
  terms: {
    title: 'Orbit Terms of Service',
    description: 'Terms for the conservative first release of Orbit Player and related Orbit services.',
    summary: `These Terms are an agreement between you and ${operator}, the operator of Orbit. Participating venues remain responsible for their own poker operations and decisions.`,
    sections: [
      ['scope', '1. Scope and acceptance', `<p>By using Orbit Player, Orbit Core, the Orbit API, or repository-controlled Orbit websites, you agree to these Terms and the <a href="{{privacy}}">Privacy Policy</a>. If you do not agree, do not use the services.</p>`],
      ['eligibility', '2. Eligibility', `<p>You must be at least 18 to create an Orbit Player account. A venue may impose a higher minimum age or other lawful eligibility requirements. Orbit's barcode flow is a provisional information-capture tool and is not a government certification or a substitute for a venue checking physical identification.</p>`],
      ['player-v1', '3. Orbit Player first-release scope', `
        <p>Orbit Player lets users view factual venue, game, and tournament information; request venue membership; join an operational waitlist or express interest in a forming game; express nonbinding tournament interest; present a short-lived check-in QR; and manage their own profile.</p>
        <p>Orbit does not accept wagers, gaming stakes, deposits, entry fees, gambling credit, prize funds, or payment-linked poker participation. A tournament-interest request does not register you, reserve a seat, create a debt, collect payment, or establish prize eligibility. Venue staff must separately confirm any participation.</p>
        <p>This release has no paid premium subscription, no venue checkout, and no player-hosted/private game feature. There are no push notifications.</p>`],
      ['venue-actions', '4. Venue requests and decisions', `<p>Membership, waitlist, seat, arrival, check-in, and interest actions are operational messages to the venue you select. They do not guarantee admission, membership, seating, game availability, tournament participation, price, payout, or any other result. The venue remains authoritative for its rules, staffing, games, seating, transactions outside Orbit Player, and legal compliance.</p>`],
      ['accounts', '5. Accounts and security', `<p>Provide accurate information, protect your sign-in method, and use only your own account. You may not impersonate another person, bypass age or authorization controls, reuse another person's check-in credential, probe another venue's data, or interfere with the service. Tell support promptly if you believe your account is compromised.</p>`],
      ['acceptable-use', '6. Acceptable use', `<p>Do not use Orbit for unlawful gambling, fraud, harassment, abusive content, automated scraping of restricted data, security attacks, or infringement. Do not rely on Orbit as legal, financial, or gambling advice.</p>`],
      ['privacy-and-deletion', '7. Privacy and account deletion', `<p>The <a href="{{privacy}}">Privacy Policy</a> explains data handling and venue/provider roles. Local users and signed-in users have separate in-app deletion controls. Some venue-controlled or legally required records may be handled under separate obligations.</p>`],
      ['availability', '8. Availability and changes', `<p>Live information depends on venue publication and connectivity and may become stale or unavailable. Orbit may correct, suspend, or change a feature to protect users, venues, or service integrity. Do not treat displayed availability as a guarantee.</p>`],
      ['disclaimers', '9. Disclaimers and responsibility', `<p>To the extent permitted by applicable law, the services are provided as available without a promise that every venue record is complete or current. Nothing in these Terms excludes rights or liabilities that cannot lawfully be excluded. You remain responsible for complying with law and venue rules.</p>`],
      ['contact', '10. Contact', `<p>${operator}<br />Website: <a href="https://orbitpoker.com">https://orbitpoker.com</a><br />Privacy: <a href="mailto:privacy@orbitpoker.com">privacy@orbitpoker.com</a><br />Support: <a href="tel:+13464341402">346-434-1402</a></p>`]
    ]
  },
  support: {
    title: 'Orbit Support',
    description: 'Orbit Player support for account access, venue requests, check-in, identity capture, and deletion.',
    summary: 'Get help with a specific Orbit Player task. Do not send passwords, one-time codes, raw ID barcodes, document numbers, or payment information.',
    sections: [
      ['contact', 'Contact support', `<p>Call <a href="tel:+13464341402">346-434-1402</a>. Share only the account and participating-venue context needed to investigate the issue. Carrier charges may apply.</p>`],
      ['sign-in', 'Account and sign-in', `<p>Orbit Player supports email/password and optional phone one-time-passcode authentication. It does not offer social sign-in in this release. If a code does not arrive, verify the number and network connection, then retry without sharing the code with anyone.</p>`],
      ['venue-requests', 'Membership, waitlist, and tournament interest', `<p>Membership, waitlist, seat, and tournament-interest actions are requests to a participating venue. Tournament interest does not register you or reserve a seat. Reopen or refresh the app to see the venue's latest published response; Orbit does not promise general game-update texts or device alerts.</p>`],
      ['check-in', 'Check-in QR', `<p>The membership check-in QR is short-lived and venue-specific. Refresh it when it expires. A venue needs a network connection to validate and redeem it; staff must not accept an unverifiable or already-used credential.</p>`],
      ['identity', 'Government-ID barcode', `<p>Camera access is requested only when you choose PDF417 capture. The app previews full name, date of birth, and address. Orbit does not save or upload the ID image, raw barcode, or document number. If camera access is permanently denied, use the device Settings recovery action shown in the app.</p>`],
      ['deletion', 'Delete a profile or account', `<p>Local-only users can choose <strong>Delete local profile and data</strong>. Signed-in users can initiate account deletion from Profile and Settings. If an accepted remote deletion reports pending, the server continues bounded finalization without requiring the user to reauthenticate or retry. The app does not provide a post-deletion status lookup; contact Orbit Support if you need assistance.</p>`],
      ['legal', 'Legal documents', `<p>Read the <a href="{{privacy}}">Privacy Policy</a> and <a href="{{terms}}">Terms of Service</a>. ${operator} operates Orbit; participating venues control their own poker operations and venue records.</p>`]
    ]
  }
};

function replaceLinks(html, links) {
  return html.replaceAll('{{privacy}}', links.privacy).replaceAll('{{terms}}', links.terms);
}

function renderDocument(kind, document, apiTarget) {
  const links = apiTarget
    ? { home: '/support', privacy: '/privacy', terms: '/terms', support: '/support', icon: '/orbit-logo.svg', css: '/legal.css' }
    : { home: './index.html', privacy: './privacy.html', terms: './terms.html', support: './support.html', icon: './orbit-logo.svg', css: './styles.css' };
  const contents = document.sections.map(([id, title]) => `<a href="#${id}">${title}</a>`).join('');
  const sections = document.sections.map(([id, title, html]) => `<section><h2 id="${id}">${title}</h2>${replaceLinks(html.trim(), links)}</section>`).join('\n      ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${document.description}" />
    <title>${document.title}</title>
    ${apiTarget ? '' : '<!-- orbit-public-metadata -->\n    '}<link rel="icon" type="image/svg+xml" href="${links.icon}" />
    <link rel="stylesheet" href="${links.css}" />
  </head>
  <body class="legal-page">
    <header class="site-header"><a class="site-brand" href="${links.home}" aria-label="Orbit home"><img src="${links.icon}" alt="" /><span>Orbit</span></a><nav aria-label="Legal navigation"><a href="${links.privacy}"${kind === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a><a href="${links.terms}"${kind === 'terms' ? ' aria-current="page"' : ''}>Terms</a><a href="${links.support}"${kind === 'support' ? ' aria-current="page"' : ''}>Support</a></nav></header>
    <main class="legal-shell">
      <header class="legal-header"><p class="eyebrow">Orbit ${kind === 'support' ? 'support' : 'legal'}</p><h1>${document.title}</h1><p class="legal-summary">${document.summary}</p><dl class="legal-meta"><div><dt>Updated</dt><dd>${updated}</dd></div><div><dt>Operator</dt><dd>${operator}</dd></div></dl></header>
      <details class="legal-toc"><summary>Contents</summary><nav aria-label="Document contents">${contents}</nav></details>
      <article class="legal-document">${sections}</article>
    </main>
    <footer class="site-footer"><span>${operator}</span><nav aria-label="Footer navigation"><a href="${links.privacy}">Privacy</a><a href="${links.terms}">Terms</a><a href="${links.support}">Support</a></nav></footer>
  </body>
</html>
`;
}

function synchronize() {
  for (const [kind, document] of Object.entries(documents)) {
    fs.writeFileSync(path.join(repositoryRoot, 'apps', 'api', 'public', `${kind}.html`), renderDocument(kind, document, true));
    fs.writeFileSync(path.join(repositoryRoot, 'download-site', `${kind}.html`), renderDocument(kind, document, false));
  }
  console.log(`Synchronized ${Object.keys(documents).length} Orbit legal/support documents for two public surfaces.`);
}

if (require.main === module) synchronize();

module.exports = { documents, operator, renderDocument, synchronize, updated };
