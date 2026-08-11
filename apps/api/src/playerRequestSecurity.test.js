import { describe, expect, it } from 'vitest';
import security from './playerRequestSecurity.js';

const { buildAuthenticatedPlayerRequest } = security;

const claims = {
  uid: 'player-a',
  email: 'alex@example.com',
  name: 'Alex Verified',
  phone_number: '+15551112222'
};

function validRequest(overrides = {}) {
  return {
    id: 'request-1',
    clubId: 'Club One',
    type: 'membership-request',
    player: {
      id: 'player-a',
      name: 'Untrusted Name',
      email: 'alex@example.com',
      preferredGameIds: ['nlh', 'nlh', 'plo']
    },
    requestedAt: '2026-08-11T00:00:00.000Z',
    ...overrides
  };
}

describe('authenticated player request boundary', () => {
  it('rejects a caller who supplies another player id', () => {
    expect(buildAuthenticatedPlayerRequest(validRequest({
      player: { ...validRequest().player, id: 'player-b' }
    }), claims)).toEqual({
      ok: false,
      status: 403,
      error: 'The request player does not match the authenticated player.'
    });
  });

  it('rejects an email that does not match the verified token', () => {
    expect(buildAuthenticatedPlayerRequest(validRequest({
      player: { ...validRequest().player, email: 'other@example.com' }
    }), claims)).toEqual({
      ok: false,
      status: 403,
      error: 'The request email does not match the authenticated player.'
    });
  });

  it('derives identity from verified claims and only preserves bounded preferences', () => {
    const result = buildAuthenticatedPlayerRequest(validRequest(), claims);
    expect(result).toMatchObject({
      ok: true,
      value: {
        clubId: 'club-one',
        player: {
          id: 'player-a',
          name: 'Alex Verified',
          email: 'alex@example.com',
          phone: '+15551112222',
          preferredGameIds: ['nlh', 'plo']
        }
      }
    });
  });

  it('fails closed without a verified Firebase uid', () => {
    expect(buildAuthenticatedPlayerRequest(validRequest(), { email: 'alex@example.com' })).toEqual({
      ok: false,
      status: 401,
      error: 'Firebase player sign-in is required.'
    });
  });
});
