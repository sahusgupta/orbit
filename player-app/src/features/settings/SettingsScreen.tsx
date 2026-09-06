import { useState, type Dispatch, type SetStateAction } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, Field } from '../../components/PlayerFields';
import { SimpleMenuRow } from '../../components/PlayerPresentation';
import { privacyPolicyUrl, supportUrl, termsOfServiceUrl } from '../../config/playerLinks';
import type { FirebasePlayerIdentity, PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { gamePreferenceOptions } from '../../domain/playerPreferences';
import { e164PhoneExample, e164PhoneRequirement, normalizeE164Phone } from '../../domain/playerPhone';
import type { PlayerAccount } from '../../domain/playerSync';
import { isValidEmail, togglePreferredGame } from '../../domain/discovery';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { OrbitPlayerFaq, OrbitPlayerFooter } from '../home/PlayerLandingExperience';
import { settingsStyles } from './settingsStyles';

const styles = { ...sharedStyles, ...settingsStyles };

export function SettingsScreen({
  firebaseIdentity,
  authStatus,
  playerAuthMethod,
  setPlayerAuthMethod,
  playerAuthEmail,
  setPlayerAuthEmail,
  playerAuthPhone,
  setPlayerAuthPhone,
  playerAuthCode,
  setPlayerAuthCode,
  playerPhoneChallenge,
  playerAuthPassword,
  setPlayerAuthPassword,
  connectPlayerAccount,
  recoverPlayerAccount,
  restartPlayerPhoneSignIn,
  identityStatus,
  profileEditingReady = true,
  showIdentityVerification,
  player,
  setPlayer,
  signOutPlayer,
  deletePlayerAccount
}: {
  firebaseIdentity: FirebasePlayerIdentity | null;
  authStatus: string;
  playerAuthMethod: 'email' | 'phone';
  setPlayerAuthMethod: Dispatch<SetStateAction<'email' | 'phone'>>;
  playerAuthEmail: string;
  setPlayerAuthEmail: Dispatch<SetStateAction<string>>;
  playerAuthPhone: string;
  setPlayerAuthPhone: (phone: string) => void;
  playerAuthCode: string;
  setPlayerAuthCode: Dispatch<SetStateAction<string>>;
  playerPhoneChallenge: boolean;
  playerAuthPassword: string;
  setPlayerAuthPassword: Dispatch<SetStateAction<string>>;
  connectPlayerAccount: () => void;
  recoverPlayerAccount: () => void;
  restartPlayerPhoneSignIn: () => void;
  identityStatus: PlayerIdentityStatus;
  profileEditingReady?: boolean;
  showIdentityVerification: (returnScreen: 'settings') => void;
  player: PlayerAccount;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  signOutPlayer: () => void;
  deletePlayerAccount: () => void;
}) {
  const [touchedAuthFields, setTouchedAuthFields] = useState<Record<string, boolean>>({});
  const emailError = touchedAuthFields.email && !isValidEmail(playerAuthEmail) ? 'Enter a valid email address.' : '';
  const phoneError = touchedAuthFields.phone && !normalizeE164Phone(playerAuthPhone) ? `Enter a valid phone number. ${e164PhoneRequirement}` : '';
  const passwordError = touchedAuthFields.password && playerAuthPassword.length < 12 ? 'Use at least 12 characters.' : '';
  const codeError = touchedAuthFields.code && !/^\d{6}$/.test(playerAuthCode) ? 'Enter the six-digit verification code.' : '';
  const profileEditingDisabled = Boolean(firebaseIdentity) && !profileEditingReady;
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
                onBlur={() => setTouchedAuthFields((current) => ({ ...current, email: true }))}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email address"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Email address"
                accessibilityHint={emailError || undefined}
                style={styles.searchInput}
              />
            </View>
          ) : (
            <View style={styles.searchInputRow}>
              <Ionicons name="call-outline" size={18} color={colors.muted} />
              <TextInput
                value={playerAuthPhone}
                onChangeText={(phone) => setPlayerAuthPhone(normalizeE164Phone(phone) || phone)}
                onBlur={() => setTouchedAuthFields((current) => ({ ...current, phone: true }))}
                keyboardType="phone-pad"
                placeholder={e164PhoneExample}
                placeholderTextColor={colors.muted}
                accessibilityLabel="Phone number"
                accessibilityHint={phoneError || undefined}
                style={styles.searchInput}
              />
            </View>
          )}
          {playerAuthMethod === 'phone' ? <Text style={styles.muted}>{e164PhoneRequirement}</Text> : null}
          {playerAuthMethod === 'email' && emailError ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{emailError}</Text> : null}
          {playerAuthMethod === 'phone' && phoneError ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{phoneError}</Text> : null}
          {playerAuthMethod === 'email' ? (
            <View style={styles.searchInputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.muted} />
              <TextInput
                value={playerAuthPassword}
                onChangeText={setPlayerAuthPassword}
                onBlur={() => setTouchedAuthFields((current) => ({ ...current, password: true }))}
                autoCapitalize="none"
                secureTextEntry
                placeholder="Password or passphrase (12+ characters)"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Password or passphrase"
                accessibilityHint={passwordError || undefined}
                style={styles.searchInput}
              />
            </View>
          ) : playerPhoneChallenge ? (
            <View style={styles.searchInputRow}>
              <Ionicons name="keypad-outline" size={18} color={colors.muted} />
              <TextInput
                value={playerAuthCode}
                onChangeText={setPlayerAuthCode}
                onBlur={() => setTouchedAuthFields((current) => ({ ...current, code: true }))}
                keyboardType="number-pad"
                autoComplete="sms-otp"
                placeholder="One-time SMS code"
                placeholderTextColor={colors.muted}
                accessibilityLabel="One-time SMS code"
                accessibilityHint={codeError || undefined}
                style={styles.searchInput}
              />
            </View>
          ) : null}
          {playerAuthMethod === 'email' && passwordError ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{passwordError}</Text> : null}
          {playerAuthMethod === 'phone' && playerPhoneChallenge && codeError ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{codeError}</Text> : null}
          <Pressable style={styles.compactButton} onPress={connectPlayerAccount}>
            <Text style={styles.compactButtonText}>
              {playerAuthMethod === 'phone'
                ? playerPhoneChallenge ? 'Verify code and sign in' : 'Send verification code'
                : 'Sign in or create account'}
            </Text>
          </Pressable>
          {playerAuthMethod === 'email' ? (
            <Pressable style={styles.secondaryActionButton} onPress={recoverPlayerAccount}>
              <Text style={styles.secondaryActionText}>Forgot password</Text>
            </Pressable>
          ) : playerPhoneChallenge ? (
            <Pressable style={styles.secondaryActionButton} onPress={restartPlayerPhoneSignIn}>
              <Text style={styles.secondaryActionText}>Send a new code</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.googleAuthPanel}>
          <View style={styles.googleAuthIcon}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.teal} />
          </View>
          <View style={styles.googleAuthBody}>
            <Text style={styles.cardTitle}>Account connected</Text>
            <Text style={styles.muted}>{firebaseIdentity.provider === 'phone' ? 'Sign-in phone' : 'Sign-in email'}</Text>
            <Text style={styles.muted}>{firebaseIdentity.provider === 'phone' ? firebaseIdentity.phone : firebaseIdentity.email}</Text>
          </View>
        </View>
      )}
      <SimpleMenuRow
        icon="shield-checkmark-outline"
        title="Identity & age"
        subtitle={getIdentityStatusLabel(identityStatus, Boolean(firebaseIdentity))}
        onPress={() => showIdentityVerification('settings')}
      />
      {profileEditingDisabled ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Restoring your signed-in profile</Text>
          <Text style={styles.muted}>Profile editing will be available after Orbit confirms the current account's saved profile.</Text>
        </View>
      ) : null}
      <Field editable={!profileEditingDisabled} label="Name" value={player.name} onChangeText={(name) => setPlayer((current) => ({ ...current, name }))} />
      {!firebaseIdentity ? (
        <>
          <Field label="Email address" keyboardType="email-address" value={player.email} onChangeText={(email) => setPlayer((current) => ({ ...current, email }))} />
          <Field
            label="Phone number"
            keyboardType="phone-pad"
            placeholder={e164PhoneExample}
            value={player.phone ?? ''}
            onChangeText={(phone) => setPlayer((current) => ({ ...current, phone: normalizeE164Phone(phone) || phone }))}
            error={(player.phone ?? '').trim() && !normalizeE164Phone(player.phone) ? `Enter a valid phone number. ${e164PhoneRequirement}` : ''}
          />
        </>
      ) : null}
      <Field
        editable={!profileEditingDisabled}
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
            disabled={profileEditingDisabled}
            onPress={() => setPlayer((current) => togglePreferredGame(current, game.id))}
          />
        ))}
      </View>
      <Field
        editable={!profileEditingDisabled}
        label="Preferred stakes"
        value={player.preferredStakes ?? ''}
        onChangeText={(preferredStakes) => setPlayer((current) => ({ ...current, preferredStakes }))}
      />
      <Field
        editable={!profileEditingDisabled}
        label="Typical availability"
        value={player.typicalAvailability ?? ''}
        placeholder="Evenings, weekends, after 6 PM..."
        onChangeText={(typicalAvailability) => setPlayer((current) => ({ ...current, typicalAvailability }))}
      />
      <View style={styles.simpleMenu}>
        <SimpleMenuRow icon="help-circle-outline" title="Support" subtitle="Help and contact options" onPress={() => Linking.openURL(supportUrl)} />
        <SimpleMenuRow icon="shield-checkmark-outline" title="Privacy Policy" subtitle="Legal" onPress={() => Linking.openURL(privacyPolicyUrl)} />
        <SimpleMenuRow icon="document-text-outline" title="Terms of Service" subtitle="Legal" onPress={() => Linking.openURL(termsOfServiceUrl)} />
      </View>
      <OrbitPlayerFaq />
      <OrbitPlayerFooter />
      {firebaseIdentity ? (
          <Pressable style={styles.secondaryActionButton} onPress={signOutPlayer}>
            <Text style={styles.secondaryActionText}>Sign out</Text>
          </Pressable>
      ) : null}
      <Pressable style={styles.secondaryActionButton} onPress={deletePlayerAccount}>
        <Text style={[styles.secondaryActionText, { color: '#b42318' }]}>{firebaseIdentity ? 'Delete account' : 'Delete local profile and data'}</Text>
      </Pressable>
    </View>
  );
}

export function getIdentityStatusLabel(status: PlayerIdentityStatus, signedIn: boolean) {
  if (!signedIn) return 'Not signed in';
  if (status.ageVerified) return `Verified ${status.minimumAge}+`;
  if (status.status === 'provisional' && status.ageEligible) return 'ID review pending';
  if (status.status === 'processing') return 'Verification pending';
  if (status.status === 'underage') return `Minimum age ${status.minimumAge}`;
  return 'Not verified';
}
