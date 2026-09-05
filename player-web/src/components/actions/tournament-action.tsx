'use client';

import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { buildSignInHref } from '@/src/auth/intent';
import { usePlayerData } from '@/src/data/player-data-context';
import { scheduleAtBoundary } from '@/src/domain/boundary-timer';
import { isTournamentInterestFor } from '@orbit/player-domain/playerSync';
import { formatBuyIn, getNextTournamentInterestBoundary, getTournamentInterestLabel, getTournamentInterestState, tournamentRouteKey } from '@/src/domain/selectors';
import type { PlayerClubSnapshot, PlayerTournament } from '@/src/domain/types';
import { Button, ButtonLink } from '@/src/components/ui/button';
import { Dialog } from '@/src/components/ui/dialog';
import { StatusBadge } from '@/src/components/ui/status-badge';

export function TournamentAction({ club, tournament }: { club: PlayerClubSnapshot | undefined; tournament: PlayerTournament }) {
  const { user } = useAuth();
  const playerData = usePlayerData();
  const searchParams = useSearchParams();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const nextBoundary = getNextTournamentInterestBoundary([tournament], nowMs);
  useEffect(() => {
    if (nextBoundary == null) return;
    return scheduleAtBoundary(nextBoundary, () => setNowMs(Date.now()));
  }, [nextBoundary]);
  const interestState = getTournamentInterestState(tournament, nowMs);
  const interestOpen = interestState === 'open';
  const interestLabel = getTournamentInterestLabel(tournament, nowMs);
  const [open, setOpen] = useState(() => Boolean(user && interestOpen && searchParams.get('intent') === 'tournament'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const interest = playerData.interests.find((item) => isTournamentInterestFor(item, tournament) && item.playerId === user?.uid && item.status === 'interested');
  const canWithdraw = Boolean(interest && tournament.withdrawalAllowed && nowMs < Date.parse(tournament.startsAt));
  const href = `/tournaments/${tournamentRouteKey(club, tournament)}`;
  const disclaimer = 'Interest is nonbinding. It does not register you, reserve a seat, create a debt or payment, or claim a prize. The venue confirms participation separately.';

  if (!user) {
    return <div className="action-panel"><p className="eyebrow">Tournament interest</p><h2>{interestOpen ? 'Tell the venue you are interested' : interestLabel}</h2><p>Sign in to express nonbinding interest in this event.</p><p className="action-note">{disclaimer}</p>{interestOpen ? <ButtonLink href={buildSignInHref(href, 'tournament')}>Express interest</ButtonLink> : <Button disabled>{interestLabel}</Button>}</div>;
  }

  if (interest) {
    return (
      <div className="action-panel action-panel--confirmed">
        <StatusBadge tone="success">Interested</StatusBadge><h2>Your interest was sent</h2><p>{disclaimer}</p>
        {message ? <p className="form-message" role="alert">{message}</p> : null}
        {canWithdraw ? <Button tone="secondary" disabled={busy} onClick={async () => { setBusy(true); setMessage(''); try { await playerData.withdrawInterest(tournament); setMessage('Your interest was withdrawn.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Interest could not be withdrawn.'); } finally { setBusy(false); } }}>{busy ? 'Updating…' : 'Withdraw interest'}</Button> : <p className="action-note">Self-service withdrawal is not available. Contact tournament staff.</p>}
      </div>
    );
  }

  const submit = async () => {
    if (getTournamentInterestState(tournament, Date.now()) !== 'open') {
      setMessage('The venue-published interest window is not open. Refresh for the latest status.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await playerData.expressInterest(tournament);
      setMessage(`Your interest in ${tournament.name} was sent.`);
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Interest could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="action-panel"><p className="eyebrow">Tournament interest</p><h2>{interestOpen ? 'Tell the venue you are interested' : interestLabel}</h2><p>{interestOpen ? disclaimer : 'You can still review and share the event details.'}</p>{message ? <p className="form-message" role="alert">{message}</p> : null}<Button disabled={!interestOpen} onClick={() => setOpen(true)}>{interestOpen ? 'Express interest' : interestLabel}</Button></div>
      <Dialog open={open} onOpenChange={setOpen} title={`Express interest in ${tournament.name}`} description={`${club?.club.name ?? 'The host venue'} will receive your nonbinding interest through Orbit.`}>
        <div className="dialog-form"><div className="notice-box"><strong>{formatBuyIn(tournament)}</strong><p>{disclaimer}</p></div>{message ? <p className="form-message" role="alert">{message}</p> : null}<Button disabled={busy} onClick={() => void submit()}><CheckCircle2 aria-hidden="true" size={18} />{busy ? 'Sending…' : 'Confirm interest'}</Button></div>
      </Dialog>
    </>
  );
}
