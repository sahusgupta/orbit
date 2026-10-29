import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  getPublishedMembershipPlanLabel,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  type PlayerAccount,
  type PlayerClubSnapshot,
  type PlayerMembership
} from '../../domain/playerSync';
import { useMembershipPalette } from './membershipPresentation';

type MembershipPassProps = {
  club: PlayerClubSnapshot;
  membership: PlayerMembership;
  player: PlayerAccount;
  nowMs: number;
  variant?: 'wallet' | 'detail';
};

const FINISHES = [
  { colors: ['#0B1F1A', '#285C47', '#173B30', '#091C17'] as const, ink: '#F5D88C', detail: '#F4E5BE', line: 'rgba(245,216,140,0.44)' },
  { colors: ['#260F18', '#6D3343', '#41202C', '#210D16'] as const, ink: '#F3D7A1', detail: '#F4E5C8', line: 'rgba(243,215,161,0.44)' },
  { colors: ['#101A2B', '#3C4D67', '#202F47', '#0C1525'] as const, ink: '#E7EDF5', detail: '#D8E0EA', line: 'rgba(220,230,242,0.44)' }
];
const CARD_HEIGHT = 244;
const EXPOSED_HEIGHT = 88;

function finishForClub(clubId: string) {
  let hash = 0;
  for (let index = 0; index < clubId.length; index += 1) hash = (Math.imul(hash, 31) + clubId.charCodeAt(index)) >>> 0;
  return FINISHES[hash % FINISHES.length];
}

function membershipStatus(membership: PlayerMembership, nowMs: number) {
  return membership.status === 'Active' && !isMembershipCurrentlyActive(membership, nowMs) ? 'Expired' : membership.status;
}

