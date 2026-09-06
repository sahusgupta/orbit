import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(path.resolve(process.cwd(), 'player-app/firestore.rules'), 'utf8');
const indexConfiguration = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'player-app/firestore.indexes.json'), 'utf8')
) as { indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }> };

describe('Firestore player-facing security contracts', () => {
  it('keeps the club root public while making targeted notifications recipient-scoped', () => {
    expect(rules).toMatch(/match \/clubs\/\{clubId\}[\s\S]*?allow read: if true;/);
    expect(rules).toMatch(/match \/notifications\/\{notificationId\}[\s\S]*?targetPlayerIds\.hasAny\(\[request\.auth\.uid\]\)/);
    expect(rules).not.toMatch(/match \/notifications\/\{notificationId\}\s*\{\s*allow read: if true;/);
  });

  it('denies the unused legacy announcement collection', () => {
    expect(rules).toMatch(/match \/announcements\/\{announcementId\}\s*\{\s*allow read: if false;/);
  });

  it('reserves authoritative club projections and mutation inboxes for the backend publisher', () => {
    expect(rules).toMatch(/match \/clubStates\/\{clubId\}[\s\S]*?allow create, update, delete: if false;/);
    expect(rules).toMatch(/match \/clubs\/\{clubId\}[\s\S]*?allow create, update, delete: if false;/);
    expect(rules).toMatch(/match \/tournamentRegistrations\/\{registrationId\}[\s\S]*?allow create, update, delete: if false;/);
    const mutationInboxBlocks = [...rules.matchAll(/match \/(membershipRequests|waitlistRequests)\/\{requestId\}/g)]
      .map((match) => rules.slice(match.index, match.index + 240));
    expect(mutationInboxBlocks).toHaveLength(4);
    expect(mutationInboxBlocks.every((block) => block.includes('allow create, update, delete: if false;'))).toBe(true);
    expect(rules).toMatch(/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  it('declares the composite indexes used by server-only operational queries', () => {
    const signatures = indexConfiguration.indexes.map((index) =>
      `${index.collectionGroup}:${index.fields.map((field) => field.fieldPath).join(',')}`
    );
    expect(signatures).toEqual(expect.arrayContaining([
      'orbitClients:venueId,lastSeenAt,__name__',
      'orbitTelemetryEvents:venueId,occurredAt,__name__',
      'orbitTelemetryEvents:deviceId,occurredAt,__name__',
      'orbitClientErrors:venueId,occurredAt,__name__',
      'orbitClientUpdateEvents:deviceId,occurredAt,__name__',
      'orbitManagementSecurityEvents:accountKey,occurredAt,__name__',
      'orbitPublicationOutbox:createdAt,accountKey,revision',
      'orbitPublicationOutbox:accountKey,createdAt,revision',
      'orbitAccountStates:savedAt,__name__'
    ]));
  });
});
