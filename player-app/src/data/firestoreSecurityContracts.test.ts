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
});
