type RequestOptions = {
  dedupeKey?: string;
  readRetries?: number;
  timeoutMs?: number;
};

export type PlayerRequestMetric = {
  durationMs: number;
  method: string;
  outcome: 'ok' | 'http-error' | 'network-error' | 'timeout' | 'cancelled';
  path: string;
  recordedAt: string;
};

const inFlightReads = new Map<string, Promise<{ response: Response; payload: unknown }>>();
const metrics: PlayerRequestMetric[] = [];
const now = () => globalThis.performance?.now?.() ?? Date.now();
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function recordMetric(metric: PlayerRequestMetric) {
  metrics.push(metric);
  if (metrics.length > 100) metrics.splice(0, metrics.length - 100);
}

export const getPlayerRequestMetrics = () => metrics.slice();

export async function requestJson(
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {}
): Promise<{ response: Response; payload: unknown }> {
  const method = String(init.method || 'GET').toUpperCase();
  const path = (() => {
    try { return new URL(url).pathname; } catch { return 'configured-api'; }
  })();
  const dedupeKey = method === 'GET' ? options.dedupeKey : undefined;
  if (dedupeKey) {
    const existing = inFlightReads.get(dedupeKey);
    if (existing) return existing;
  }

  const operation = (async () => {
    const startedAt = now();
    const maximumAttempts = method === 'GET' ? 1 + Math.min(Math.max(options.readRetries ?? 1, 0), 2) : 1;
    let finalOutcome: PlayerRequestMetric['outcome'] = 'network-error';
    try {
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        const controller = new AbortController();
        const upstreamSignal = init.signal;
        const cancelFromUpstream = () => controller.abort();
        if (upstreamSignal?.aborted) controller.abort();
        else upstreamSignal?.addEventListener('abort', cancelFromUpstream, { once: true });
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
        try {
          const response = await fetch(url, { ...init, signal: controller.signal });
          const payload: unknown = await response.json().catch(() => ({}));
          if (response.ok || typeof response.status !== 'number' || response.status < 500 || attempt === maximumAttempts - 1) {
            finalOutcome = response.ok ? 'ok' : 'http-error';
            return { response, payload };
          }
        } catch (error) {
          finalOutcome = upstreamSignal?.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'network-error';
          if (upstreamSignal?.aborted || attempt === maximumAttempts - 1) throw error;
        } finally {
          clearTimeout(timeout);
          upstreamSignal?.removeEventListener('abort', cancelFromUpstream);
        }
        await wait(200 * 2 ** attempt);
      }
      throw new Error('Orbit API request did not complete.');
    } finally {
      recordMetric({
        durationMs: Math.max(0, Math.round(now() - startedAt)),
        method,
        outcome: finalOutcome,
        path,
        recordedAt: new Date().toISOString()
      });
    }
  })();

  if (dedupeKey) inFlightReads.set(dedupeKey, operation);
  try {
    return await operation;
  } finally {
    if (dedupeKey && inFlightReads.get(dedupeKey) === operation) inFlightReads.delete(dedupeKey);
  }
}