/** The card finish stays fixed in both OS themes, like a physical membership pass. */
export function MembershipPassCard({ club, membership, player, nowMs, variant = 'detail' }: MembershipPassProps) {
  const finish = finishForClub(club.club.id);
  const status = membershipStatus(membership, nowMs);
  return (
    <View style={[styles.card, variant === 'detail' && styles.detailCard]}>
      <LinearGradient colors={finish.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
      <View pointerEvents="none" style={styles.ornaments}>
        <View style={[styles.outerRing, { borderColor: finish.line }]} />
        <View style={[styles.innerRing, { borderColor: finish.line }]} />
        <View style={styles.metalShine} />
        <View style={[styles.insetBorder, { borderColor: finish.line }]} />
      </View>
      <View style={styles.heading}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.clubName, variant === 'detail' && styles.detailClubName, { color: finish.ink }]}>{club.club.name}</Text>
          <View style={[styles.diamond, { borderColor: finish.ink }]} />
        </View>
        <Text style={[styles.status, { color: finish.detail }]}>{status}</Text>
      </View>
      <View pointerEvents="none" style={[styles.seal, { borderColor: finish.line }]}>
        <View style={[styles.sealDiamond, { borderColor: finish.line }]} />
        <Text style={[styles.monogram, { color: finish.ink }]}>{club.club.name.trim().slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.copy}>
        <View style={[styles.rule, { backgroundColor: finish.line }]} />
        <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.plan, { color: finish.ink }]}>{getPublishedMembershipPlanLabel(membership).toUpperCase()}</Text>
        <View style={styles.identityRow}>
          <View style={styles.identity}>
            <Text style={[styles.label, { color: finish.detail }]}>MEMBER</Text>
            <Text numberOfLines={1} style={[styles.value, { color: finish.detail }]}>{player.name}</Text>
          </View>
          <View style={[styles.identity, styles.reference]}>
            <Text style={[styles.label, { color: finish.detail }]}>MEMBERSHIP ID</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.value, styles.referenceValue, { color: finish.detail }]}>{membership.id}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function MembershipPassWallet({ clubs, player, nowMs, onSelectClub, selectedClubId }: {
  clubs: PlayerClubSnapshot[];
  player: PlayerAccount;
  nowMs: number;
  onSelectClub: (club: PlayerClubSnapshot) => void;
  selectedClubId?: string;
}) {
  const palette = useMembershipPalette();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const passes = clubs.flatMap((club) => {
    const membership = club.memberships.find((item) => item.clubId === club.club.id && isPlayerMembership(item, player));
    return membership ? [{ club, membership }] : [];
  });
  const passKey = (clubId: string, membershipId: string) => JSON.stringify([player.id, clubId, membershipId]);
  const focusedPass = passes.find(({ club, membership }) => passKey(club.club.id, membership.id) === focusedKey);
  const focusAvailable = Boolean(focusedPass);
  useEffect(() => {
    if (focusedKey && !focusAvailable) setFocusedKey(null);
  }, [focusedKey, focusAvailable]);
  if (!passes.length) return null;
  const visiblePasses = focusedPass ? [focusedPass] : passes;
  return (
    <View style={styles.wallet}>
      {focusedPass ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back to wallet" onPress={() => setFocusedKey(null)} style={styles.walletBack}>
          <Text style={[styles.walletBackText, { color: palette.accent }]}>Back to wallet</Text>
        </Pressable>
      ) : null}
      {visiblePasses.map(({ club, membership }, index) => (
        <Pressable
          key={passKey(club.club.id, membership.id)}
          accessibilityRole="button"
          accessibilityLabel={`${club.club.name}, ${membershipStatus(membership, nowMs)}`}
          accessibilityHint={focusedPass ? 'Open membership details' : 'Show this membership card'}
          accessibilityState={{ selected: Boolean(focusedPass) || club.club.id === selectedClubId, expanded: Boolean(focusedPass) }}
          onPress={() => focusedPass ? onSelectClub(club) : setFocusedKey(passKey(club.club.id, membership.id))}
          style={({ pressed }) => [
            styles.walletCard,
            index > 0 && styles.overlappingCard,
            (focusedPass || club.club.id === selectedClubId) && styles.selectedPass,
            pressed && styles.pressedCard
          ]}
        >
          <MembershipPassCard club={club} membership={membership} player={player} nowMs={nowMs} variant="wallet" />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wallet: { width: '100%', paddingTop: 2, paddingBottom: 4 },
  walletBack: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44, paddingRight: 16, marginBottom: 12 },
  walletBackText: { fontSize: 15, fontWeight: '600' },
  walletCard: { height: CARD_HEIGHT, minHeight: EXPOSED_HEIGHT, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', shadowColor: '#000000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: -4 }, shadowRadius: 10 },
  overlappingCard: { marginTop: -(CARD_HEIGHT - EXPOSED_HEIGHT) },
  selectedPass: { borderColor: '#EBD29B' },
  pressedCard: { opacity: 0.88, transform: [{ scale: 0.992 }] },
  card: { flex: 1, minHeight: CARD_HEIGHT - 2, width: '100%', borderRadius: 21, overflow: 'hidden', backgroundColor: '#101A20' },
  detailCard: { flex: 0, minHeight: 300 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  ornaments: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  insetBorder: { position: 'absolute', top: 9, right: 9, bottom: 9, left: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, opacity: 0.6 },
  outerRing: { position: 'absolute', width: 244, height: 244, borderRadius: 122, borderWidth: 1, right: -81, top: 47, opacity: 0.42 },
  innerRing: { position: 'absolute', width: 204, height: 204, borderRadius: 102, borderWidth: 1, right: -61, top: 67, opacity: 0.4 },
  metalShine: { position: 'absolute', width: 66, height: 520, left: 50, top: -170, backgroundColor: 'rgba(255,255,255,0.035)', transform: [{ rotate: '32deg' }] },
  heading: { paddingHorizontal: 21, paddingTop: 19 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  clubName: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: 0.6, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  detailClubName: { fontSize: 27, lineHeight: 34 },
  diamond: { width: 12, height: 12, marginRight: 3, borderWidth: 1, transform: [{ rotate: '45deg' }] },
  status: { marginTop: 6, fontSize: 9, lineHeight: 13, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase' },
  seal: { position: 'absolute', top: 92, right: 24, width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', opacity: 0.76 },
  sealDiamond: { position: 'absolute', width: 29, height: 29, borderWidth: 1, transform: [{ rotate: '45deg' }] },
  monogram: { fontSize: 17, fontWeight: '500' },
  copy: { position: 'absolute', left: 21, right: 21, bottom: 21 },
  rule: { height: 1, width: '65%', marginBottom: 11 },
  plan: { maxWidth: '82%', fontSize: 11, fontWeight: '700', letterSpacing: 1.7, lineHeight: 17 },
  identityRow: { flexDirection: 'row', gap: 18, marginTop: 17 },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  reference: { alignItems: 'flex-end' },
  label: { fontSize: 8, fontWeight: '600', letterSpacing: 1.2 },
  value: { fontSize: 12, fontWeight: '500', letterSpacing: 0.3, maxWidth: '100%' },
  referenceValue: { textAlign: 'right', fontSize: 10 }
});
