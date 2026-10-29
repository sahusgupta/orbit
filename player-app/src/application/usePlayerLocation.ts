import { useEffect, useRef, useState } from 'react';
import { playerLocation, type PlayerLocationPort } from '../app/playerLocation';
import { decodePlayerLocalOrigin, deviceOriginLifetimeMs, type PlayerLocalOrigin } from '../domain/playerLocation';
import type { PlayerCoordinate } from '../domain/playerSync';
import { playerStorage } from '../data/storage/playerStorage';

type OriginStorage = Pick<typeof playerStorage, 'loadLocalOrigin' | 'saveLocalOrigin' | 'clearLocalOrigin'>;
export function usePlayerLocation({ owner, demoMode, enabled = true, port = playerLocation, storage = playerStorage }: {
  owner: string; demoMode: boolean; enabled?: boolean; port?: PlayerLocationPort; storage?: OriginStorage;
}) {
  const [snapshot, setSnapshot] = useState<{ owner: string; record: PlayerLocalOrigin | null; ready: boolean; error: string; busy: boolean }>({ owner, record: null, ready: false, error: '', busy: false });
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const generation = useRef(0);
  const operation = useRef(0);
  const active = useRef(false);
  const inFlight = useRef(false);
  const current = snapshot.owner === owner ? snapshot : { owner, record: null, ready: false, error: '', busy: false };
  useEffect(() => {
    active.current = true;
    inFlight.current = false;
    const version = ++generation.current;
    const valid = () => active.current && generation.current === version && ownerRef.current === owner;
    if (!enabled || !owner || demoMode) {
      setSnapshot({ owner, record: null, ready: true, error: '', busy: false });
    } else {
      void storage.loadLocalOrigin(owner).then(async (record) => {
        if (!valid()) return;
        const fresh = record && record.capturedAt <= Date.now() + 60_000 && (record.expiresAt === null || record.expiresAt > Date.now());
        if (record && !fresh) await storage.clearLocalOrigin(owner, record.capturedAt);
        if (valid()) setSnapshot({ owner, record: fresh ? record : null, ready: true, error: '', busy: false });
      }).catch(() => { if (valid()) setSnapshot({ owner, record: null, ready: true, error: 'Saved location could not be restored. Clear it or choose a location again.', busy: false }); });
    }
    return () => { active.current = false; generation.current += 1; operation.current += 1; };
  }, [owner, demoMode, enabled, storage]);

  const commit = async (record: PlayerLocalOrigin | null, token = ++operation.current) => {
    const version = generation.current;
    const valid = () => active.current && generation.current === version && ownerRef.current === owner && operation.current === token;
    if (!valid()) return false;
    setSnapshot((state) => ({ ...state, busy: true, error: '' }));
    try {
      if (!demoMode) {
        if (record) await storage.saveLocalOrigin(owner, record);
        else await storage.clearLocalOrigin(owner);
      }
      if (!valid()) return false;
      setSnapshot({ owner, record, ready: true, error: '', busy: false });
      return true;
    } catch {
      if (valid()) setSnapshot((state) => ({ ...state, error: 'Location could not be saved securely. Try again.', busy: false }));
      return false;
    }
  };
  useEffect(() => {
    if (!current.record?.expiresAt) return;
    const record = current.record;
    const version = generation.current;
    const timeout = setTimeout(() => {
      if (!active.current || ownerRef.current !== owner || generation.current !== version) return;
      setSnapshot((state) => state.record?.capturedAt === record.capturedAt
        ? { ...state, record: null, error: 'Device location expired. Refresh it or choose a manual point.' } : state);
      if (!demoMode) void storage.clearLocalOrigin(owner, record.capturedAt).catch(() => undefined);
    }, Math.max(0, record.expiresAt! - Date.now()));
    return () => clearTimeout(timeout);
  }, [owner, current.record]);

  const selectManual = async (coordinate: PlayerCoordinate, label = 'Selected map location') => {
    if (!enabled || !current.ready || !active.current || ownerRef.current !== owner) return false;
    const record = decodePlayerLocalOrigin({ coordinate, label: label.trim(), source: 'manual', capturedAt: Date.now(), expiresAt: null });
    if (!record) { setSnapshot((state) => ({ ...state, error: 'Choose valid latitude and longitude values.' })); return false; }
    inFlight.current = false;
    return commit(record);
  };
  const useDevice = async () => {
    if (!enabled || !current.ready || !active.current || ownerRef.current !== owner || inFlight.current) return false;
    if (demoMode) { setSnapshot((state) => ({ ...state, error: 'Device location is unavailable in the sample account. You can choose a search point manually.' })); return false; }
    inFlight.current = true;
    const token = ++operation.current;
    const version = generation.current;
    const valid = () => active.current && generation.current === version && ownerRef.current === owner && operation.current === token;
    setSnapshot((state) => ({ ...state, busy: true, error: '' }));
    try {
      const fix = await port.getOneShotPosition();
      if (!valid()) return false;
      const record = decodePlayerLocalOrigin({ ...fix, label: 'Device location', source: 'device', expiresAt: fix.capturedAt + deviceOriginLifetimeMs });
      if (!record || record.expiresAt === null || record.expiresAt <= Date.now() || record.capturedAt > Date.now() + 60_000) throw new Error('Location unavailable');
      return await commit(record, token);
    } catch (failure) {
      if (valid()) setSnapshot((state) => ({ ...state, busy: false, error: failure instanceof Error ? failure.message : 'Location unavailable. Choose a point manually.' }));
      return false;
    } finally { if (valid()) inFlight.current = false; }
  };
  const fresh = current.record && (current.record.expiresAt === null || current.record.expiresAt > Date.now()) ? current.record : null;
  return { origin: fresh?.coordinate ?? null, originLabel: fresh?.label ?? '', source: fresh?.source ?? null,
    ready: current.ready, busy: current.busy, error: current.error, selectManual, useDevice, clear: () => {
      if (!enabled || !current.ready || !active.current || ownerRef.current !== owner) return Promise.resolve(false);
      inFlight.current = false;
      return commit(null);
    } };
}
