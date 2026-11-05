export type ManagementSaveResult = {
  ok: boolean;
  path: string;
  accountKey?: string;
  revision?: number;
  conflict?: boolean;
  pending?: boolean;
  error?: string;
  cloud: 'server-pending' | 'published' | 'failed' | 'not-committed';
};
