import type { Dispatch, SetStateAction } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, Field } from '../../components/PlayerFields';
import { SimpleMenuRow } from '../../components/PlayerPresentation';
import { privacyPolicyUrl, termsOfServiceUrl } from '../../config/playerLinks';
import type { PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { gamePreferenceOptions } from '../../domain/playerPreferences';
import type { PlayerAccount } from '../../domain/playerSync';
import { togglePreferredGame } from '../../domain/discovery';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { settingsStyles } from './settingsStyles';

const styles = { ...sharedStyles, ...settingsStyles };
const supportPhone = '346-434-1402';
const supportPhoneUrl = 'tel:+13464341402';

export function SettingsScreen({
  firebaseIdentity,
  authStatus,
  playerAuthMethod,
  setPlayerAuthMethod,
  playerAuthEmail,
  setPlayerAuthEmail,
  playerAuthPhone,
  setPlayerAuthPhone,
  playerAuthPassword,
  setPlayerAuthPassword,
  connectPlayerAccount,
  identityStatus,
  showIdentityVerification,
  playerPremiumEnabled,
  hasPlayerPremium,
  premiumMonthlyPriceLabel,
  premiumMessage,
  openPremiumCheckout,
  restorePremiumPurchases,
  player,
  setPlayer,
  signOutPlayer,
  deletePlayerAccount
}: {
  firebaseIdentity: object | null;
  authStatus: string;
  playerAuthMethod: 'email' | 'phone';
  setPlayerAuthMethod: Dispatch<SetStateAction<'email' | 'phone'>>;
  playerAuthEmail: string;
  setPlayerAuthEmail: Dispatch<SetStateAction<string>>;
  playerAuthPhone: string;
  setPlayerAuthPhone: Dispatch<SetStateAction<string>>;
  playerAuthPassword: string;
  setPlayerAuthPassword: Dispatch<SetStateAction<string>>;
  connectPlayerAccount: () => void;
  identityStatus: PlayerIdentityStatus;
  showIdentityVerification: (returnScreen: 'settings') => void;
  playerPremiumEnabled: boolean;
  hasPlayerPremium: boolean;
  premiumMonthlyPriceLabel: string;
  premiumMessage: string;
  openPremiumCheckout: () => void;
  restorePremiumPurchases: () => void;
  player: PlayerAccount;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  signOutPlayer: () => void;
  deletePlayerAccount: () => void;
}) {
  return (
    <View style={styles.accountCard}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Profile & settings</Text>
          <Text style={styles.muted}>Keep your account and poker preferences current.</Text>
        </View>
      </View>
      {!firebaseIdentity ? (
        <View style={styles.emailAuthPanel}>
          <Text style={styles.cardTitle}>Account access</Text>
          <Text style={styles.muted}>{authStatus}</Text>
          <View style={styles.chipRow}>
            <Chip label="Email address" active={playerAuthMethod === 'email'} onPress={() => setPlayerAuthMethod('email')} />
            <Chip label="Phone number" active={playerAuthMethod === 'phone'} onPress={() => setPlayerAuthMethod('phone')} />
          </View>
          {playerAuthMethod === 'email' ? (
            <View style={styles.searchInputRow}>
              <Ionicons name="mail-outline" size={18} color={colors.muted} />
              <TextInput
                value={playerAuthEmail}
                onChangeText={setPlayerAuthEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
              />
            </View>
          ) : (
            <View style={styles.searchInputRow}>
              <Ionicons name="call-outline" size={18} color={colors.muted} />
              <TextInput
                value={playerAuthPhone}
                onChangeText={setPlayerAuthPhone}
                keyboardType="phone-pad"
                placeholder="Phone number"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
              />
            </View>
          )}
          <View style={styles.searchInputRow}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
            <TextInput
              value={playerAuthPassword}
              onChangeText={setPlayerAuthPassword}
              autoCapitalize="none"
              secureTextEntry
              placeholder="Password (6+ characters)"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
            />
          </View>
          <Pressable style={styles.compactButton} onPress={connectPlayerAccount}>
            <Text style={styles.compactButtonText}>Sign in or create account</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.googleAuthPanel}>
          <View style={styles.googleAuthIcon}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.teal} />
          </View>
          <View style={styles.googleAuthBody}>
            <Text style={styles.cardTitle}>Account connected</Text>
            <Text style={styles.muted}>{player.phone || player.email}</Text>
          </View>
        </View>
      )}
      <SimpleMenuRow
        icon="shield-checkmark-outline"
        title="Identity & age"
        subtitle={getIdentityStatusLabel(identityStatus, Boolean(firebaseIdentity))}
        onPress={() => showIdentityVerification('settings')}
      />
      {playerPremiumEnabled ? (
        <>
          <View style={styles.googleAuthPanel}>
            <View style={styles.googleAuthIcon}>
              <Ionicons name={hasPlayerPremium ? 'diamond' : 'diamond-outline'} size={20} color={hasPlayerPremium ? colors.teal : colors.primaryDark} />
            </View>
            <View style={styles.googleAuthBody}>
              <Text style={styles.cardTitle}>{hasPlayerPremium ? 'Player Premium Active' : `Player Premium ${premiumMonthlyPriceLabel}`}</Text>
            </View>
            {!hasPlayerPremium ? (
              <Pressable style={styles.compactButton} onPress={openPremiumCheckout}>
                <Text style={styles.compactButtonText}>Upgrade</Text>
              </Pressable>
            ) : null}
          </View>
          {premiumMessage ? <Text style={styles.privateGameStatus}>{premiumMessage}</Text> : null}
          <Pressable style={styles.secondaryActionButton} onPress={restorePremiumPurchases}>
            <Text style={styles.secondaryActionText}>Restore Apple purchases</Text>
          </Pressable>
        </>
      ) : null}
      <Field label="Name" value={player.name} onChangeText={(name) => setPlayer((current) => ({ ...current, name }))} />
      <Field label="Email address" keyboardType="email-address" value={player.email} onChangeText={(email) => setPlayer((current) => ({ ...current, email }))} />
      <Field label="Phone number" keyboardType="phone-pad" value={player.phone ?? ''} onChangeText={(phone) => setPlayer((current) => ({ ...current, phone }))} />
      <Field
        label="Home area"
        value={player.homeLocation ?? ''}
        onChangeText={(homeLocation) => setPlayer((current) => ({ ...current, homeLocation }))}
      />
      <Text style={styles.fieldLabel}>Preferred games</Text>
      <View style={styles.chipRow}>
        {gamePreferenceOptions.map((game) => (
          <Chip
            key={game.id}
            label={game.label}
            active={player.preferredGameIds.includes(game.id)}
            onPress={() => setPlayer((current) => togglePreferredGame(current, game.id))}
          />
        ))}
      </View>
      <Field
        label="Preferred stakes"
        value={player.preferredStakes ?? ''}
        onChangeText={(preferredStakes) => setPlayer((current) => ({ ...current, preferredStakes }))}
      />
      <Field
        label="Typical availability"
        value={player.typicalAvailability ?? ''}
        placeholder="Evenings, weekends, after 6 PM..."
        onChangeText={(typicalAvailability) => setPlayer((current) => ({ ...current, typicalAvailability }))}
      />
      <View style={styles.simpleMenu}>
        <SimpleMenuRow icon="call-outline" title="Support" subtitle={supportPhone} onPress={() => Linking.openURL(supportPhoneUrl)} />
        <SimpleMenuRow icon="shield-checkmark-outline" title="Privacy Policy" subtitle="Legal" onPress={() => Linking.openURL(privacyPolicyUrl)} />
        <SimpleMenuRow icon="document-text-outline" title="Terms of Service" subtitle="Legal" onPress={() => Linking.openURL(termsOfServiceUrl)} />
      </View>
      {firebaseIdentity ? (
        <>
          <Pressable style={styles.secondaryActionButton} onPress={signOutPlayer}>
            <Text style={styles.secondaryActionText}>Sign out</Text>
          </Pressable>
          <Pressable style={styles.secondaryActionButton} onPress={deletePlayerAccount}>
            <Text style={[styles.secondaryActionText, { color: '#b42318' }]}>Delete account</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

export function getIdentityStatusLabel(status: PlayerIdentityStatus, signedIn: boolean) {
  if (!signedIn) return 'Not signed in';
  if (status.ageVerified) return `Verified ${status.minimumAge}+`;
  if (status.status === 'processing') return 'Verification pending';
  if (status.status === 'underage') return `Minimum age ${status.minimumAge}`;
  return 'Not verified';
}
