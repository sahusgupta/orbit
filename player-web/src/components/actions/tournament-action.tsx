'use client';

import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { buildSignInHref } from '@/src/auth/intent';
import { usePlayerData } from '@/src/data/player-data-context';
import { tournamentRouteKey } from '@/src/domain/selectors';
import type { PlayerClubSnapshot, PlayerTournament } from '@/src/domain/types';
import { Button, ButtonLink } from '@/src/components/ui/button';
import { Dialog } from '@/src/components/ui/dialog';
import { StatusBadge } from '@/src/components/ui/status-badge';

export function TournamentAction({ club, tournament }: { club: PlayerClubSnapshot | undefined; tournament: PlayerTournament }) {
  const { user } = useAuth();
  const playerData = usePlayerData();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(user && searchParams.get('intent') === 'tournament'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const registration = playerData.registrations.find((item) => item.tournamentId === tournament.id && item.playerId === user?.uid);
  const [nowMs] = useState(() => Date.now());
  const openRegistration = tournament.registrationStatus === 'open' && nowMs < Date.parse(tournament.registrationClosesAt);
  const canUnregister = Boolean(registration && tournament.unregisterAllowed && nowMs < Date.parse(tournament.startsAt));
  const href = `/tournaments/${tournamentRouteKey(club, tournament)}`;

  if (!user) {
    return <div className="action-panel"><p className="eyebrow">Registration</p><h2>{openRegistration ? 'Reserve your entry' : 'Registration is closed'}</h2><p>This event stays public. Sign in only when you are ready to register.</p>{openRegistration ? <ButtonLink href={buildSignInHref(href, 'tournament')}>Register</ButtonLink> : <Button disabled>Registration closed</Button>}</div>;
  }

  if (registration) {
    return (
      <div className="action-panel action-panel--confirmed">
        <StatusBadge tone="success">Registered</StatusBadge><h2>Your entry is confirmed</h2><p>Status: {registration.status.replace(/-/g, ' ')}. Orbit Core has this registration.</p>
        {message ? <p className="form-message" role="alert">{message}</p> : null}
        {canUnregister ? <Button tone="secondary" disabled={busy} onClick={async () => { setBusy(true); setMessage(''); try { await playerData.unregister(tournament); setMessage('Your registration was removed.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Registration could not be removed.'); } finally { setBusy(false); } }}>{busy ? 'Updating…' : 'Unregister'}</Button> : <p className="action-note">Self-unregistration is no longer available. Contact tournament staff.</p>}
      </div>
    );
  }

  const submit = async () => {
    setBusy(true); setMessage('');
    try { await playerData.register(tournament); setMessage(`You’re registered for ${tournament.name}.`); setOpen(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Registration could not be saved.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="action-panel"><p className="eyebrow">Registration</p><h2>{openRegistration ? 'Reserve your entry' : 'Registration is closed'}</h2><p>{openRegistration ? 'One confirmation sends your registration through the authoritative Orbit backend.' : 'You can still review and share every event detail.'}</p>{message ? <p className="form-message" role="alert">{message}</p> : null}<Button disabled={!openRegistration} onClick={() => setOpen(true)}>{openRegistration ? 'Register' : 'Registration closed'}</Button></div>
      <Dialog open={open} onOpenChange={setOpen} title={`Register for ${tournament.name}`} description={`${club?.club.name ?? 'The host club'} will receive this entry through Orbit Core.`}>
        <div className="dialog-form"><div className="notice-box"><strong>{tournament.buyIn === 0 ? 'Free entry' : `$${tournament.buyIn.toLocaleString()} buy-in`}</strong><p>Registration records your intent. Any payment or check-in still follows the host’s stated process.</p></div>{message ? <p className="form-message" role="alert">{message}</p> : null}<Button disabled={busy} onClick={() => void submit()}><CheckCircle2 aria-hidden="true" size={18} />{busy ? 'Registering…' : 'Confirm registration'}</Button></div>
      </Dialog>
    </>
  );
}
