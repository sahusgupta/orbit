import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedButton } from '../../components/PlayerPresentation';
import type { PlayerClubsViewState } from '../../domain/playerClubViewState';
import {
  getPublishedMembershipPlanLabel,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  type PlayerAccount
} from '../../domain/playerSync';
import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import { sharedStyles } from '../../styles/sharedStyles';
import { PlayerTimePanel } from './ClubHub';
import { MembershipApplicationStatusCard, MembershipWalletCard } from './MembershipWallet';
import { clubStyles } from './clubStyles';

const detailStyles = StyleSheet.create({
  detailScreen: { flexGrow: 1, gap: 16 },
  extensionFooter: { gap: 8, marginTop: 'auto' }
});
const baseStyles = { ...sharedStyles, ...clubStyles, ...detailStyles };

export function MembershipDetailsScreen({ viewState, player, nowMs, message, onBack, onManageAccess, demoMode = false }: {
  viewState: PlayerClubsViewState;
  player: PlayerAccount;
  nowMs: number;
  message: string;
  onBack: () => void;
  onManageAccess: () => void;
  demoMode?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const club = viewState.kind === 'ready' ? viewState.selectedClub : undefined;
  const membership = club?.memberships.find((item) => item.clubId === club.club.id && isPlayerMembership(item, player));
  const active = membership && isMembershipCurrentlyActive(membership, nowMs);
  const expired = membership && (membership.status === 'Expired' || membership.status === 'Active' && !active);
  const hasOptions = Boolean(club?.club.membershipOptions?.length);
  const pending = membership?.status === 'Requested' || membership?.status === 'Approved';
  const expiry = membership?.expiresAt ? Date.parse(membership.expiresAt) : Number.NaN;
  return (
    <View style={styles.detailScreen}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to memberships" style={styles.inlineBackAction} onPress={onBack}>
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
        <Text style={styles.inlineBackText}>Memberships</Text>
      </Pressable>
      {!club ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>{viewState.kind === 'loading' ? 'Refreshing membership' : viewState.kind === 'stale' ? 'Membership temporarily read-only' : 'Membership unavailable'}</Text>
          <Text style={styles.muted}>{viewState.kind === 'removed' ? viewState.message : viewState.kind === 'loading'
            ? 'Your membership will appear when current venue data finishes loading.'
            : 'Reconnect and refresh your clubs to view current membership details.'}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Membership details</Text>
          {membership ? (
            <>
              {membership.status === 'Requested' ? <MembershipApplicationStatusCard club={club} membership={membership} />
                : <MembershipWalletCard club={club} membership={membership} nowMs={nowMs} player={player} demoMode={demoMode} />}
              <View style={styles.accountCard}>
                <View style={styles.membershipIdentityRow}>
                  <View><Text style={styles.inputLabel}>Published plan</Text><Text style={styles.muted}>{getPublishedMembershipPlanLabel(membership)}</Text></View>
                  <View style={styles.statusPill}><Text style={styles.statusText}>{expired ? 'Expired' : membership.status}</Text></View>
                </View>
                {membership.membershipDurationDays && membership.membershipDurationDays > 0 ? <Text style={styles.muted}>{membership.membershipDurationDays}-day membership</Text> : null}
                <Text style={styles.inputLabel}>{expired ? 'Expired' : 'Expires'}</Text>
                <Text style={styles.muted}>{Number.isFinite(expiry) ? new Date(expiry).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Expiry not published'}</Text>
                {membership.clubNote ? <Text style={styles.muted}>{membership.clubNote}</Text> : null}
              </View>
            </>
          ) : (
            <View style={styles.accountCard}>
              <Text style={styles.cardTitle}>{club.club.name}</Text>
              <Text style={styles.muted}>{player.name}</Text>
              <Text style={styles.muted}>No membership has been published for your profile.</Text>
            </View>
          )}
          <PlayerTimePanel club={club} message="" />
          {message ? <Text accessibilityLiveRegion="polite" style={styles.actionStatus}>{message}</Text> : null}
          <View style={styles.extensionFooter}>
            {pending ? <Text style={styles.muted}>Venue staff will confirm your access request and publish any changes here.</Text> : hasOptions ? (
              <>
                <AnimatedButton variant="primary" onPress={onManageAccess} style={[styles.primaryButton, styles.fullWidthButton]}>
                  <Ionicons name="calendar-outline" size={18} color={colors.onPrimary} />
                  <Text style={styles.primaryButtonText}>{membership ? 'Extend membership' : 'View membership options'}</Text>
                </AnimatedButton>
                <Text style={styles.muted}>{membership ? 'Choose a published option to request an extension. The venue confirms your extension and expiry.' : 'Choose a published option to request venue access.'}</Text>
              </>
            ) : <Text style={styles.muted}>Contact the venue to {membership ? 'extend your membership' : 'request membership'}; no membership options are currently published.</Text>}
          </View>
        </>
      )}
    </View>
  );
}
