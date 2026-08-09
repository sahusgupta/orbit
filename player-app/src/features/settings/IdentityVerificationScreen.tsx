import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { settingsStyles } from './settingsStyles';

const styles = { ...sharedStyles, ...settingsStyles };

export function IdentityVerificationScreen({
  status,
  signedIn,
  busy,
  message,
  onBack,
  onSignIn,
  onStart,
  onRefresh
}: {
  status: PlayerIdentityStatus;
  signedIn: boolean;
  busy: boolean;
  message: string;
  onBack: () => void;
  onSignIn: () => void;
  onStart: () => void | Promise<void>;
  onRefresh: () => void | Promise<unknown>;
}) {
  const verified = status.ageVerified;
  const processing = status.status === 'processing';
  const underage = status.status === 'underage';
  const primaryLabel = !signedIn
    ? 'Sign in to continue'
    : verified
      ? 'Continue'
      : processing
        ? 'Check status'
        : busy
          ? 'Opening Stripe...'
          : 'Verify with Stripe';
  const primaryAction = !signedIn
    ? onSignIn
    : verified
      ? onBack
      : processing
        ? () => void onRefresh()
        : () => void onStart();

  return (
    <View style={[styles.accountCard, styles.identityCard]}>
      <View style={styles.identityIcon}>
        <Ionicons
          name={verified ? 'checkmark-circle' : underage ? 'alert-circle-outline' : 'shield-checkmark-outline'}
          size={34}
          color={verified ? colors.teal : underage ? '#b42318' : colors.primary}
        />
      </View>
      <View style={styles.identityCopy}>
        <Text style={styles.sectionTitle}>
          {verified ? 'Age verified' : underage ? 'Age requirement not met' : `Verify that you are ${status.minimumAge}+`}
        </Text>
        <Text style={styles.muted}>
          {verified
            ? 'Your age is verified for hosted games, tournament registration, and eligible connected purchases.'
            : underage
              ? `Orbit player access features are limited to verified players age ${status.minimumAge} or older.`
              : 'Card-house membership ID is checked by staff at the door. Stripe verification is only used for hosted games, tournament registration, and eligible connected purchases.'}
        </Text>
      </View>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
      {!underage ? (
        <Pressable
          disabled={busy}
          onPress={primaryAction}
          style={[styles.primaryButton, styles.fullWidthButton, busy && styles.disabledAction]}
        >
          <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
        </Pressable>
      ) : null}
      {signedIn && !verified && !underage && !processing ? (
        <Pressable disabled={busy} onPress={() => void onRefresh()} style={styles.secondaryActionButton}>
          <Text style={styles.secondaryActionText}>I already completed verification</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onBack} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>{verified ? 'Back' : 'Not now'}</Text>
      </Pressable>
      <Text style={styles.identityPrivacy}>
        Your ID images and document details are handled by Stripe Identity and are not stored in Orbit.
      </Text>
    </View>
  );
}
