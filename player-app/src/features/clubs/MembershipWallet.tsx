import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import { createMembershipQrMutationId, isMembershipQrUsable, type MembershipQrCredential } from '../../domain/membershipQr';
import { getCurrentFirebasePlayer, issueRemoteMembershipQr } from '../../data/orbitSyncApi';
import {
  getApprovedMembershipActivationCopy,
  getPublishedMembershipPlanLabel,
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
        <Text style={styles.muted}>{club.club.name} is reviewing your {membership.planName?.trim() || 'membership access'} request. This screen updates when staff publishes a status.</Text>
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
  const approvedCopy = getApprovedMembershipActivationCopy(membership);
  return (
    <LinearGradient colors={['#111827', '#12384A', '#155E75']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.membershipWalletCard}>
      <View style={styles.membershipWalletTop}>
        <View style={styles.membershipWalletBrand}>
          <View style={styles.membershipWalletMonogram}>
            <Text style={styles.membershipWalletMonogramText}>{club.club.name.slice(0, 1)}</Text>
          </View>
          <View>
            <Text style={styles.membershipWalletClub}>{club.club.name}</Text>
            <Text style={styles.membershipWalletPlan}>{getPublishedMembershipPlanLabel(membership).toUpperCase()}</Text>
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
      </View>

      {active ? <MembershipQrIssuer clubId={club.club.id} nowMs={nowMs} playerId={player.id} /> : null}

      <View style={styles.checkedInBand}>
        <Ionicons name={approved ? 'id-card-outline' : 'scan-outline'} size={17} color="#bfdbfe" />
        <Text style={styles.checkedInText}>{approved
          ? `${approvedCopy.title}. ${approvedCopy.body}`
          : 'Have staff scan this QR code to check you in.'}</Text>
      </View>
    </LinearGradient>
  );
}

export function MembershipQrCode({ value }: { value: string }) {
  return (
    <View accessibilityLabel="Membership check-in QR" style={styles.membershipQrShell}>
      <View style={styles.membershipQrCode}>
        <QRCode value={value} size={142} color="#0f172a" backgroundColor="#ffffff" ecl="M" />
      </View>
      <View style={styles.membershipQrCopy}>
        <Text style={styles.membershipQrTitle}>SCAN TO CHECK IN</Text>
        <Text style={styles.membershipQrMember}>Short-lived venue check-in code</Text>
      </View>
    </View>
  );
}

function MembershipQrIssuer({ clubId, nowMs, playerId }: { clubId: string; nowMs: number; playerId: string }) {
  const [credential, setCredential] = useState<MembershipQrCredential | null>(null);
  const [message, setMessage] = useState('Generate a short-lived code when venue staff is ready to scan it.');
  const [busy, setBusy] = useState(false);
  const mutationId = useRef<string | null>(null);
  const session = useRef({ generation: 0, uid: playerId });
  const usable = isMembershipQrUsable(credential, nowMs);

  useEffect(() => {
    if (session.current.uid === playerId) return;
    session.current = { generation: session.current.generation + 1, uid: playerId };
    mutationId.current = null;
    setCredential(null);
    setMessage('Generate a short-lived code when venue staff is ready to scan it.');
    setBusy(false);
  }, [playerId]);

  const issue = async () => {
    if (busy) return;
    const expectedUid = playerId;
    const generation = session.current.generation;
    const isCurrentRequest = () => (
      session.current.uid === expectedUid &&
      session.current.generation === generation &&
      getCurrentFirebasePlayer()?.uid === expectedUid
    );
    setBusy(true);
    setMessage('Requesting a secure check-in code...');
    const requestMutationId = mutationId.current ?? createMembershipQrMutationId();
    mutationId.current = requestMutationId;
    try {
      const result = await issueRemoteMembershipQr(clubId, requestMutationId, playerId);
      if (!isCurrentRequest()) return;
      setCredential({ token: result.token, issuedAt: result.issuedAt, expiresAt: result.expiresAt });
      mutationId.current = null;
      setMessage(`Expires ${formatQrExpiry(result.expiresAt)}. Refresh only when staff needs a new code.`);
    } catch (error) {
      if (!isCurrentRequest()) return;
      setCredential(null);
      setMessage(error instanceof Error ? error.message : 'Unable to issue a membership check-in code.');
    } finally {
      if (isCurrentRequest()) setBusy(false);
    }
  };

  return (
    <View>
      {usable && credential ? <MembershipQrCode value={credential.token} /> : null}
      {credential && !usable ? <Text style={styles.checkedInText}>This check-in code expired. Request a new one when staff is ready.</Text> : null}
      <Text accessibilityLiveRegion="polite" style={styles.checkedInText}>{message}</Text>
      <Pressable disabled={busy} onPress={() => void issue()} style={[styles.qrActionButton, busy && styles.disabledAction]}>
        <Text style={styles.qrActionText}>{busy ? 'Requesting code...' : usable ? 'Refresh check-in code' : 'Generate check-in code'}</Text>
      </Pressable>
    </View>
  );
}

export function formatQrExpiry(value: string) {
  const expiry = new Date(value);
  return Number.isNaN(expiry.getTime()) ? 'Expiration unavailable' : expiry.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
