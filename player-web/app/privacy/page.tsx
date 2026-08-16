import type { Metadata } from 'next';
import { StructuredData } from '@/src/components/seo/structured-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

const description = 'What Orbit collects, why it is used, and every current service that may receive personal data.';

export const metadata: Metadata = createPageMetadata({
  title: 'Privacy policy',
  description,
  path: '/privacy'
});

const dataCategories = [
  {
    category: 'Website and network activity',
    details: 'IP address, user agent, browser and device type, requested URL, referring URL, timestamps, response status, security signals, and searches or filters included in a URL. Hosting and API infrastructure can create request and error logs.'
  },
  {
    category: 'Account and authentication',
    details: 'Firebase user ID, email address, optional phone number, password submitted directly to Firebase Authentication, verification status, authentication tokens, sign-in timestamps, and password-reset or verification activity. Orbit does not receive or store a readable copy of your password.'
  },
  {
    category: 'Player profile and preferences',
    details: 'Display name, verified email, optional phone number, home area, preferred games and stakes, search radius, typical availability, profile image if provided, saved games, membership information, subscription status, and notification or discovery preferences.'
  },
  {
    category: 'Location and map activity',
    details: 'A city or area you type and, only after browser or device permission, latitude and longitude with ordinary browser accuracy. Player Web uses the coordinate in browser memory for distance sorting and does not intentionally send that precise coordinate to the Orbit API. Map or directions providers can receive the map area, destination, IP address, and device information when their service is opened.'
  },
  {
    category: 'Poker-room and event activity',
    details: 'Club, game, table and tournament identifiers; membership selections; registrations; waitlist and seat requests; arrival status and expected time; availability windows; check-ins; attendance; seating; results; loyalty and time-wallet records; request IDs, timestamps, notes, and room responses.'
  },
  {
    category: 'Payments and subscriptions',
    details: 'Selected product or plan, price and currency, room identifier, player ID, name and email, checkout and transaction identifiers, payment status, refunds, subscription product and entitlement, purchase environment, expiration, and limited card metadata returned by a processor. Orbit does not store full payment-card numbers.'
  },
  {
    category: 'Identity and age verification',
    details: 'Stripe verification-session ID and status, age band, verification time, failure code, and whether the minimum age requirement was met. Stripe Identity may collect a government ID, document images, date of birth, and matching selfie directly. Orbit is designed to retain the result rather than the source identity images or full date of birth.'
  },
  {
    category: 'Venue, staff and operations data',
    details: 'Room and business contacts, staff identifiers and roles, player records entered or imported by a room, memberships, schedules, tables, games, tournaments, buy-ins, time fees, transaction and payout-support records, messages, reports, corrections, audit history, feedback, and operational analytics.'
  },
  {
    category: 'Desktop diagnostics and communications',
    details: 'Random installation ID, device name, app version, platform, environment, locale, route and feature/action events, update status, timestamps, error messages and stacks, and report data. When a room sends an email or text, the recipient address or phone number, message content, delivery status, and attached report are processed.'
  },
  {
    category: 'Support and legal requests',
    details: 'Your contact details, message contents, attachments, account references, call or email history, privacy requests, verification information needed to answer a request, and records required to resolve disputes or comply with law.'
  }
] as const;

