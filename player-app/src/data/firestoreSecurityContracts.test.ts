import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rules = readFileSync(path.resolve(process.cwd(), 'player-app/firestore.rules'), 'utf8');

describe('Firestore player-facing security contracts', () => {
  it('keeps the club root public while making targeted notifications recipient-scoped', () => {
    expect(rules).toMatch(/match \/clubs\/\{clubId\}[\s\S]*?allow read: if true;/);
    expect(rules).toMatch(/match \/notifications\/\{notificationId\}[\s\S]*?targetPlayerIds\.hasAny\(\[request\.auth\.uid\]\)/);
    expect(rules).not.toMatch(/match \/notifications\/\{notificationId\}\s*\{\s*allow read: if true;/);
  });

  it('uses a separate deliberately public announcement collection', () => {
    expect(rules).toMatch(/match \/announcements\/\{announcementId\}\s*\{\s*allow read: if true;/);
  });

  it('reserves authoritative club projections and mutation inboxes for the backend publisher', () => {
    expect(rules).toMatch(/match \/clubStates\/\{clubId\}[\s\S]*?allow create, update, delete: if false;/);
    expect(rules).toMatch(/match \/clubs\/\{clubId\}[\s\S]*?allow create, update, delete: if false;/);
    expect(rules).toMatch(/match \/tournamentRegistrations\/\{registrationId\}[\s\S]*?allow create, update, delete: if false;/);
    const mutationInboxBlocks = [...rules.matchAll(/match \/(membershipRequests|waitlistRequests)\/\{requestId\}/g)]
      .map((match) => rules.slice(match.index, match.index + 240));
    expect(mutationInboxBlocks).toHaveLength(4);
    expect(mutationInboxBlocks.every((block) => block.includes('allow create, update, delete: if false;'))).toBe(true);
  });
});
