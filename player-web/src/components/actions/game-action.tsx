'use client';

import { Fieldset } from '@base-ui/react/fieldset';
import { Form } from '@base-ui/react/form';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { CheckCircle2, Clock3, MapPin, UsersRound } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { buildSignInHref } from '@/src/auth/intent';
import { useAuth } from '@/src/auth/auth-context';
import { usePlayerData } from '@/src/data/player-data-context';
import {
  gameRouteKey,
  getActivePlayerRequests,
  getGamePrimaryAction,
  getMembershipState
} from '@/src/domain/selectors';
import type { PlayerClubSnapshot, PlayerSyncGame, SeatRequestInput } from '@/src/domain/types';
import { Button, ButtonLink } from '@/src/components/ui/button';
import { Dialog } from '@/src/components/ui/dialog';
import { TextField } from '@/src/components/ui/fields';
import { StatusBadge } from '@/src/components/ui/status-badge';

export function GameAction({ club, game }: { club: PlayerClubSnapshot; game: PlayerSyncGame }) {
  const { user, player } = useAuth();
  const playerData = usePlayerData();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(user && searchParams.get('intent') === 'waitlist'));
  const [attendance, setAttendance] = useState<SeatRequestInput['attendance']>(game.openTables.some((table) => table.status === 'Forming') ? 'interested' : 'confirmed');
  const [expectedArrivalTime, setExpectedArrivalTime] = useState('');
  const [availabilityStartTime, setAvailabilityStartTime] = useState('');
  const [availabilityEndTime, setAvailabilityEndTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const liveClub = playerData.clubs.find((candidate) => candidate.club.id === club.club.id) ?? club;
  const liveGame = liveClub.games.find((candidate) => candidate.id === game.id) ?? game;
  const membershipState = getMembershipState(liveClub, player);
  const activeRequest = useMemo(() => getActivePlayerRequests([liveClub], player).find((item) => item.entry.gameId === game.id), [game.id, liveClub, player]);
  const href = `/games/${gameRouteKey(club, game)}`;

  if (!user) {
    return (
      <div className="action-panel">
        <p className="eyebrow">Player action</p>
        <h2>{getGamePrimaryAction(game)}</h2>
        <p>Create an account or sign in to view this game and choose your next action.</p>
        <ButtonLink href={buildSignInHref(href, 'waitlist')}>{getGamePrimaryAction(game)}</ButtonLink>
      </div>
    );
  }

  if (activeRequest) {
    return (
      <div className="action-panel action-panel--confirmed">
        <StatusBadge tone="success">Request active</StatusBadge>
        <h2>{activeRequest.entry.status === 'Interested' ? 'Interest sent' : activeRequest.entry.status}</h2>
        <p>Orbit Core has your current commitment. Changes stay authoritative and visible to the club.</p>
        <dl className="action-summary"><div><dt>Game</dt><dd>{liveGame.name}</dd></div><div><dt>Position</dt><dd>{activeRequest.entry.position || 'Club confirmed'}</dd></div></dl>
        {message ? <p className="form-message" role="status">{message}</p> : null}
        <Button tone="secondary" disabled={busy} onClick={async () => {
          setBusy(true); setMessage('');
          try { await playerData.cancelSeat(liveClub, liveGame); setMessage('Your game request was removed.'); }
          catch (error) { setMessage(error instanceof Error ? error.message : 'Your game request could not be removed.'); }
          finally { setBusy(false); }
        }}>{busy ? 'Updating…' : 'Cancel request'}</Button>
      </div>
    );
  }

  if (membershipState !== 'active') {
    return (
      <div className="action-panel">
        <p className="eyebrow">Membership required</p>
        <h2>{membershipState === 'requested' ? 'Your request is under review' : `Join ${club.club.name} first`}</h2>
        <p>{membershipState === 'requested' ? 'The club must approve and activate membership before a seat request can be accepted.' : 'Orbit preserves the club’s membership gate for live game commitments.'}</p>
        <ButtonLink href={`/clubs/${club.club.id}?intent=membership`}>{membershipState === 'requested' ? 'View membership' : 'Request membership'}</ButtonLink>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setMessage('');
    try {
      await playerData.requestSeat(liveClub, liveGame, { attendance, expectedArrivalTime, availabilityStartTime, availabilityEndTime });
      setMessage('Your request is confirmed in Orbit.');
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your request could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="action-panel">
        <p className="eyebrow">Player action</p>
        <h2>{getGamePrimaryAction(liveGame)}</h2>
        <p>Tell the room where you are in one clear step. You can change this later.</p>
        {message ? <p className="form-message" role="alert">{message}</p> : null}
        <Button onClick={() => setOpen(true)}>{getGamePrimaryAction(liveGame)}</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={`Your plan for ${liveGame.name}`} description={`${liveClub.club.name} will receive this through Orbit Core.`}>
        <Form className="dialog-form" onFormSubmit={() => void submit()}>
          <Fieldset.Root className="choice-grid">
            <Fieldset.Legend>Where are you now?</Fieldset.Legend>
            <RadioGroup className="choice-grid__options" name="attendance" value={attendance} onValueChange={(value) => setAttendance(value)}>
              <label><Radio.Root className="radio-control" value="arrived"><Radio.Indicator className="radio-control__indicator" /></Radio.Root><MapPin aria-hidden="true" /><span><strong>I’m here</strong><small>Ready to check in</small></span></label>
              <label><Radio.Root className="radio-control" value="confirmed"><Radio.Indicator className="radio-control__indicator" /></Radio.Root><Clock3 aria-hidden="true" /><span><strong>I’m coming</strong><small>Share an arrival time</small></span></label>
              <label><Radio.Root className="radio-control" value="interested"><Radio.Indicator className="radio-control__indicator" /></Radio.Root><UsersRound aria-hidden="true" /><span><strong>I’m interested</strong><small>Help this game form</small></span></label>
            </RadioGroup>
          </Fieldset.Root>
          {attendance === 'confirmed' ? <TextField id="expected-arrival" label="Expected arrival" name="expectedArrivalTime" type="time" value={expectedArrivalTime} onChange={(event) => setExpectedArrivalTime(event.target.value)} required /> : null}
          {attendance === 'interested' ? <div className="field-pair"><TextField id="availability-start" label="Available from" name="availabilityStartTime" type="time" value={availabilityStartTime} onChange={(event) => setAvailabilityStartTime(event.target.value)} /><TextField id="availability-end" label="Available until" name="availabilityEndTime" type="time" value={availabilityEndTime} onChange={(event) => setAvailabilityEndTime(event.target.value)} /></div> : null}
          {message ? <p className="form-message" role="alert">{message}</p> : null}
          <Button type="submit" disabled={busy}><CheckCircle2 aria-hidden="true" size={18} />{busy ? 'Sending…' : 'Confirm with club'}</Button>
        </Form>
      </Dialog>
    </>
  );
}
