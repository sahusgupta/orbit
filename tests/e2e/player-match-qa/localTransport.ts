import type { PlayerClubSnapshot, PlayerWaitlistRequest } from '../../../player-app/src/domain/playerSync';
import { qaUid } from './fixtures';

export async function qaRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/qa/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-local-qa-actor': qaUid },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : 'Local QA request failed';
    throw Object.assign(new Error(message), { status: response.status });
  }
  // The runner owns this bounded response contract; production transports are never used.
  return value as T;
}
export function getCurrentFirebasePlayer() { return { uid: qaUid }; }
export function submitWaitlistRequest(request: PlayerWaitlistRequest) { return qaRequest<{ ok: true; snapshot: PlayerClubSnapshot } | { ok: false; error: string }>('waitlist', request); }
export function submitMembershipRequest() { throw new Error('Membership writes are outside the isolated Match harness.'); }
export function issueRemoteMembershipQr() { throw new Error('QR issuance is outside the isolated Match harness.'); }
