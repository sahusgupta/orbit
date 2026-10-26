import { useThemedStyles } from '../../styles/PlayerThemeProvider';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { createMembershipQrMutationId, isMembershipQrUsable, type MembershipQrCredential } from '../../domain/membershipQr';
import { getCurrentFirebasePlayer, issueRemoteMembershipQr } from '../../data/orbitSyncApi';
import {
  getApprovedMembershipActivationCopy,
  isMembershipCurrentlyActive,
  type PlayerAccount,
  type PlayerClubSnapshot
} from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { clubStyles } from './clubStyles';
import { MembershipPassCard } from './MembershipPass';
import { membershipPresentation as presentation, useMembershipPalette } from './membershipPresentation';

const baseStyles = { ...sharedStyles, ...clubStyles };

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
  const styles = useThemedStyles(baseStyles);
  const palette = useMembershipPalette();
  return (
    <View style={[styles.membershipApplicationStatus, { backgroundColor: palette.panel, borderColor: palette.line }]}>
      <View style={styles.membershipApplicationStatusIcon}>
        <Ionicons name="time-outline" size={21} color={palette.accent} />
      </View>
      <View style={styles.membershipApplicationStatusCopy}>
        <Text style={[styles.cardTitle, { color: palette.ink }]}>Application received</Text>
        <Text style={[styles.muted, { color: palette.muted }]}>{club.club.name} is reviewing your {membership.planName?.trim() || 'membership access'} request. This screen updates when staff publishes a status.</Text>
      </View>
      <View style={styles.statusPill}><Text style={styles.statusText}>Requested</Text></View>
    </View>
  );
}

export function MembershipWalletCard({
  club,
  membership,
  nowMs,
  player,
  demoMode = false,
  showPass = true
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  nowMs: number;
  player: PlayerAccount;
  demoMode?: boolean;
  showPass?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const palette = useMembershipPalette();
  const active = isMembershipCurrentlyActive(membership, nowMs);
  const expired = membership.status === 'Expired' || membership.status === 'Active' && !active;
  const approved = membership.status === 'Approved';
  const approvedCopy = getApprovedMembershipActivationCopy(membership);
  return (
    <View style={presentation.section}>
      {showPass ? <MembershipPassCard club={club} membership={membership} player={player} nowMs={nowMs} variant="detail" /> : null}
      <View style={[presentation.checkIn, { backgroundColor: palette.panel, borderColor: palette.line }]}>
        <Text style={[presentation.sectionHeading, { color: palette.ink }]}>Venue check-in</Text>
        {active && membership.expiresAt && Number.isFinite(Date.parse(membership.expiresAt)) ? <Text style={[presentation.body, { color: palette.muted }]}>Access until {new Date(membership.expiresAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text> : null}

        {active && !demoMode ? <MembershipQrIssuer key={JSON.stringify([club.club.id, player.id])} clubId={club.club.id} nowMs={nowMs} playerId={player.id} /> : null}

        <View style={presentation.statusBand}>
          <Ionicons name={expired ? 'time-outline' : approved ? 'id-card-outline' : 'scan-outline'} size={17} color={palette.accent} />
          <Text style={[styles.checkedInText, { color: palette.muted }]}>{demoMode
            ? 'Sample membership only. Venue check-in is unavailable in the sample account.'
            : expired
            ? 'This membership has expired. Review the venue’s published access options to renew.'
            : approved
            ? `${approvedCopy.title}. ${approvedCopy.body}`
            : 'Have staff scan this QR code to check you in.'}</Text>
        </View>
      </View>
    </View>
  );
}

export function MembershipQrCode({ value }: { value: string }) {
  const styles = useThemedStyles(baseStyles);
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
  const styles = useThemedStyles(baseStyles);
  const palette = useMembershipPalette();
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
    <View style={presentation.section}>
      {usable && credential ? <MembershipQrCode value={credential.token} /> : null}
      {credential && !usable ? <Text style={[styles.checkedInText, { color: palette.ink }]}>This check-in code expired. Request a new one when staff is ready.</Text> : null}
      <Text accessibilityLiveRegion="polite" style={[styles.checkedInText, { color: palette.muted }]}>{message}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={usable ? 'Refresh membership check-in code' : 'Generate membership check-in code'} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void issue()} style={[styles.qrActionButton, { backgroundColor: palette.accent }, busy && styles.disabledAction]}>
        <Text style={[styles.qrActionText, { color: palette.onAccent }]}>{busy ? 'Requesting code...' : usable ? 'Refresh check-in code' : 'Generate check-in code'}</Text>
      </Pressable>
    </View>
  );
}

export function formatQrExpiry(value: string) {
  const expiry = new Date(value);
  return Number.isNaN(expiry.getTime()) ? 'Expiration unavailable' : expiry.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
