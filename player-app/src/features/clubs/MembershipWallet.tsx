import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import { createMembershipQrValue } from '../../domain/membershipQr';
import {
  isMembershipCurrentlyActive,
  type PlayerAccount,
  type PlayerClubSnapshot
} from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { clubStyles } from './clubStyles';

const styles = { ...sharedStyles, ...clubStyles };

export function formatFamiliar(value?: number) {
  const count = Number(value ?? 0);
  return count > 0 ? ` - ${count} familiar player${count === 1 ? '' : 's'}` : '';
}

export function MembershipApplicationStatusCard({
  club,
  membership
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
}) {
  return (
    <View style={styles.membershipApplicationStatus}>
      <View style={styles.membershipApplicationStatusIcon}>
        <Ionicons name="time-outline" size={21} color={colors.primary} />
      </View>
      <View style={styles.membershipApplicationStatusCopy}>
        <Text style={styles.cardTitle}>Application received</Text>
        <Text style={styles.muted}>{club.club.name} is reviewing your {membership.plan === 'day' ? 'day pass' : 'membership'} request. This screen updates as soon as staff approves it.</Text>
      </View>
      <View style={styles.statusPill}><Text style={styles.statusText}>Requested</Text></View>
    </View>
  );
}

export function MembershipWalletCard({
  club,
  membership,
  nowMs,
  player
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  nowMs: number;
  player: PlayerAccount;
}) {
  const active = isMembershipCurrentlyActive(membership, nowMs);
  const approved = membership.status === 'Approved';
  const membershipPlayerId = membership.playerId || player.id;
  const credential = getMembershipDisplayId(club.club.id, membershipPlayerId);
  const qrValue = createMembershipQrValue(club.club.id, membershipPlayerId);
  return (
    <LinearGradient colors={['#111827', '#12384A', '#155E75']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.membershipWalletCard}>
      <View style={styles.membershipWalletTop}>
        <View style={styles.membershipWalletBrand}>
          <View style={styles.membershipWalletMonogram}>
            <Text style={styles.membershipWalletMonogramText}>{club.club.name.slice(0, 1)}</Text>
          </View>
          <View>
            <Text style={styles.membershipWalletClub}>{club.club.name}</Text>
            <Text style={styles.membershipWalletPlan}>{membership.plan === 'day' ? 'DAY PASS' : 'MEMBER'} · {membership.loyalty.tier.toUpperCase()}</Text>
          </View>
        </View>
        <View style={[styles.membershipStatusBadge, !active && styles.membershipStatusBadgeInactive]}>
          <View style={[styles.membershipStatusDot, !active && styles.membershipStatusDotInactive]} />
          <Text style={styles.membershipStatusText}>{active ? 'ACTIVE' : membership.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.membershipIdentityRow}>
        <View>
          <Text style={styles.membershipIdentityLabel}>MEMBER</Text>
          <Text style={styles.membershipIdentityValue}>{player.name}</Text>
        </View>
        <View style={styles.membershipNumberBlock}>
          <Text style={styles.membershipIdentityLabel}>MEMBER ID</Text>
          <Text style={styles.membershipIdentityValue}>{credential.slice(-8)}</Text>
        </View>
      </View>

      {active ? <MembershipQrCode value={qrValue} memberId={credential} /> : null}

      <View style={styles.checkedInBand}>
        <Ionicons name={approved ? 'id-card-outline' : 'scan-outline'} size={17} color="#bfdbfe" />
        <Text style={styles.checkedInText}>{approved
          ? 'Approved. Bring your ID and pay the card-room fee at the front desk to activate.'
          : 'Have staff scan this QR code to check you in.'}</Text>
      </View>
    </LinearGradient>
  );
}

export function MembershipQrCode({ value, memberId }: { value: string; memberId: string }) {
  return (
    <View accessibilityLabel={`Membership check-in QR for member ${memberId}`} style={styles.membershipQrShell}>
      <View style={styles.membershipQrCode}>
        <QRCode value={value} size={142} color="#0f172a" backgroundColor="#ffffff" ecl="M" />
      </View>
      <View style={styles.membershipQrCopy}>
        <Text style={styles.membershipQrTitle}>SCAN TO CHECK IN</Text>
        <Text style={styles.membershipQrMember}>Member {memberId}</Text>
      </View>
    </View>
  );
}

export function getMembershipDisplayId(clubId: string, playerId: string) {
  const source = `${clubId}:${playerId}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
