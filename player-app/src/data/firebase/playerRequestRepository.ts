import type { PlayerMembershipRequest, PlayerWaitlistRequest } from '../../domain/playerSync';
import { submitRemotePlayerRequest } from '../api/playerHttpApi';
import type { SyncResult } from '../playerDataContracts';
import { auth } from './firebaseClient';

function authenticatedRequest<T extends PlayerMembershipRequest | PlayerWaitlistRequest>(request: T): T {
  if (!auth.currentUser) throw new Error('Sign in to your Orbit Player account first.');
  if (!request.player.id || auth.currentUser.uid !== request.player.id) {
    throw new Error('The signed-in Orbit Player account does not match this request.');
  }
  return request;
}

export async function submitMembershipRequest(request: PlayerMembershipRequest): Promise<SyncResult> {
  try {
    const boundRequest = authenticatedRequest(request);
    return await submitRemotePlayerRequest('/player/membership-requests', boundRequest, boundRequest.player.id);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to submit membership request.' };
  }
}

export async function submitWaitlistRequest(request: PlayerWaitlistRequest): Promise<SyncResult> {
  try {
    const boundRequest = authenticatedRequest(request);
    return await submitRemotePlayerRequest('/player/waitlist-requests', boundRequest, boundRequest.player.id);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to submit waitlist request.' };
  }
}
