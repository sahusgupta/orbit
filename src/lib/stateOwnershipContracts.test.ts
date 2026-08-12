import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('authoritative state ownership contracts', () => {
  it('keeps renderer and Electron state orchestration off direct Firebase publication', () => {
    const rendererPersistence = read('src/app/persistence/managementPersistence.ts');
    const startupSync = read('src/application/management/sync/useManagementStartupSync.ts');
    const playerUpdateSync = read('src/application/management/sync/useManagementPlayerUpdateSync.ts');
    const electronMain = read('electron/main.cjs');
    const administrativePublisher = read('scripts/publish-firestore-layout.cjs');
    const membershipDiagnostic = read('scripts/firestore-club-members.cjs');

    expect(rendererPersistence).not.toContain('saveClubStateToFirebase');
    expect(startupSync).not.toMatch(/(saveClubStateToFirebase|loadClubStateFromFirebase)/);
    expect(playerUpdateSync).not.toMatch(/(syncPlayerUpdatesToClubState|subscribeToPlayerRequestUpdates)/);
    expect(electronMain).not.toMatch(/(writeStateToFirebase|readStateFromFirebase|fetchPendingPlayerRequests)/);
    expect(administrativePublisher).toContain('/publications/drain');
    expect(administrativePublisher).not.toMatch(/(firebasePublisher|publishStateToFirebase|FIREBASE_SERVICE_ACCOUNT_JSON)/);
    expect(membershipDiagnostic).not.toMatch(/(ensureClub|setDoc|method:\s*'PATCH')/);
  });

  it('routes Player venue mutations through the API instead of projection writes', () => {
    const playerRequests = read('player-app/src/data/firebase/playerRequestRepository.ts');
    const tournaments = read('player-app/src/data/firebase/playerTournamentRepository.ts');

    expect(playerRequests).toContain('submitRemotePlayerRequest');
    expect(playerRequests).not.toMatch(/(setDoc|runTransaction|submitLocalPlayerRequest)/);
    expect(tournaments).toContain('submitRemoteTournamentMutation');
    expect(tournaments).not.toMatch(/(setDoc|deleteDoc)\(/);
  });
});
