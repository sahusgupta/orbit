import type { PlayerClubSnapshot } from '../domain/playerSync';

export type SyncResult =
  | { ok: true; snapshot: PlayerClubSnapshot; accountKey: string; savedAt?: string }
  | { ok: false; error: string };
