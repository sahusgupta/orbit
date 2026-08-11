import { describe, expect, it } from 'vitest';
import playerRoutes from './player';

describe('Player response DTOs', () => {
  it('returns player mutation fields without backend publication internals', () => {
    const response = playerRoutes.buildPlayerMutationResponse({
      accountKey: 'venue-one',
      savedAt: '2026-08-11T12:00:00.000Z',
      revision: 7,
      mutationId: 'internal-mutation-id',
      duplicate: false,
      changedEntityCount: 3,
      publication: { status: 'pending', attempts: 0 }
    }, { registrationId: 'tournament:player' });

    expect(response).toEqual({
      ok: true,
      accountKey: 'venue-one',
      savedAt: '2026-08-11T12:00:00.000Z',
      revision: 7,
      registrationId: 'tournament:player'
    });
    expect(response).not.toHaveProperty('mutationId');
    expect(response).not.toHaveProperty('duplicate');
    expect(response).not.toHaveProperty('changedEntityCount');
    expect(response).not.toHaveProperty('publication');
  });
});