const recipients = [
  {
    service: 'Google Firebase and Google Cloud',
    purpose: 'Authentication, verification email and reset delivery, Firestore storage, synchronized room/player records, access control, and abuse prevention.',
    data: 'Account identifiers, email, optional phone, password handled by Firebase Auth, IP address, user agent, auth tokens, profile and interaction records, room data, and service logs.',
    privacy: 'https://firebase.google.com/support/privacy'
  },
  {
    service: 'Vercel',
    purpose: 'Hosting Player Web and the Orbit API, delivering pages and API responses, security, and operational logs.',
    data: 'IP address, request headers, user agent, URL, timestamp, response data, and any account or action data sent in an API request.',
    privacy: 'https://vercel.com/legal/privacy-notice'
  },
  {
    service: 'Stripe, Stripe Identity, and connected Stripe accounts',
    purpose: 'Age/identity verification, card-house checkout, payment processing, fraud prevention, refunds, and transaction reconciliation.',
    data: 'Player ID, email, name, room and plan, transaction metadata, payment details submitted to Stripe, government ID and selfie materials, date of birth, and verification result.',
    privacy: 'https://stripe.com/privacy'
  },
  {
    service: 'Twilio',
    purpose: 'Phone verification and, when a room enables outreach, operational SMS delivery.',
    data: 'Phone number, verification code and status, message body, sender, recipient, timestamps, and delivery status.',
    privacy: 'https://www.twilio.com/en-us/legal/privacy'
  },
  {
    service: 'RevenueCat',
    purpose: 'Managing optional Player Premium purchases and sending entitlement updates to Orbit.',
    data: 'Orbit player ID, device/platform information, Apple receipt or purchase token, product and entitlement identifiers, transaction status, last-use time, environment, and expiration.',
    privacy: 'https://www.revenuecat.com/privacy'
  },
  {
    service: 'Apple App Store and StoreKit',
    purpose: 'iOS app distribution, optional in-app purchases, receipts, refunds, and subscription management.',
    data: 'Apple account and device information, purchase and receipt data, product identifier, subscription status, and diagnostics governed by Apple.',
    privacy: 'https://www.apple.com/legal/privacy/'
  },
  {
    service: 'Google Maps Platform and Apple Maps',
    purpose: 'Showing maps and handing off directions when you choose those features.',
    data: 'IP address, device and app information, viewed map area, destination, and location when allowed by your device or provider settings.',
    privacy: 'https://policies.google.com/privacy'
  },
  {
    service: 'OpenStreetMap Foundation tile services',
    purpose: 'Supplying map tiles on the Player web-map implementation.',
    data: 'IP address, user agent, requested tile coordinates, and request timestamp; tile coordinates can indicate the area of the map being viewed.',
    privacy: 'https://osmfoundation.org/wiki/Privacy_Policy'
  },
  {
    service: 'Expo Application Services',
    purpose: 'Building and distributing test or release versions of the native Player application when EAS is used.',
    data: 'App/project identifiers, build metadata and logs, developer-supplied build material, and device or tester information used for delivery.',
    privacy: 'https://expo.dev/privacy'
  },
  {
    service: 'GitHub',
    purpose: 'Hosting source and desktop release files and checking or downloading an available desktop update.',
    data: 'IP address, user agent, requested release or repository URL, timestamp, and standard download logs.',
    privacy: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement'
  },
  {
    service: 'Configured email, support, browser, and operating-system providers',
    purpose: 'Delivering room reports and support email, storing support correspondence, providing browser location, secure device storage, external browsing, and system navigation.',
    data: 'Email addresses, report attachments, support content, device and network data, requested location or destination, and provider-specific delivery logs. The exact SMTP, mailbox, browser, or operating-system provider depends on the room and device you use.',
    privacy: null
  },
  {
    service: 'Participating poker rooms and organizers',
    purpose: 'Responding to membership, seat, waitlist, registration and check-in activity and operating their games and events.',
    data: 'Profile and contact details needed for the request, membership and eligibility status, game/tournament request, arrival information, notes, transaction status, attendance, results, and communications.',
    privacy: null
  }
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
        dateModified: '2026-08-13',
        publisher: { '@id': 'https://caminuslabs.com/#organization' }
      }} />
      <article className="privacy-page">
        <header className="privacy-hero">
          <p className="eyebrow">Orbit legal</p>
          <h1>Privacy policy</h1>
          <p>This notice explains the data Orbit actually handles, where it can go, and which features are conditional.</p>
          <dl><div><dt>Last updated</dt><dd>August 13, 2026</dd></div><div><dt>Developer</dt><dd>Caminus Labs, LLC</dd></div></dl>
        </header>

        <section>
          <h2>Scope and responsibility</h2>
          <p>Orbit is developed by Caminus Labs, LLC. This policy covers Player Web, the Orbit Player application, Orbit Core, Orbit-hosted APIs and public pages, and related support and operational services. A participating poker room controls the customer and operational records it enters and may have its own privacy notice. Contact that room about room-controlled records; contact Orbit when you are unsure where a record belongs.</p>
        </section>

        <section>
          <h2>Information collected</h2>
          <p>The exact collection depends on the surface, features you use, permissions you grant, and features a participating room configures.</p>
          <div className="privacy-table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">What it includes</th></tr></thead><tbody>{dataCategories.map((item) => <tr key={item.category}><th scope="row">{item.category}</th><td>{item.details}</td></tr>)}</tbody></table></div>
        </section>

        <section>
          <h2>How information is used</h2>
          <ul><li>Authenticate accounts, maintain profiles, publish player-safe room information, and provide saved or private account areas.</li><li>Process memberships, waitlists, seat requests, registrations, age eligibility, check-ins, purchases, subscriptions, and room operations.</li><li>Sort discovery by location when requested, open directions, communicate service information, and answer support or privacy requests.</li><li>Secure, debug and operate the services; prevent abuse and fraud; reconcile payments; preserve auditability; and comply with law.</li><li>Produce room-controlled reports and aggregated operational insights. Orbit does not publish fabricated visitor counts or user metrics.</li></ul>
        </section>

        <section>
          <h2>Services and recipients</h2>
          <p>This inventory names current code paths and conditional integrations. A conditional provider receives data only when its feature is configured or you choose to use it.</p>
          <div className="privacy-table-wrap privacy-table-wrap--services"><table><thead><tr><th scope="col">Recipient</th><th scope="col">Why it receives data</th><th scope="col">Data it may receive</th></tr></thead><tbody>{recipients.map((item) => <tr key={item.service}><th scope="row">{item.privacy ? <a href={item.privacy} rel="noreferrer" target="_blank">{item.service}</a> : item.service}</th><td>{item.purpose}</td><td>{item.data}</td></tr>)}</tbody></table></div>
          <p>Orbit does not currently load an advertising network, third-party behavioral analytics pixel, testimonial platform, or visitor counter in Player Web. Orbit does not sell personal data for money. If an advertising or analytics integration is added, this policy and any required consent controls must be updated before it is enabled.</p>
        </section>

        <section>
          <h2>AI-assisted development</h2>
          <p>Orbit and this website were built with assistance from AI development tools, including OpenAI Codex. Those tools helped with source code, design implementation, testing, and documentation. Ordinary use of Orbit does not send your account, profile, location, poker activity, or payment information to OpenAI, and Orbit currently has no user-facing generative-AI runtime feature. Production personal data is not intended to be entered into development AI tools. If a future AI feature processes user data, Orbit will identify the provider, inputs, purpose, and available choices before enabling it.</p>
        </section>

        <section>
          <h2>Browser storage, cookies and location</h2>
          <p>Firebase Authentication uses browser-local persistence to keep you signed in. Orbit may also use necessary browser or device storage for authentication, settings, secure local state, request continuity, and abuse prevention. Player Web does not currently use advertising cookies. Browser location is requested only after an action from you; you can deny or revoke permission and browse by a manually entered area instead.</p>
        </section>

        <section>
          <h2>Retention, deletion and security</h2>
          <p>Orbit retains data only as long as reasonably needed for the purposes above, an active account or room relationship, security and fraud prevention, disputes, financial and tax records, room instructions, legal obligations, and rolling backups. Account deletion removes the Firebase sign-in and player profile and requests Stripe Identity redaction where configured. Some financial, audit, event, or room-controlled records may be anonymized or retained when an approved retention rule or law requires it.</p>
          <p>Orbit uses access controls, authentication, encrypted transport, OS-protected desktop storage, provider security controls, and scoped publication boundaries. No system is perfectly secure; protect your credentials and report suspected misuse.</p>
        </section>

        <section>
          <h2>Your choices and contact</h2>
          <ul><li>View the public landing page and its presentation-only examples without an account.</li><li>Deny location and use an area entered manually.</li><li>Update available profile fields, reset your password, sign out, or use account-deletion controls.</li><li>Manage an Apple subscription through Apple and use provider controls for maps, browser storage, permissions, and communications.</li><li>Depending on applicable law, request access, correction, deletion, portability, restriction, withdrawal of consent, or an appeal without unlawful discrimination.</li></ul>
          <p>Email <a href="mailto:privacy@orbitpoker.com">privacy@orbitpoker.com</a> with “Privacy Request” and enough account information to locate the record, or contact <a href="mailto:hello@caminuslabs.com">hello@caminuslabs.com</a>. Orbit may request information reasonably necessary to verify the request. For records controlled by a participating room, contact that room directly.</p>
          <p>Orbit is intended for adults and is not directed to children. A room may impose a higher minimum age, and age-restricted actions currently require the configured eligibility check.</p>
        </section>
      </article>
    </>
  );
}
