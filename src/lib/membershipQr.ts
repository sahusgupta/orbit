const opaqueMembershipQrPattern = /^omq1_[A-Za-z0-9_-]{43}$/;

type MembershipQrStaffSession = { token: string };

type MembershipQrRemoteResult<State> = {
  ok: boolean;
  status?: 'checked-in' | 'already-checked-in';
  playerName?: string;
  state?: State;
  error?: string;
  reauthenticate?: boolean;
};

type MembershipQrRedemptionOutcome<State> =
  | { kind: 'authorization-failed' }
  | { kind: 'session-changed' }
  | { kind: 'transport-failed' }
  | { kind: 'rejected' | 'accepted'; result: MembershipQrRemoteResult<State> };

/**
 * This is format screening only. Authenticity, expiry, venue binding,
 * membership state, and single-use consumption are server-authoritative.
 */
export function isOpaqueMembershipQrToken(value: string) {
  return opaqueMembershipQrPattern.test(value.trim());
}

/**
 * Binds redemption to the exact staff session returned by authorization.
 * A rejection may clear only that same session, never a newer reauthentication.
 */
export async function redeemMembershipQrWithAuthorizedSession<Access, State>(
  rawValue: string,
  ports: {
    authorize(): Promise<MembershipQrStaffSession | null>;
    readCurrentContext(): { access: Access | null; session: MembershipQrStaffSession | null };
    redeem(payload: { access: Access; staffToken: string; token: string }): Promise<MembershipQrRemoteResult<State>>;
    clearCurrentSession(): void;
  }
): Promise<MembershipQrRedemptionOutcome<State>> {
  const authorizedSession = await ports.authorize();
  if (!authorizedSession) return { kind: 'authorization-failed' };

  const context = ports.readCurrentContext();
  if (!context.access || context.session?.token !== authorizedSession.token) {
    return { kind: 'session-changed' };
  }

  let result: MembershipQrRemoteResult<State>;
  try {
    result = await ports.redeem({
      access: context.access,
      staffToken: authorizedSession.token,
      token: rawValue.trim()
    });
  } catch {
    return { kind: 'transport-failed' };
  }

  if (!result.ok) {
    const latestSession = ports.readCurrentContext().session;
    if (result.reauthenticate && latestSession?.token === authorizedSession.token) {
      ports.clearCurrentSession();
    }
    return { kind: 'rejected', result };
  }
  return { kind: 'accepted', result };
}

export async function runMembershipQrCheckIn<Access, State>(
  rawValue: string,
  ports: {
    authorize(): Promise<MembershipQrStaffSession | null>;
    readCurrentContext(): { access: Access | null; session: MembershipQrStaffSession | null };
    redeem?: (payload: { access: Access; staffToken: string; token: string }) => Promise<MembershipQrRemoteResult<State>>;
    clearCurrentSession(): void;
    applyState(state: State): void;
    clearInput(): void;
    setMessage(message: string): void;
  }
) {
  if (!ports.redeem) {
    ports.setMessage('Select and verify an active staff account, then scan again.');
    return;
  }
  const outcome = await redeemMembershipQrWithAuthorizedSession(rawValue, {
    ...ports,
    redeem: (payload) => {
      ports.setMessage('Validating this membership with Orbit…');
      return ports.redeem!(payload);
    }
  });
  if (outcome.kind === 'authorization-failed') return;
  if (outcome.kind === 'session-changed') {
    ports.setMessage('The active staff selection changed before validation began. Scan again.');
    return;
  }
  if (outcome.kind === 'transport-failed') {
    ports.setMessage('Orbit could not verify this membership. No check-in was recorded.');
    return;
  }
  const result = outcome.result;
  if (!result.ok) {
    ports.setMessage(result.error || 'Orbit rejected this membership QR. No check-in was recorded.');
    return;
  }
  if (result.state) ports.applyState(result.state);
  ports.clearInput();
  const playerName = result.playerName || 'Member';
  ports.setMessage(result.status === 'already-checked-in'
    ? `${playerName} is already checked in.`
    : `${playerName} checked in successfully.`);
}
