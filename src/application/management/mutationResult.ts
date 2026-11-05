import type { ManagementSaveResult } from '../../domain/managementSaveResult';

export type ManagementMutationResult =
  | { ok: true; status: 'authoritative-saved'; cloud: ManagementSaveResult['cloud']; revision?: number }
  | { ok: false; status: 'invalid-transition' | 'preflight-rejected' | 'revision-conflict' | 'save-failed' | 'save-pending' | 'busy'; error: string; conflict?: boolean; pending?: boolean };

export type MutationActionResult = boolean | void | ManagementMutationResult;
export type MutationActionCallbackResult = MutationActionResult | Promise<MutationActionResult>;

export const managementSaveOutcome = (result: Pick<ManagementSaveResult, 'ok' | 'cloud' | 'conflict' | 'pending' | 'error' | 'revision'>): ManagementMutationResult =>
  result.ok
    ? { ok: true, status: 'authoritative-saved', cloud: result.cloud, revision: result.revision }
    : {
        ok: false,
        status: result.pending ? 'save-pending' : result.conflict ? 'revision-conflict' : 'save-failed',
        conflict: Boolean(result.conflict),
        ...(result.pending ? { pending: true } : {}),
        error: result.pending
          ? result.error || 'Pending locally; the server has not confirmed this change.'
          : result.conflict
          ? 'The club changed on another device. Reload the latest state and retry this action.'
          : result.error || 'The server did not accept this action. Check the API connection and retry.'
      };

export const mutationActionError = (result: MutationActionResult) =>
  result === false || result === undefined ? 'This action was not saved. Retry after checking the club connection.'
    : result && typeof result === 'object' && !result.ok ? result.error : '';
