'use client';

import { Fieldset } from '@base-ui/react/fieldset';
import { Form } from '@base-ui/react/form';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { CheckCircle2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { buildSignInHref } from '@/src/auth/intent';
import { usePlayerData } from '@/src/data/player-data-context';
import { clubRouteKey, getMembershipState, getPlayerMembership } from '@/src/domain/selectors';
import type { PlayerClubSnapshot, PlayerMembershipOption } from '@/src/domain/types';
import { Button, ButtonLink } from '@/src/components/ui/button';
import { Dialog } from '@/src/components/ui/dialog';
import { StatusBadge } from '@/src/components/ui/status-badge';

export function ClubMembershipAction({ club }: { club: PlayerClubSnapshot }) {
  const { user, player } = useAuth();
  const playerData = usePlayerData();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(() => Boolean(user && searchParams.get('intent') === 'membership'));
  const [selectedId, setSelectedId] = useState(club.club.membershipOptions?.[0]?.id ?? 'club-plan');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const liveClub = playerData.clubs.find((candidate) => candidate.club.id === club.club.id) ?? club;
  const membership = getPlayerMembership(liveClub, player);
  const state = getMembershipState(liveClub, player);
  const options = liveClub.club.membershipOptions ?? [];
  const href = `/clubs/${clubRouteKey(club)}`;

  if (!user) {
    return (
      <div className="action-panel">
        <p className="eyebrow">Membership</p><h2>Join this club</h2>
        <p>Browse freely. Sign in only when you are ready to request access.</p>
        <ButtonLink href={buildSignInHref(href, 'membership')}>Request membership</ButtonLink>
      </div>
    );
  }

  if (state === 'active') {
    return <div className="action-panel action-panel--confirmed"><StatusBadge tone="success">Active member</StatusBadge><h2>You’re in</h2><p>{membership?.expiresAt ? `Active through ${new Date(membership.expiresAt).toLocaleDateString()}.` : 'Your membership is active.'}</p><ButtonLink href="/me/clubs" tone="secondary">View My Clubs</ButtonLink></div>;
  }

  if (state === 'requested') {
    return <div className="action-panel"><StatusBadge tone="warning">Under review</StatusBadge><h2>Membership requested</h2><p>{membership?.status === 'Approved' ? 'Approved. Bring your ID and pay at the club to activate it.' : 'The club has your request. You’ll see the active state here after staff approval.'}</p><ButtonLink href="/me/clubs" tone="secondary">View My Clubs</ButtonLink></div>;
  }

  const selectedOption = options.find((option) => option.id === selectedId);
  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      await playerData.requestMembership(liveClub, selectedOption);
      setMessage('Application sent. The club will review it before payment and activation.');
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Your membership request could not be sent.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="action-panel"><p className="eyebrow">Membership</p><h2>Join {club.club.name}</h2><p>Request access now. Payment and activation happen only through the club’s supported process.</p>{message ? <p className="form-message" role="alert">{message}</p> : null}<Button onClick={() => setOpen(true)}>Request membership</Button></div>
      <Dialog open={open} onOpenChange={setOpen} title={`Membership at ${club.club.name}`} description="Choose an available product. This sends a pay-in-person request; it does not claim payment is complete.">
        <Form className="dialog-form" onFormSubmit={() => void submit()}>
          {options.length ? <Fieldset.Root className="membership-options"><Fieldset.Legend>Membership option</Fieldset.Legend><RadioGroup className="membership-options__choices" name="membership" value={selectedId} onValueChange={setSelectedId}>{options.map((option: PlayerMembershipOption) => <label key={option.id}><Radio.Root className="radio-control" value={option.id}><Radio.Indicator className="radio-control__indicator" /></Radio.Root><span><strong>{option.name}</strong><small>{option.priceLabel}{option.description ? ` · ${option.description}` : ''}</small></span></label>)}</RadioGroup></Fieldset.Root> : <div className="notice-box"><strong>Club-priced membership</strong><p>The club will confirm the current product and price before activation.</p></div>}
          {message ? <p className="form-message" role="alert">{message}</p> : null}
          <Button type="submit" disabled={busy}><CheckCircle2 aria-hidden="true" size={18} />{busy ? 'Sending…' : 'Send request'}</Button>
        </Form>
      </Dialog>
    </>
  );
}
