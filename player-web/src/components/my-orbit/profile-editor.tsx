'use client';

import { Form } from '@base-ui/react/form';
import { ExternalLink, LogOut, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { createIdentitySession, fetchIdentityStatus } from '@/src/data/player-api';
import type { PlayerAccount } from '@/src/domain/types';
import { Button } from '@/src/components/ui/button';
import { TextAreaField, TextField } from '@/src/components/ui/fields';
import { StatusBadge } from '@/src/components/ui/status-badge';

type IdentityState = 'loading' | 'verified' | 'unverified' | 'error';

export function ProfileEditor() {
  const { user, player, updatePlayer, signOutPlayer } = useAuth();
  const [draft, setDraft] = useState<PlayerAccount | null>(() => player);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [identityState, setIdentityState] = useState<IdentityState>('loading');

  useEffect(() => {
    if (!user) return;
    void fetchIdentityStatus(user)
      .then((identity) => setIdentityState(identity.ageVerified ? 'verified' : 'unverified'))
      .catch(() => setIdentityState('error'));
  }, [user]);

  if (!draft || !user) return null;
  const patch = (change: Partial<PlayerAccount>) => setDraft((current) => current ? { ...current, ...change } : current);
  const save = async () => {
    setBusy(true); setMessage('');
    try { await updatePlayer(draft); setMessage('Profile saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Your profile could not be saved.'); }
    finally { setBusy(false); }
  };
  const startIdentity = async () => {
    setBusy(true); setMessage('');
    try {
      const session = await createIdentitySession(user);
      if (session.identity.ageVerified) { setIdentityState('verified'); setMessage('Age verification is complete.'); return; }
      if (!session.verificationUrl) throw new Error('The verification provider did not return a secure session URL.');
      window.location.assign(session.verificationUrl);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Age verification could not be started.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="profile-layout">
      <Form className="profile-form" onFormSubmit={() => void save()}>
        <div className="field-pair"><TextField id="profile-name" label="Display name" value={draft.name} onChange={(event) => patch({ name: event.target.value })} required /><TextField id="profile-email" label="Verified email" value={draft.email} readOnly disabled /></div>
        <div className="field-pair"><TextField id="profile-phone" label="Phone (optional)" type="tel" value={draft.phone ?? ''} onChange={(event) => patch({ phone: event.target.value })} /><TextField id="profile-location" label="Home area (optional)" value={draft.homeLocation ?? ''} onChange={(event) => patch({ homeLocation: event.target.value })} /></div>
        <div className="field-pair"><TextField id="profile-stakes" label="Preferred stakes" value={draft.preferredStakes ?? ''} onChange={(event) => patch({ preferredStakes: event.target.value })} placeholder="1/2, 2/5…" /><TextField id="profile-radius" label="Search radius (miles)" type="number" min={1} max={250} value={draft.searchRadiusMiles ?? 20} onChange={(event) => patch({ searchRadiusMiles: Number(event.target.value) })} /></div>
        <TextAreaField label="Typical availability" name="typicalAvailability" value={draft.typicalAvailability ?? ''} onChange={(event) => patch({ typicalAvailability: event.target.value })} rows={4} placeholder="Weeknights after 6, weekends…" />
        {message ? <p className="form-message" role="status">{message}</p> : null}
        <div className="form-actions"><Button type="submit" disabled={busy}><Save aria-hidden="true" size={17} />{busy ? 'Saving…' : 'Save profile'}</Button><Button tone="quiet" type="button" onClick={() => void signOutPlayer()}><LogOut aria-hidden="true" size={17} />Sign out</Button></div>
      </Form>
      <aside className="identity-card">
        <p className="eyebrow">Player eligibility</p>
        <div>{identityState === 'verified' ? <StatusBadge tone="success">Age verified</StatusBadge> : identityState === 'loading' ? <div className="identity-skeleton" aria-busy="true" aria-label="Checking verification status"><span /><span /></div> : <StatusBadge tone="warning">Verification needed</StatusBadge>}</div>
        <h2>Keep real-world actions eligible.</h2>
        <p>Orbit uses the backend’s existing age-verification claim for membership, seat requests, and tournament registration. Public browsing remains open.</p>
        {identityState !== 'verified' ? <Button tone="secondary" disabled={busy} onClick={() => void startIdentity()}>Start secure verification<ExternalLink aria-hidden="true" size={16} /></Button> : null}
      </aside>
    </div>
  );
}
