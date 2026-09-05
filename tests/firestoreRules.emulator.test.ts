import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const emulatorHost = process.env.ORBIT_RULES_EMULATOR_HOST
  || process.env.FIRESTORE_EMULATOR_HOST
  || (import.meta.env.MODE === 'firestore-emulator' ? '127.0.0.1:8085' : undefined);
const rulesSuite = emulatorHost ? describe : describe.skip;
let environment: RulesTestEnvironment;

rulesSuite('Firestore production authorization rules', () => {
  beforeAll(async () => {
    const [host, portValue] = String(emulatorHost).split(':');
    environment = await initializeTestEnvironment({
      projectId: 'tabletalk-s',
      firestore: {
        host,
        port: Number(portValue),
        rules: readFileSync(new URL('../player-app/firestore.rules', import.meta.url), 'utf8')
      }
    });
  });
  beforeEach(async () => environment.clearFirestore());
  afterAll(async () => environment?.cleanup());

  async function seed(path: string, value: Record<string, unknown>) {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), path), value);
    });
  }

  it('allows public venue projections while denying legacy and private-game reads', async () => {
    await seed('clubs/club-one', { id: 'club-one', name: 'Orbit Room' });
    await seed('clubs/club-one/games/holdem', { id: 'holdem', name: 'Holdem' });
    await seed('clubs/club-one/tournaments/event-one', { id: 'event-one', name: 'Event' });
    await seed('clubs/club-one/announcements/legacy-one', { id: 'legacy-one', body: 'Unscoped legacy content' });
    await seed('privateGames/private-one', { id: 'private-one', hostPlayerId: 'player-one' });
    await seed('games/legacy-root', { id: 'legacy-root' });
    await seed('players/player-one/members/legacy-member', { id: 'legacy-member' });
    const publicDb = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(publicDb, 'clubs/club-one')));
    await assertSucceeds(getDoc(doc(publicDb, 'clubs/club-one/games/holdem')));
    await assertSucceeds(getDoc(doc(publicDb, 'clubs/club-one/tournaments/event-one')));
    await assertFails(getDoc(doc(publicDb, 'clubs/club-one/announcements/legacy-one')));
    await assertFails(getDocs(collection(publicDb, 'privateGames')));
    await assertFails(getDoc(doc(publicDb, 'games/legacy-root')));
    const signedDb = environment.authenticatedContext('player-one', {
      email: 'one@example.test', email_verified: true
    }).firestore();
    await assertFails(getDoc(doc(signedDb, 'clubs/club-one/announcements/legacy-one')));
    await assertFails(getDoc(doc(signedDb, 'privateGames/private-one')));
    await assertFails(getDoc(doc(signedDb, 'players/player-one/members/legacy-member')));
  });

  it('denies all client private-game creation, including premium age-verified hosts', async () => {
    const hostDb = environment.authenticatedContext('player-one', {
      email: 'one@example.test', email_verified: true,
      ageVerified: true, ageLevel: 21, premium: { status: 'active' }
    }).firestore();
    await assertFails(setDoc(doc(hostDb, 'privateGames/private-one'), {
      id: 'private-one', status: 'Open', hostPlayerId: 'player-one', hostPlayerPath: 'players/player-one',
      hostPlayerName: 'Player One', name: 'Private game', location: 'Somewhere', createdAt: new Date().toISOString()
    }));
  });

  it('allows only an exact authenticated adult-declared profile shape', async () => {
    const playerDb = environment.authenticatedContext('player-one', {
      email: 'one@example.test', email_verified: true
    }).firestore();
    const unverifiedEmailDb = environment.authenticatedContext('player-one', {
      email: 'one@example.test', email_verified: false
    }).firestore();
    const otherDb = environment.authenticatedContext('player-two', {
      email: 'two@example.test', email_verified: true
    }).firestore();
    const valid = {
      id: 'player-one', uid: 'player-one', name: 'Player One', email: 'one@example.test',
      preferredGameIds: ['holdem'], favoriteClubIds: [],
      adultDeclaredAt: '2026-09-04T12:00:00.000Z', adultDeclarationVersion: 'v1', updatedAt: Timestamp.now()
    };
    await assertSucceeds(setDoc(doc(playerDb, 'players/player-one'), valid));
    await assertFails(setDoc(doc(unverifiedEmailDb, 'players/player-one'), valid));
    await assertSucceeds(getDoc(doc(playerDb, 'players/player-one')));
    await assertFails(getDoc(doc(otherDb, 'players/player-one')));
    await assertFails(setDoc(doc(otherDb, 'players/player-one'), { ...valid, email: 'two@example.test' }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, uid: 'player-two' }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, email: 'other@example.test' }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, premium: { status: 'active' } }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, clubMemberships: { 'club-one': { status: 'Active' } } }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, searchRadiusMiles: 0 }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, searchRadiusMiles: 1000 }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, adultDeclarationVersion: 'v2' }));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, adultDeclaredAt: 'not-a-valid-timestamp-value' }));
    const { adultDeclaredAt: _removed, ...withoutAdultDeclaration } = valid;
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), withoutAdultDeclaration));
    await assertFails(setDoc(doc(playerDb, 'players/player-one'), { ...valid, unreviewedField: true }));
    await assertFails(deleteDoc(doc(playerDb, 'players/player-one')));

    await assertSucceeds(setDoc(doc(playerDb, 'players/player-one'), {
      ...valid,
      homeLocation: 'Austin, TX', searchRadiusMiles: 1,
      preferredGameIds: ['holdem', 'omaha'], favoriteClubIds: ['club-one'],
      preferredStakes: '1/2', typicalAvailability: 'Friday evenings', updatedAt: Timestamp.now()
    }, { merge: true }));
  });

  it('binds phone-auth profiles to the verified phone when no verified email claim exists', async () => {
    const phoneDb = environment.authenticatedContext('phone-player', { phone_number: '+15551234567' }).firestore();
    const valid = {
      id: 'phone-player', uid: 'phone-player', name: 'Phone Player', email: '',
      phone: '+15551234567', preferredGameIds: [], favoriteClubIds: [],
      adultDeclaredAt: '2026-09-04T12:00:00.000Z', adultDeclarationVersion: 'v1', updatedAt: Timestamp.now()
    };
    await assertSucceeds(setDoc(doc(phoneDb, 'players/phone-player'), valid));
    await assertFails(setDoc(doc(phoneDb, 'players/phone-player'), { ...valid, phone: '+15557654321' }));
    await assertFails(setDoc(doc(phoneDb, 'players/phone-player'), { ...valid, email: 'unverified@example.test' }));
    await assertFails(setDoc(doc(phoneDb, 'players/another-player'), {
      ...valid, id: 'another-player', uid: 'another-player'
    }));
  });

  it('prevents a deleting player from recreating or updating a self profile', async () => {
    const playerDb = environment.authenticatedContext('deleting-player', {
      email: 'deleting@example.test', email_verified: true
    }).firestore();
    const profile = {
      id: 'deleting-player', uid: 'deleting-player', name: 'Deleting Player',
      email: 'deleting@example.test', preferredGameIds: [], favoriteClubIds: [],
      adultDeclaredAt: '2026-09-04T12:00:00.000Z', adultDeclarationVersion: 'v1',
      updatedAt: Timestamp.now()
    };
    await assertSucceeds(setDoc(doc(playerDb, 'players/deleting-player'), profile));
    await seed('playerDeletionBlocks/deleting-player', { status: 'blocked' });
    await assertFails(setDoc(doc(playerDb, 'players/deleting-player'), {
      ...profile, name: 'Restored Player', updatedAt: Timestamp.now()
    }));
    await assertFails(deleteDoc(doc(playerDb, 'playerDeletionBlocks/deleting-player')));
    await environment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'players/deleting-player'));
    });
    await assertFails(setDoc(doc(playerDb, 'players/deleting-player'), profile));
  });

  it('keeps tournament interests server-owned/self-readable and disables registrations', async () => {
    await seed('clubs/club-one/tournamentInterests/interest-one', {
      id: 'interest-one', clubId: 'club-one', tournamentId: 'event-one', playerId: 'player-one', status: 'interested'
    });
    await seed('clubs/club-one/tournamentRegistrations/legacy-one', {
      id: 'legacy-one', clubId: 'club-one', tournamentId: 'event-one', playerId: 'player-one', status: 'registered'
    });
    const selfDb = environment.authenticatedContext('player-one', {
      email: 'one@example.test', email_verified: true
    }).firestore();
    const otherDb = environment.authenticatedContext('player-two', {
      email: 'two@example.test', email_verified: true
    }).firestore();
    const adminDb = environment.authenticatedContext('staff-one', {
      email: 'staff@example.test', email_verified: true, clubId: 'club-one'
    }).firestore();
    await assertSucceeds(getDoc(doc(selfDb, 'clubs/club-one/tournamentInterests/interest-one')));
    await assertSucceeds(getDoc(doc(adminDb, 'clubs/club-one/tournamentInterests/interest-one')));
    await assertFails(getDoc(doc(otherDb, 'clubs/club-one/tournamentInterests/interest-one')));
    await assertFails(setDoc(doc(selfDb, 'clubs/club-one/tournamentInterests/new-interest'), {
      id: 'new-interest', clubId: 'club-one', tournamentId: 'event-one', playerId: 'player-one', status: 'interested'
    }));
    await assertFails(getDoc(doc(selfDb, 'clubs/club-one/tournamentRegistrations/legacy-one')));
    await assertFails(getDoc(doc(adminDb, 'clubs/club-one/tournamentRegistrations/legacy-one')));
  });

  it('enforces self and tenant boundaries for private club projections and legacy requests', async () => {
    await seed('clubs/club-one/memberships/member-one', { id: 'member-one', clubId: 'club-one', playerId: 'player-one' });
    await seed('clubs/club-one/waitlists/wait-one', { id: 'wait-one', clubId: 'club-one', playerId: 'player-one' });
    await seed('clubs/club-one/notifications/notice-one', {
      id: 'notice-one', clubId: 'club-one', targetPlayerIds: ['player-one']
    });
    await seed('clubs/club-one/notifications/shared-notice', {
      id: 'shared-notice', clubId: 'club-one', targetPlayerIds: ['player-one', 'player-two']
    });
    await seed('clubs/club-one/transactions/transaction-one', {
      id: 'transaction-one', clubId: 'club-one', playerId: 'player-one'
    });
    await seed('clubStates/club-one', {
      state: { settings: { accountLogin: { username: 'owner@example.test' }, clubAccount: {} } }
    });
    await seed('clubStates/club-one/membershipRequests/request-one', {
      id: 'request-one', player: { id: 'player-one' }
    });
    await seed('clubStates/club-one/waitlistRequests/request-two', {
      id: 'request-two', player: { id: 'player-one' }
    });

    const selfDb = environment.authenticatedContext('player-one', {
      email: 'one@example.test', email_verified: true
    }).firestore();
    const otherDb = environment.authenticatedContext('player-two', {
      email: 'two@example.test', email_verified: true
    }).firestore();
    const adminDb = environment.authenticatedContext('staff-one', { clubId: 'club-one' }).firestore();
    const wrongClubAdminDb = environment.authenticatedContext('staff-two', {
      clubId: 'club-two', clubAdmin: true
    }).firestore();
    const scopedMapAdminDb = environment.authenticatedContext('staff-three', {
      clubIds: { 'club-one': true }
    }).firestore();
    const globalAdminDb = environment.authenticatedContext('staff-global', {
      admin: true
    }).firestore();
    const verifiedOwnerDb = environment.authenticatedContext('owner-one', {
      email: 'owner@example.test', email_verified: true
    }).firestore();
    const unverifiedOwnerDb = environment.authenticatedContext('owner-one', {
      email: 'owner@example.test', email_verified: false
    }).firestore();
    const privatePaths = [
      'clubs/club-one/memberships/member-one',
      'clubs/club-one/waitlists/wait-one',
      'clubs/club-one/notifications/notice-one',
      'clubs/club-one/transactions/transaction-one',
      'clubStates/club-one/membershipRequests/request-one',
      'clubStates/club-one/waitlistRequests/request-two'
    ];
    for (const path of privatePaths) {
      await assertSucceeds(getDoc(doc(selfDb, path)));
      await assertSucceeds(getDoc(doc(adminDb, path)));
      await assertSucceeds(getDoc(doc(scopedMapAdminDb, path)));
      await assertFails(getDoc(doc(otherDb, path)));
      await assertFails(getDoc(doc(wrongClubAdminDb, path)));
    }
    await assertFails(getDoc(doc(selfDb, 'clubs/club-one/notifications/shared-notice')));
    await assertFails(getDoc(doc(otherDb, 'clubs/club-one/notifications/shared-notice')));
    await assertSucceeds(getDoc(doc(adminDb, 'clubs/club-one/notifications/shared-notice')));
    await assertSucceeds(getDoc(doc(adminDb, 'clubStates/club-one')));
    await assertSucceeds(getDoc(doc(scopedMapAdminDb, 'clubStates/club-one')));
    await assertSucceeds(getDoc(doc(globalAdminDb, 'clubStates/club-one')));
    await assertFails(getDoc(doc(verifiedOwnerDb, 'clubStates/club-one')));
    await assertFails(getDoc(doc(selfDb, 'clubStates/club-one')));
    await assertFails(getDoc(doc(unverifiedOwnerDb, 'clubStates/club-one')));
    await assertFails(getDoc(doc(wrongClubAdminDb, 'clubStates/club-one')));
  });
});
