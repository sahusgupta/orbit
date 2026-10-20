import { matchEventRetentionMs, maxMatchEvents } from '../../../apps/api/src/shared/orbitMatchState.cjs';
import { matchReferenceKey, type MatchEvent, type MatchReference, type MatchState } from './orbitMatchTypes';

export type MatchHistoryRate = { numerator: number; denominator: number; rate: number | null };
export type RetainedMatchHistorySummary = {
  coverage: {
    source: 'sampled retained controller history'; retentionDays: number; eventLimit: number;
    windowStart: string; observedAt: string; retainedEvents: number; inputAtEventCap: boolean;
    excludedEvents: { expired: number; future: number; invalidTimestamp: number; duplicateIds: number; overCap: number };
  };
  loggedSamples: { opened: number; empty: number; loadFailed: number; undo: number };
  decisionEvents: { saved: number; passed: number; total: number };
  saveShare: MatchHistoryRate;
  passShare: MatchHistoryRate;
  impressedCandidateDetailOpenRate: MatchHistoryRate;
  savedCandidateRevisitRate: MatchHistoryRate;
  currentSavedMutationWaitlistRate: MatchHistoryRate;
  orphanEvents: { total: number; missingReference: number; detailsWithoutImpression: number; revisitsWithoutRetainedSave: number; waitlistWithoutCurrentRetainedSave: number };
  limitations: string[];
};

function refKey(ref: MatchReference | undefined) {
  return ref && typeof ref.clubId === 'string' && ref.clubId.trim() && typeof ref.gameId === 'string' && ref.gameId.trim()
    && (ref.kind === 'cash' || ref.kind === 'tournament') ? matchReferenceKey(ref) : null;
}
function ratio(numerator: number, denominator: number): MatchHistoryRate {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null };
}

/** Counts retained samples, not sessions, attendance, or an independently verified complete funnel. */
export function summarizeRetainedMatchHistory(state: MatchState, { nowMs = Date.now() }: { nowMs?: number } = {}): RetainedMatchHistorySummary {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('A finite observation time is required.');
  const cutoff = nowMs - matchEventRetentionMs;
  const excludedEvents = { expired: 0, future: 0, invalidTimestamp: 0, duplicateIds: 0, overCap: 0 };
  const seen = new Set<string>();
  const eligible: Array<{ event: MatchEvent; at: number; key: string | null }> = [];
  for (const event of state.events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) { excludedEvents.invalidTimestamp += 1; continue; }
    if (at < cutoff) { excludedEvents.expired += 1; continue; }
    if (at > nowMs) { excludedEvents.future += 1; continue; }
    if (seen.has(event.eventId)) { excludedEvents.duplicateIds += 1; continue; }
    seen.add(event.eventId);
    eligible.push({ event, at, key: refKey(event.ref) });
  }
  excludedEvents.overCap = Math.max(0, eligible.length - maxMatchEvents);
  const retained = eligible.slice(-maxMatchEvents);
  const impressions = new Map<string, number>();
  const saves = new Map<string, number>();
  const savedMutations = new Map<string, { key: string; at: number }>();
  const earliest = (cohort: Map<string, number>, key: string, at: number) => cohort.set(key, Math.min(cohort.get(key) ?? at, at));
  for (const { event, key, at } of retained) {
    if (!key) continue;
    if (event.kind === 'impression') earliest(impressions, key, at);
    if (event.kind === 'saved') { earliest(saves, key, at); savedMutations.set(event.eventId, { key, at }); }
  }
  const currentSavedMutations = new Map<string, { key: string; at: number }>();
  for (const decision of state.decisions) {
    const saved = savedMutations.get(decision.mutationId);
    if (decision.decision === 'saved' && saved && saved.key === refKey(decision.ref)) currentSavedMutations.set(decision.mutationId, saved);
  }
  const loggedSamples = { opened: 0, empty: 0, loadFailed: 0, undo: 0 };
  const decisionEvents = { saved: 0, passed: 0, total: 0 };
  const orphanEvents = { total: 0, missingReference: 0, detailsWithoutImpression: 0, revisitsWithoutRetainedSave: 0, waitlistWithoutCurrentRetainedSave: 0 };
  const detailCandidates = new Set<string>(), revisitedCandidates = new Set<string>(), convertedSavedMutations = new Set<string>();
  for (const { event, key, at } of retained) {
    if (event.kind === 'opened') { loggedSamples.opened += 1; continue; }
    if (event.kind === 'empty') { loggedSamples.empty += 1; continue; }
    if (event.kind === 'load-failed') { loggedSamples.loadFailed += 1; continue; }
    if (!key) { orphanEvents.missingReference += 1; orphanEvents.total += 1; continue; }
    if (event.kind === 'saved' || event.kind === 'passed') { decisionEvents[event.kind] += 1; decisionEvents.total += 1; }
    if (event.kind === 'undo') loggedSamples.undo += 1;
    if (event.kind === 'details') {
      const impressionAt = impressions.get(key);
      if (impressionAt !== undefined && at >= impressionAt) detailCandidates.add(key);
      else { orphanEvents.detailsWithoutImpression += 1; orphanEvents.total += 1; }
    }
    if (event.kind === 'saved-revisit') {
      const savedAt = saves.get(key);
      if (savedAt !== undefined && at >= savedAt) revisitedCandidates.add(key);
      else { orphanEvents.revisitsWithoutRetainedSave += 1; orphanEvents.total += 1; }
    }
    if (event.kind === 'waitlist-success') {
      const saveMutationId = event.saveMutationId;
      const saved = saveMutationId ? currentSavedMutations.get(saveMutationId) : undefined;
      if (saveMutationId && saved && saved.key === key && at >= saved.at) convertedSavedMutations.add(saveMutationId);
      else { orphanEvents.waitlistWithoutCurrentRetainedSave += 1; orphanEvents.total += 1; }
    }
  }
  return {
    coverage: { source: 'sampled retained controller history', retentionDays: matchEventRetentionMs / 86_400_000, eventLimit: maxMatchEvents,
      windowStart: new Date(cutoff).toISOString(), observedAt: new Date(nowMs).toISOString(), retainedEvents: retained.length,
      inputAtEventCap: state.events.length >= maxMatchEvents, excludedEvents },
    loggedSamples, decisionEvents,
    saveShare: ratio(decisionEvents.saved, decisionEvents.total), passShare: ratio(decisionEvents.passed, decisionEvents.total),
    impressedCandidateDetailOpenRate: ratio(detailCandidates.size, impressions.size), savedCandidateRevisitRate: ratio(revisitedCandidates.size, saves.size),
    currentSavedMutationWaitlistRate: ratio(convertedSavedMutations.size, currentSavedMutations.size), orphanEvents,
    limitations: [
      'Sampled unique controller interactions; repeated taps and sessions are not completely logged.',
      'At most 200 events over 30 days; missing, expired, capped, and failed telemetry prevent a complete funnel.',
      'Client-reported history is not independently verified attendance, seating, payment, or a guaranteed venue outcome.',
      'Undo does not erase accepted action samples; current-save conversion excludes removed or undone save mutations.'
    ]
  };
}
