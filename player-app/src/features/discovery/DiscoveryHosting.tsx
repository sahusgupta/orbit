import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Field } from '../../components/PlayerFields';
import { AnimatedButton, AnimatedSurface } from '../../components/PlayerPresentation';
import { privacyPolicyUrl, termsOfServiceUrl } from '../../config/playerLinks';
import type { PlayerPrivateGameListing } from '../../domain/playerSync';
import type { PrivateGameDraft } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function PremiumPaywall({
  title,
  body,
  priceLabel,
  message,
  onUpgrade
}: {
  title: string;
  body: string;
  priceLabel: string;
  message?: string;
  onUpgrade: () => void;
}) {
  return (
    <AnimatedSurface style={styles.paywallPanel}>
      <View style={styles.paywallHeader}>
        <View style={styles.paywallIcon}>
          <Ionicons name="diamond-outline" size={21} color={colors.teal} />
        </View>
        <View style={styles.agentCopy}>
          <Text style={styles.agentKicker}>Player Premium</Text>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.muted}>{body}</Text>
        </View>
      </View>
      <View style={styles.priceRow}>
        <Text style={styles.priceText}>{priceLabel}</Text>
        <Text style={styles.muted}>monthly membership</Text>
      </View>
      <AnimatedButton variant="primary" onPress={onUpgrade} style={[styles.primaryButton, styles.fullWidthButton]}>
        <Ionicons name="card-outline" size={18} color="#fff" />
        <Text style={styles.primaryButtonText}>Subscribe with Apple</Text>
      </AnimatedButton>
      <Text style={styles.muted}>
        Payment is charged to your Apple Account. The subscription renews monthly unless canceled at least 24 hours before the current period ends. Manage or cancel it in your Apple subscription settings.
      </Text>
      <View style={styles.contextRow}>
        <Pressable onPress={() => Linking.openURL(termsOfServiceUrl)}>
          <Text style={styles.inlineBackText}>Orbit Terms</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL(privacyPolicyUrl)}>
          <Text style={styles.inlineBackText}>Privacy Policy</Text>
        </Pressable>
        <Pressable onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}>
          <Text style={styles.inlineBackText}>Apple EULA</Text>
        </Pressable>
      </View>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </AnimatedSurface>
  );
}

export function HostControlPanel({ playerName, hostedCount }: { playerName: string; hostedCount: number }) {
  return (
    <AnimatedSurface style={styles.agentPanel}>
      <View style={styles.agentHeader}>
        <View style={styles.agentIcon}>
          <Ionicons name="home-outline" size={20} color={colors.teal} />
        </View>
        <View style={styles.agentCopy}>
          <Text style={styles.agentKicker}>Player-hosted games</Text>
          <Text style={styles.cardTitle}>{playerName ? `${playerName}'s host board` : 'Host board'}</Text>
          <Text style={styles.muted}>Create a table, set the seat count, and publish it into the grinder feed.</Text>
        </View>
      </View>
      <View style={styles.contextRow}>
        <View style={styles.contextChip}>
          <Ionicons name="radio-outline" size={13} color={colors.primary} />
          <Text style={styles.contextText}>{hostedCount} live posts</Text>
        </View>
        <View style={styles.contextChip}>
          <Ionicons name="people-outline" size={13} color={colors.primary} />
          <Text style={styles.contextText}>Seats shown to players</Text>
        </View>
      </View>
    </AnimatedSurface>
  );
}

export function PrivateGameComposer({
  draft,
  setDraft,
  onPublish
}: {
  draft: PrivateGameDraft;
  setDraft: React.Dispatch<React.SetStateAction<PrivateGameDraft>>;
  onPublish: () => void;
}) {
  const canPublish = Boolean(draft.name.trim() && draft.location.trim());
  return (
    <AnimatedSurface style={styles.privateGameComposer}>
      <Field label="Game" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} />
      <Field label="Location" value={draft.location} onChangeText={(location) => setDraft((current) => ({ ...current, location }))} />
      <View style={styles.composerGrid}>
        <Field label="When" value={draft.startsAt} onChangeText={(startsAt) => setDraft((current) => ({ ...current, startsAt }))} />
        <Field label="Seats" value={draft.seats} onChangeText={(seats) => setDraft((current) => ({ ...current, seats }))} />
      </View>
      <Field label="Note" value={draft.note} onChangeText={(note) => setDraft((current) => ({ ...current, note }))} />
      <Pressable disabled={!canPublish} onPress={onPublish} style={[styles.publishPrivateGame, !canPublish && styles.publishPrivateGameDisabled]}>
        <Text style={styles.publishPrivateGameText}>List private game</Text>
        <Ionicons name="arrow-forward" size={17} color={canPublish ? '#ffffff' : 'rgba(255,255,255,0.65)'} />
      </Pressable>
    </AnimatedSurface>
  );
}

export function PrivateGameCard({ game }: { game: PlayerPrivateGameListing }) {
  return (
    <AnimatedSurface style={[styles.gameCard, styles.privateGameCard]}>
      <View style={styles.gameHeader}>
        <View style={styles.privateGameMarker}>
          <View style={styles.privateGameMarkerInner} />
        </View>
        <View style={styles.gameTitleBlock}>
          <Text style={styles.cardTitle}>{game.name}</Text>
          <Text style={styles.muted}>{game.location} / {game.startsAt || 'Tonight'} / {game.seats || '6'} seats</Text>
        </View>
        <View style={styles.privateBadge}>
          <Text style={styles.privateBadgeText}>Private</Text>
        </View>
      </View>
      <Text style={styles.muted}>{game.note || `Hosted by ${game.hostPlayerName}`}</Text>
    </AnimatedSurface>
  );
}
