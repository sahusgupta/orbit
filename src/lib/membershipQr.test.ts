import { describe, expect, it, vi } from 'vitest';
import { isOpaqueMembershipQrToken, redeemMembershipQrWithAuthorizedSession, runMembershipQrCheckIn } from './membershipQr';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('membership QR format boundary', () => {
  it('accepts only the opaque server-issued token envelope', () => {
    expect(isOpaqueMembershipQrToken(`omq1_${'A'.repeat(43)}`)).toBe(true);
    expect(isOpaqueMembershipQrToken(`  omq1_${'a'.repeat(43)}  `)).toBe(true);
    expect(isOpaqueMembershipQrToken(`omq1_${'A'.repeat(42)}`)).toBe(false);
    expect(isOpaqueMembershipQrToken(`omq1_${'A'.repeat(44)}`)).toBe(false);
  });

  it('prohibits identity-bearing static and URL credentials', () => {
    const removedStaticCredential = ['orbit', 'membership', 'v1', 'club-one', 'player-one'].join(':').replace('orbit:', 'orbit-');
    expect(isOpaqueMembershipQrToken(removedStaticCredential)).toBe(false);
    expect(isOpaqueMembershipQrToken('https://example.test/member/player-one')).toBe(false);
  });
});

describe('membership QR staff-session binding', () => {
  it('redeems with the freshly authorized session rather than a token observed before authorization', async () => {
    type Session = { token: string };
    const authorization = deferred<Session | null>();
    let session: Session | null = { token: 'session-a' };
    const redeem = vi.fn(async () => ({ ok: true as const, status: 'checked-in' as const }));

    const pending = redeemMembershipQrWithAuthorizedSession('  omq1_opaque  ', {
      authorize: () => authorization.promise,
      readCurrentContext: () => ({ access: { licenseId: 'club-one' }, session }),
      redeem,
      clearCurrentSession: vi.fn()
    });
    session = { token: 'session-b' };
    authorization.resolve(session);

    await expect(pending).resolves.toMatchObject({ kind: 'accepted' });
    expect(redeem).toHaveBeenCalledWith({
      access: { licenseId: 'club-one' },
      staffToken: 'session-b',
      token: 'omq1_opaque'
    });
  });

  it('applies an accepted authoritative state and reports duplicate check-in truthfully', async () => {
    const applyState = vi.fn();
    const clearInput = vi.fn();
    const setMessage = vi.fn();
    await runMembershipQrCheckIn('omq1_opaque', {
      authorize: async () => ({ token: 'session-a' }),
      readCurrentContext: () => ({ access: { licenseId: 'club-one' }, session: { token: 'session-a' } }),
      redeem: async () => ({
        ok: true,
        status: 'already-checked-in',
        playerName: 'Alex',
        state: { revision: 2 }
      }),
      clearCurrentSession: vi.fn(),
      applyState,
      clearInput,
      setMessage
    });

    expect(applyState).toHaveBeenCalledWith({ revision: 2 });
    expect(clearInput).toHaveBeenCalledOnce();
    expect(setMessage).toHaveBeenLastCalledWith('Alex is already checked in.');
  });

  it('does not redeem if the authorized session expires before the current context is bound', async () => {
    const redeem = vi.fn();
    await expect(redeemMembershipQrWithAuthorizedSession('omq1_opaque', {
      authorize: async () => ({ token: 'expired-session' }),
      readCurrentContext: () => ({ access: { licenseId: 'club-one' }, session: null }),
      redeem,
      clearCurrentSession: vi.fn()
    })).resolves.toEqual({ kind: 'session-changed' });
    expect(redeem).not.toHaveBeenCalled();
  });

  it('never clears a newer session when an in-flight redemption rejects the prior token', async () => {
    type Session = { token: string };
    const response = deferred<{ ok: false; error: string; reauthenticate: true }>();
    let session: Session | null = { token: 'session-a' };
    const clearCurrentSession = vi.fn();
    const redeem = vi.fn(() => response.promise);
    const pending = redeemMembershipQrWithAuthorizedSession('omq1_opaque', {
      authorize: async () => session!,
      readCurrentContext: () => ({ access: { licenseId: 'club-one' }, session }),
      redeem,
      clearCurrentSession
    });

    await vi.waitFor(() => expect(redeem).toHaveBeenCalledOnce());
    session = { token: 'session-b' };
    response.resolve({ ok: false, error: 'Session expired.', reauthenticate: true });

    await expect(pending).resolves.toMatchObject({ kind: 'rejected' });
    expect(clearCurrentSession).not.toHaveBeenCalled();
  });
});
