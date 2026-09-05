import type { Metadata } from 'next';
import { StructuredData } from '@/src/components/seo/structured-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

const description = 'How Caminus Labs, LLC handles data for Orbit Player and related Orbit services.';

export const metadata: Metadata = createPageMetadata({ title: 'Privacy policy', description, path: '/privacy' });

const dataCategories = [
  ['Local-only profile', 'Name, email, optional phone number, adult-eligibility response, optional home-area text, preferred games and stakes, typical availability, favorite venues, search-radius preference, and cached venue information. This stays on the device unless the user signs in or submits a venue request.'],
  ['Signed-in account', 'Firebase identifier, full name, email, optional phone number, adult-eligibility response, optional home-area text, preferences, and authentication or security records. Firebase Authentication handles passwords.'],
  ['Venue activity', 'Selected venue, game, table, membership, waitlist, seat request, check-in, and tournament-interest identifiers and statuses, together with timestamps, idempotency identifiers, arrival or availability information, and venue responses.'],
  ['PDF417 identity fields', 'After an on-device preview and confirmation: full name, date of birth, address, capture method/time, provisional or staff-review status, and audit timestamps. Orbit does not save or upload an ID image, raw barcode, or document number.'],
  ['Technical and support data', 'IP address, browser or device type, request time, response status, security events, crash or diagnostic details, and information a person chooses to provide to support.']
] as const;

const providers = [
  ['Google Firebase and Google Cloud', 'Authentication, database, server, and security infrastructure.', 'Account identifiers, contact details (including an optional account phone when entered), tokens, profiles, requests, operational records, and service logs.'],
  ['Vercel', 'Public-page and API hosting.', 'Network/request metadata and information sent in an API request.'],
  ['Twilio', 'Phone one-time-passcode delivery only when phone authentication is selected.', 'The phone number used as the OTP destination, delivery status, and related authentication metadata.'],
  ['Stripe Identity', 'A conditional hosted Player Web compatibility session when that separately configured flow is deliberately started; not payment or checkout and separate from the iOS on-device PDF417 preview.', 'Stripe may process the identity document and verification data under its privacy terms. Orbit receives bounded verification results and provider-session metadata.'],
  ['Apple Maps or Google Maps', 'Rendering the Maps tab and opening Directions only when the user chooses those features.', 'The displayed map region, validated venue-published coordinates, and ordinary network/device request metadata when Maps is open; Directions additionally opens or sends the factual venue address. Orbit Player does not request device GPS or send a player-origin coordinate in this release.'],
  ['Expo Application Services and Apple', 'Building, distributing, and testing native releases.', 'Developer build/distribution information and tester or device information used for delivery.'],
  ['Participating venues', 'Responding to requests the player directs to that venue.', 'Immutable account identifier and display name; Firebase-verified email when present or Firebase-verified phone for phone authentication; and action-specific fields: selected published membership option ID/name, duration, displayed price, optional venue-published plan classification, in-person method, and profile preferences; waitlist game/table/action/attendance/arrival/availability/note; tournament/status/idempotency fields; or linked display name and status after authenticated QR redemption. Confirmed full name, date of birth, address, capture method/time, and review status are included only when the player submits those identity fields for the venue.'],
  ['Support and email providers', 'Responding to support or privacy requests.', 'The contact details and content a person chooses to send.']
] as const;

export default function PrivacyPage() {
  return (
    <>
      <StructuredData data={{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Orbit Privacy Policy',
        description,
        url: absoluteUrl('/privacy'),
        dateModified: '2026-09-04',
        publisher: { '@id': 'https://caminuslabs.com/#organization' }
      }} />
      <article className="privacy-page">
        <header className="privacy-hero">
          <p className="eyebrow">Orbit legal</p>
          <h1>Privacy policy</h1>
          <p>This notice describes the conservative first release of Orbit Player and related Orbit services.</p>
          <dl><div><dt>Last updated</dt><dd>September 4, 2026</dd></div><div><dt>Operator</dt><dd>Caminus Labs, LLC</dd></div></dl>
        </header>

        <section>
          <h2>Scope and responsibility</h2>
          <p>Orbit and Orbit Player are product names. Caminus Labs, LLC operates the Orbit services covered by this policy. Participating venues independently control their own poker operations, staff decisions, and venue records.</p>
        </section>

        <section>
          <h2>Information handled</h2>
          <div className="privacy-table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">What it includes</th></tr></thead><tbody>{dataCategories.map(([category, details]) => <tr key={category}><th scope="row">{category}</th><td>{details}</td></tr>)}</tbody></table></div>
          <p>Tournament interest is nonbinding. It is not an event registration, seat reservation, debt, payment, or prize claim.</p>
        </section>

        <section>
          <h2>How information is used</h2>
          <ul><li>Authenticate accounts and protect access.</li><li>Show factual venue, game, and tournament information.</li><li>Send membership, waitlist, seat, check-in, and nonbinding tournament-interest requests to the venue the player selected.</li><li>Issue and validate short-lived venue check-in credentials.</li><li>Prevent replay or abuse, investigate errors, answer support/privacy requests, and comply with applicable law.</li></ul>
          <p>The first release has no paid premium subscription, no player-hosted/private game feature, and no venue checkout. There are no push notifications or general game-update messaging service. Phone one-time passcodes may be sent only when phone authentication is selected.</p>
        </section>

        <section>
          <h2>Services and recipients</h2>
          <div className="privacy-table-wrap privacy-table-wrap--services"><table><thead><tr><th scope="col">Recipient</th><th scope="col">Purpose</th><th scope="col">Data it may receive</th></tr></thead><tbody>{providers.map(([service, purpose, data]) => <tr key={service}><th scope="row">{service}</th><td>{purpose}</td><td>{data}</td></tr>)}</tbody></table></div>
          <p>Orbit does not sell personal information, use it for behavioral advertising, or track users across other companies&apos; apps and websites.</p>
        </section>

        <section>
          <h2>Retention, deletion, and security</h2>
          <p>Orbit keeps personal information only while needed for the purposes above, security and audit integrity, or an applicable legal obligation. No universal period is stated because the necessary period depends on the record and controlling obligation.</p>
          <p>A local-only user can choose <strong>Delete local profile and data</strong>. A signed-in user can initiate account deletion in Profile and Settings. Once the server accepts a remote deletion, Orbit-controlled cleanup and finalization are server-resumable and do not depend on the user reauthenticating to resume them. The app reports pending or failed finalization rather than claiming completion early. Completed deletion removes or irreversibly de-identifies Orbit-controlled personal data unless a documented legal obligation requires a limited record.</p>
          <p>To prevent deleted accounts from silently recreating prior data, Orbit retains two server-only security records: a minimal deletion block whose record key contains the Firebase account UID, and a separate one-way pseudonymous deletion marker. These records contain no profile or contact fields. The current service policy does not set an automatic deletion date for them; their retention disposition must be approved as part of launch privacy and legal review.</p>
          <p>A participating venue may independently control records needed for its operations or legal duties. Contact that venue about its records. Orbit uses authenticated identifiers, scoped access controls, bounded request formats, and replay protections, but no system can guarantee absolute security.</p>
        </section>

        <section>
          <h2>Choices and contact</h2>
          <p>Users can decline camera access, enter optional home-area text without granting GPS access, choose whether to open the Maps tab or Directions, update available profile fields, sign out, and use the applicable deletion control.</p>
          <p>Privacy questions and deletion assistance: <a href="mailto:privacy@orbitpoker.com">privacy@orbitpoker.com</a>. Support: <a href="tel:+13464341402">346-434-1402</a>.</p>
        </section>

      </article>
    </>
  );
}
