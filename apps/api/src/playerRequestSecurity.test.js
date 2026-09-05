import { describe, expect, it } from 'vitest';
import security from './playerRequestSecurity.js';

const { buildAuthenticatedPlayerRequest } = security;

const claims = {
  uid: 'player-a',
  email: 'alex@example.com',
  email_verified: true,
  name: 'Alex Verified',
  phone_number: '+15551112222'
};

function validRequest(overrides = {}) {
  return {
    id: 'join_550e8400-e29b-41d4-a716-446655440000',
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

  it('strips unsupported fields and freeform notes from operation-specific request payloads', () => {
    const result = buildAuthenticatedPlayerRequest(validRequest({
      id: 'wait_550e8400-e29b-41d4-a716-446655440000',
      type: 'waitlist-request',
      gameId: 'nlh',
      action: 'join',
      attendance: 'interested',
      note: 'Contact alex@example.com at +15551112222',
      arbitraryNestedData: { paymentStatus: 'paid' }
    }), claims);
    expect(result).toMatchObject({ ok: true, value: { type: 'waitlist-request', gameId: 'nlh', action: 'join' } });
    expect(result.value).not.toHaveProperty('note');
    expect(result.value).not.toHaveProperty('arbitraryNestedData');
    expect(JSON.stringify(result.value)).not.toContain('Contact alex@example.com');
  });

  it('requires a coherent explicit attendance and table shape for waitlist joins', () => {
    const waitlist = {
      id: 'wait_550e8400-e29b-41d4-a716-446655440000',
      type: 'waitlist-request',
      gameId: 'nlh',
      action: 'join'
    };
    expect(buildAuthenticatedPlayerRequest(validRequest(waitlist), claims)).toMatchObject({ ok: false, status: 400 });
    expect(buildAuthenticatedPlayerRequest(validRequest({ ...waitlist, attendance: 'arrived' }), claims)).toMatchObject({ ok: false, status: 400 });
    expect(buildAuthenticatedPlayerRequest(validRequest({ ...waitlist, attendance: 'confirmed' }), claims)).toMatchObject({ ok: false, status: 400 });
    expect(buildAuthenticatedPlayerRequest(validRequest({ ...waitlist, attendance: 'interested', tableId: 'table-one' }), claims)).toMatchObject({ ok: false, status: 400 });
    expect(buildAuthenticatedPlayerRequest(validRequest({ ...waitlist, attendance: 'arrived', tableId: 'table-one' }), claims)).toMatchObject({
      ok: true, value: { attendance: 'arrived', tableId: 'table-one' }
    });
    expect(buildAuthenticatedPlayerRequest(validRequest({ ...waitlist, attendance: 'interested' }), claims)).toMatchObject({
      ok: true, value: { attendance: 'interested' }
    });
  });

  it('fails closed for unsupported operations and invalid request timestamps', () => {
    expect(buildAuthenticatedPlayerRequest(validRequest({ type: 'unknown-request' }), claims)).toMatchObject({
      ok: false, status: 400
    });
    expect(buildAuthenticatedPlayerRequest(validRequest({ requestedAt: 'not-a-date' }), claims)).toMatchObject({
      ok: false, status: 400
    });
    expect(buildAuthenticatedPlayerRequest(validRequest({ id: 'join_alex@example.test' }), claims)).toMatchObject({
      ok: false, status: 400
    });
    expect(buildAuthenticatedPlayerRequest(validRequest({
      id: 'join_550e8400-e29b-41d4-a716-446655440000', type: 'waitlist-request', gameId: 'nlh'
    }), claims)).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts verified phone-only identity without propagating an unverified supplied email', () => {
    const result = buildAuthenticatedPlayerRequest(validRequest({
      player: { ...validRequest().player, email: 'spoofed@example.com', phone: '+19999999999' }
    }), {
      uid: 'player-a',
      email: 'unverified-token@example.test',
      email_verified: false,
      phone_number: '+15551112222',
      name: 'Phone Verified'
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        player: {
          id: 'player-a',
          name: 'Phone Verified',
          email: '',
          phone: '+15551112222'
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain('spoofed@example.com');
    expect(JSON.stringify(result)).not.toContain('unverified-token@example.test');
    expect(JSON.stringify(result)).not.toContain('+19999999999');
  });

  it('fails closed without a verified Firebase uid', () => {
    expect(buildAuthenticatedPlayerRequest(validRequest(), { email: 'alex@example.com' })).toEqual({
      ok: false,
      status: 401,
      error: 'Firebase player sign-in is required.'
    });
  });
});
