import type { ManagementSaveResult } from '../../app/persistence/managementPersistence';

export type ManagementMutationResult =
  | { ok: true; status: 'authoritative-saved'; cloud: ManagementSaveResult['cloud']; revision?: number }
  | { ok: false; status: 'invalid-transition' | 'preflight-rejected' | 'revision-conflict' | 'save-failed' | 'busy'; error: string; conflict?: boolean };

export type MutationActionResult = boolean | void | ManagementMutationResult;
export type MutationActionCallbackResult = MutationActionResult | Promise<MutationActionResult>;

export const managementSaveOutcome = (result: Pick<ManagementSaveResult, 'ok' | 'cloud' | 'conflict' | 'error' | 'revision'>): ManagementMutationResult =>
  result.ok
    ? { ok: true, status: 'authoritative-saved', cloud: result.cloud, revision: result.revision }
    : {
        ok: false,
        status: result.conflict ? 'revision-conflict' : 'save-failed',
        conflict: Boolean(result.conflict),
        error: result.conflict
          ? 'The club changed on another device. Reload the latest state and retry this action.'
          : result.error || 'The server did not accept this action. Check the API connection and retry.'
      };

export const mutationActionError = (result: MutationActionResult) =>
  result === false || result === undefined ? 'This action was not saved. Retry after checking the club connection.'
    : result && typeof result === 'object' && !result.ok ? result.error : '';
