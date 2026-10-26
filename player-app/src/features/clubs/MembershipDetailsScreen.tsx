import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import type { PlayerClubsViewState } from '../../domain/playerClubViewState';
import {
  getPublishedMembershipPlanLabel,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  type PlayerAccount
} from '../../domain/playerSync';
import { PlayerTimePanel } from './ClubHub';
import { MembershipApplicationStatusCard, MembershipWalletCard } from './MembershipWallet';
import { MembershipPassCard } from './MembershipPass';
import { membershipPresentation as styles, useMembershipPalette } from './membershipPresentation';

export function MembershipDetailsScreen({ viewState, player, nowMs, message, onBack, onManageAccess, demoMode = false }: {
  viewState: PlayerClubsViewState;
  player: PlayerAccount;
  nowMs: number;
  message: string;
  onBack: () => void;
  onManageAccess: () => void;
  demoMode?: boolean;
}) {
  const palette = useMembershipPalette();
  const club = viewState.kind === 'ready' ? viewState.selectedClub : undefined;
  const membership = club?.memberships.find((item) => item.clubId === club.club.id && isPlayerMembership(item, player));
  const active = membership && isMembershipCurrentlyActive(membership, nowMs);
  const expired = membership && (membership.status === 'Expired' || membership.status === 'Active' && !active);
  const hasOptions = Boolean(club?.club.membershipOptions?.length);
  const pending = membership?.status === 'Requested' || membership?.status === 'Approved';
  const expiry = membership?.expiresAt ? Date.parse(membership.expiresAt) : Number.NaN;
  const joined = membership?.joinedAt ? Date.parse(membership.joinedAt) : Number.NaN;
  return (
    <View style={[styles.screen, { backgroundColor: palette.canvas }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to memberships" style={styles.back} onPress={onBack}>
        <Ionicons name="chevron-back" size={18} color={palette.accent} />
        <Text style={[styles.backText, { color: palette.accent }]}>Memberships</Text>
      </Pressable>
      {!club ? (
        <View accessibilityRole="alert" style={styles.section}>
          <Text style={[styles.sectionHeading, { color: palette.ink }]}>{viewState.kind === 'loading' ? 'Refreshing membership' : viewState.kind === 'stale' ? 'Membership temporarily read-only' : 'Membership unavailable'}</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{viewState.kind === 'removed' ? viewState.message : viewState.kind === 'loading'
            ? 'Your membership will appear when current venue data finishes loading.'
            : 'Reconnect and refresh your clubs to view current membership details.'}</Text>
        </View>
      ) : (
        <>
          {membership ? (
            <>
              <MembershipPassCard club={club} membership={membership} player={player} nowMs={nowMs} variant="detail" />
              <View style={styles.section}>
                <View style={[styles.intro, styles.rule, { borderColor: palette.line }]}>
                  <Text style={[styles.eyebrow, { color: palette.accent }]}>MEMBERSHIP</Text>
                  <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>{club.club.name}</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>{getPublishedMembershipPlanLabel(membership)}</Text>
                  {club.club.address ? <Text style={[styles.body, { color: palette.muted }]}>{club.club.address}</Text> : null}
                </View>
                <DetailRow label="Member" value={player.name} />
                <DetailRow label="Membership ID" value={membership.id} />
                <DetailRow label="Status" value={expired ? 'Expired' : membership.status} />
                <DetailRow label="Member since" value={Number.isFinite(joined) ? new Date(joined).toLocaleDateString([], { month: 'long', year: 'numeric' }) : 'Not published'} />
                <DetailRow label={expired ? 'Expired' : 'Expires'} value={Number.isFinite(expiry) ? new Date(expiry).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Expiry not published'} />
                {membership.membershipDurationDays && membership.membershipDurationDays > 0 ? <Text style={[styles.body, { color: palette.muted }]}>{membership.membershipDurationDays}-day membership</Text> : null}
              </View>
              {membership.clubNote?.trim() ? <View style={[styles.note, { borderColor: palette.accent }]}>
                <Text style={[styles.sectionHeading, { color: palette.ink }]}>From your venue</Text>
                <Text style={[styles.body, { color: palette.muted }]}>{membership.clubNote}</Text>
              </View> : null}
              {membership.status === 'Requested' ? <MembershipApplicationStatusCard club={club} membership={membership} />
                : <MembershipWalletCard club={club} membership={membership} nowMs={nowMs} player={player} demoMode={demoMode} showPass={false} />}
            </>
          ) : (
            <View style={styles.section}>
              <Text style={[styles.heading, { color: palette.ink }]}>{club.club.name}</Text>
              <Text style={[styles.body, { color: palette.muted }]}>{player.name}</Text>
              <Text style={[styles.body, { color: palette.muted }]}>No membership has been published for your profile.</Text>
            </View>
          )}
          <PlayerTimePanel club={club} message="" />
          {message ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: palette.accent }]}>{message}</Text> : null}
          <View style={styles.footer}>
            {pending ? <Text style={[styles.body, { color: palette.muted }]}>Venue staff will confirm your access request and publish any changes here.</Text> : hasOptions ? (
              <>
                <Pressable accessibilityRole="button" onPress={onManageAccess} style={[styles.action, { backgroundColor: palette.accent }]}>
                  <Ionicons name="calendar-outline" size={18} color={palette.onAccent} />
                  <Text style={[styles.actionText, { color: palette.onAccent }]}>{membership ? 'Extend membership' : 'View membership options'}</Text>
                </Pressable>
                <Text style={[styles.body, { color: palette.muted }]}>{membership ? 'Choose a published option to request an extension. The venue confirms your extension and expiry.' : 'Choose a published option to request venue access.'}</Text>
              </>
            ) : <Text style={[styles.body, { color: palette.muted }]}>Contact the venue to {membership ? 'extend your membership' : 'request membership'}; no membership options are currently published.</Text>}
          </View>
        </>
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const palette = useMembershipPalette();
  return <View style={styles.detailRow}>
    <Text style={[styles.detailLabel, { color: palette.muted }]}>{label}</Text>
    <Text style={[styles.detailValue, { color: palette.ink }]}>{value}</Text>
  </View>;
}
