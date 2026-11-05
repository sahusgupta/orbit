// The emergency compatibility bridge deliberately bounds the complete source and
// every JSON request envelope. Domain commands will replace routine snapshots.
export const checkpointSourceLimit = 32 * 1024 * 1024;
export const checkpointChunkBytes = 256 * 1024;
export type CheckpointCapabilities = {
  protocol: 'checkpoint-v1';
  chunkBytes: number;
  maximumSourceBytes: number;
  maximumChunks: number;
  maximumEnvelopeBytes: number;
};

export type CheckpointSaveIdentity = {
  accountKey: string;
  mutationId: string;
  expectedRevision: number;
};
export type CheckpointResponse = {
  ok?: boolean;
  accountKey?: string;
  mutationId?: string;
  code?: string;
  id?: string;
  received?: number[];
  revision?: number;
  currentRevision?: number;
  duplicate?: boolean;
  publication?: { status?: string };
  error?: string;
  httpStatus?: number;
  completed?: boolean;
  result?: CheckpointResponse;
};
export type CheckpointRequest = (path: string, body?: unknown) => Promise<CheckpointResponse>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseCheckpointCapabilities = (value: unknown): CheckpointCapabilities | null => {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.checkpoint)) return null;
  const cap = value.checkpoint;
  if (cap.protocol !== 'checkpoint-v1'
    || !Number.isSafeInteger(cap.chunkBytes) || Number(cap.chunkBytes) < 1024 || Number(cap.chunkBytes) > checkpointChunkBytes
    || !Number.isSafeInteger(cap.maximumSourceBytes) || Number(cap.maximumSourceBytes) < 1 || Number(cap.maximumSourceBytes) > checkpointSourceLimit
    || !Number.isSafeInteger(cap.maximumChunks) || Number(cap.maximumChunks) < 1 || Number(cap.maximumChunks) > 128
    || !Number.isSafeInteger(cap.maximumEnvelopeBytes) || Number(cap.maximumEnvelopeBytes) < 1024 || Number(cap.maximumEnvelopeBytes) > 400_000
  ) return null;
  return {
    protocol: 'checkpoint-v1', chunkBytes: Number(cap.chunkBytes),
    maximumSourceBytes: Number(cap.maximumSourceBytes), maximumChunks: Number(cap.maximumChunks),
    maximumEnvelopeBytes: Number(cap.maximumEnvelopeBytes)
  };
};

export const checkpointSha256 = async (bytes: Uint8Array) => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
};
