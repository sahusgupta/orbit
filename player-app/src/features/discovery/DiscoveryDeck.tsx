import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, Text, View, type DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getClubCity,
  getGameStatusLabel,
  getOpportunityKey,
  getOpportunityLabel,
  getVenueKind
} from '../../domain/discovery';
import { formatDropFee, getClubFeeProfile } from '../../domain/clubAccess';
import type { DiscoveryDecision, GameOpportunity } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

type DiscoveryAccent = { color: string; background: string };

export function DiscoveryDeck({
  opportunities,
  totalCount,
  savedCount,
  onPass,
  onPick,
  onDetails,
  onReset
}: {
  opportunities: GameOpportunity[];
  totalCount: number;
  savedCount: number;
  onPass: (item: GameOpportunity) => void;
  onPick: (item: GameOpportunity) => void;
  onDetails: (item: GameOpportunity) => void;
  onReset: () => void;
}) {
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const item = opportunities[0];
  const nextItem = opportunities[1];
  const itemKey = item ? getOpportunityKey(item) : '';
  useEffect(() => {
    swipeX.setValue(0);
    swipeY.setValue(0);
    animating.current = false;
  }, [itemKey, swipeX, swipeY]);
  const swipe = (decision: DiscoveryDecision) => {
    if (!item || animating.current) return;
    animating.current = true;
    Animated.parallel([
      Animated.timing(swipeX, {
        toValue: decision === 'saved' ? 560 : -560,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }),
      Animated.timing(swipeY, {
        toValue: -18,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      })
    ]).start(() => {
      swipeX.setValue(0);
      swipeY.setValue(0);
      animating.current = false;
      decision === 'saved' ? onPick(item) : onPass(item);
    });
  };
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Boolean(item && Math.abs(gesture.dx) > 5 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.05),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        swipeX.setValue(gesture.dx);
        swipeY.setValue(gesture.dy * 0.12);
      },
      onPanResponderRelease: (_, gesture) => {
        const projectedX = gesture.dx + gesture.vx * 90;
        if (projectedX > 68) swipe('saved');
        else if (projectedX < -68) swipe('pass');
        else Animated.parallel([
          Animated.spring(swipeX, { toValue: 0, friction: 7, tension: 115, useNativeDriver: false }),
          Animated.spring(swipeY, { toValue: 0, friction: 7, tension: 115, useNativeDriver: false })
        ]).start();
      },
      onPanResponderTerminate: () => Animated.parallel([
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: false }),
        Animated.spring(swipeY, { toValue: 0, useNativeDriver: false })
      ]).start()
    }),
    [item, onPass, onPick]
  );
  const rotation = swipeX.interpolate({ inputRange: [-320, 0, 320], outputRange: ['-7deg', '0deg', '7deg'] });
  const likeOpacity = swipeX.interpolate({ inputRange: [0, 48, 135], outputRange: [0, 0.4, 0.9], extrapolate: 'clamp' });
  const passOpacity = swipeX.interpolate({ inputRange: [-135, -48, 0], outputRange: [0.9, 0.4, 0], extrapolate: 'clamp' });
  const seenCount = Math.max(0, totalCount - opportunities.length);

  if (!item) {
    return (
      <View style={styles.discoveryEmpty}>
        <View style={styles.discoveryEmptyIcon}>
          <Ionicons name="checkmark-done-outline" size={30} color={colors.teal} />
        </View>
        <Text style={styles.discoveryEmptyTitle}>You’ve reviewed every available game</Text>
        <Text style={styles.muted}>{savedCount ? `${savedCount} saved game${savedCount === 1 ? '' : 's'} are waiting below.` : 'Refresh the deck or loosen your filters to see more games.'}</Text>
        <Pressable accessibilityLabel="Refresh discovery deck" accessibilityRole="button" onPress={onReset} style={styles.discoveryResetButton}>
          <Ionicons name="refresh-outline" size={17} color="#ffffff" />
          <Text style={styles.discoveryResetText}>Start over</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.discoveryDeckSection}>
      <View style={styles.discoveryProgressRow}>
        <Text style={styles.discoveryProgressText}>{seenCount + 1} of {totalCount}</Text>
        <View style={styles.discoveryProgressTrack}>
          <View style={[styles.discoveryProgressFill, { width: `${Math.max(6, ((seenCount + 1) / Math.max(1, totalCount)) * 100)}%` as DimensionValue }]} />
        </View>
        <Text style={styles.discoverySavedCount}>{savedCount} saved</Text>
      </View>
      <View style={styles.discoveryDeck}>
        {nextItem ? (
          <View pointerEvents="none" style={[styles.discoveryCard, styles.discoveryCardBehind]}>
            <DiscoveryCardContent item={nextItem} compact />
          </View>
        ) : null}
        <Animated.View
          {...panResponder.panHandlers}
          style={[styles.discoveryCard, styles.discoveryCardTop, { transform: [{ translateX: swipeX }, { translateY: swipeY }, { rotate: rotation }] }]}
        >
          <Animated.View pointerEvents="none" style={[styles.swipeFeedback, styles.swipeFeedbackPass, { opacity: passOpacity }]}>
            <View style={[styles.swipeStamp, styles.swipeStampPass]}>
              <Text style={[styles.swipeStampText, styles.swipeStampTextPass]}>PASS</Text>
            </View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.swipeFeedback, styles.swipeFeedbackPick, { opacity: likeOpacity }]}>
            <View style={[styles.swipeStamp, styles.swipeStampPick]}>
              <Text style={[styles.swipeStampText, styles.swipeStampTextPick]}>SAVE</Text>
            </View>
          </Animated.View>
          <DiscoveryCardContent item={item} onDetails={() => onDetails(item)} onPass={() => swipe('pass')} onPick={() => swipe('saved')} />
        </Animated.View>
      </View>
    </View>
  );
}

export function DiscoveryCardContent({
  item,
  compact = false,
  onDetails,
  onPass,
  onPick
}: {
  item: GameOpportunity;
  compact?: boolean;
  onDetails?: () => void;
  onPass?: () => void;
  onPick?: () => void;
}) {
  const status = getGameStatusLabel(item.game);
  const venueKind = getVenueKind(item.club);
  const fee = getClubFeeProfile(item.club, item.game);
  const accent = getDiscoveryAccent(item);
  return (
    <>
      <AnimatedDiscoveryCardBackground accent={accent} />
      <View style={[styles.discoveryCardHero, compact && styles.discoveryCardHeroCompact]}>
        <View pointerEvents="none" style={[styles.discoveryAccentGlow, { backgroundColor: accent.color }]} />
        <View style={styles.discoveryCardHeroTop}>
          <View style={styles.venueTypeBadge}>
            <Ionicons name={venueKind === 'Card house' ? 'business-outline' : venueKind === 'Casino' ? 'diamond-outline' : 'people-outline'} size={13} color="#ffffff" />
            <Text style={styles.venueTypeText}>{venueKind}</Text>
          </View>
          <View style={[styles.compatibilityBadge, { borderColor: `${accent.color}55` }]}>
            <Text style={[styles.compatibilityValue, { color: accent.color }]}>{getOpportunityLabel(item)}</Text>
            <Text style={styles.compatibilityLabel}>WHY SHOWN</Text>
          </View>
        </View>
        <View style={styles.discoveryHeroBottom}>
          <View style={styles.liveStatusRow}>
            <View style={[styles.liveDot, !item.game.availableSeats && styles.liveDotWarm]} />
            <Text style={styles.liveStatusText}>{status}</Text>
          </View>
          <Text style={[styles.discoveryGameTitle, { color: accent.color, textShadowColor: `${accent.color}66` }]}>{item.game.name}</Text>
          <Text style={styles.discoveryClubName}>{item.club.club.name}</Text>
          <Text style={styles.discoveryLocation}>{getClubCity(item.club)} · {item.distanceMiles.toFixed(1)} mi away</Text>
        </View>
      </View>
      {!compact ? (
        <View style={styles.discoveryCardBody}>
          <View style={styles.discoveryMetrics}>
            {[
              { label: 'Seats', value: item.game.availableSeats || 'Not listed' },
              { label: 'Playing', value: item.game.knownPlayersCount || 'Not listed' },
              { label: 'Waitlist', value: item.game.waitlistCount || 'Not listed' }
            ].map((metric) => (
              <View key={metric.label} style={styles.discoveryMetric}>
                <Text style={styles.discoveryMetricValue}>{metric.value}</Text>
                <Text style={styles.discoveryMetricLabel}>{metric.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.discoveryBuyInRow}>
            <Text style={styles.discoveryBuyInLabel}>{fee.type === 'time' ? 'TIME' : 'DROP'}</Text>
            <Text style={styles.discoveryBuyInValue}>{fee.type === 'time' ? fee.hourly : formatDropFee(fee.percent)}</Text>
          </View>
          {onDetails ? (
            <View style={styles.cardSelectionRow}>
              <Pressable accessibilityLabel={`Pass on ${item.game.name}`} accessibilityRole="button" onPress={onPass} style={[styles.cardCornerAction, styles.cardRejectAction]}>
                <Ionicons name="close" size={29} color="#dc2626" />
              </Pressable>
              <Pressable accessibilityLabel={`Save ${item.game.name}`} accessibilityRole="button" onPress={onPick} style={[styles.cardCornerAction, styles.cardPickAction]}>
                <Ionicons name="heart" size={29} color="#ffffff" />
              </Pressable>
              <Pressable accessibilityLabel={`See full details for ${item.game.name}`} accessibilityRole="button" onPress={onDetails} style={[styles.cardCornerAction, styles.cardDetailsAction]}>
                <Ionicons name="location" size={24} color="#6f91ff" />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

export function AnimatedDiscoveryCardBackground({ accent }: { accent: DiscoveryAccent }) {
  return (
    <View pointerEvents="none" style={[styles.discoveryAnimatedBackground, { backgroundColor: accent.background }]} />
  );
}

export function getDiscoveryAccent(item: GameOpportunity): DiscoveryAccent {
  const seed = `${item.game.name} ${item.club.club.name}`.toLowerCase();
  if (seed.includes('plo') || seed.includes('omaha')) {
    return { color: '#2DD4BF', background: '#0B2F32' };
  }
  if (item.game.availableSeats > 3) {
    return { color: '#25D99A', background: '#0B3528' };
  }
  return { color: '#5B86FF', background: '#102C65' };
}

export function SavedGamesStrip({ opportunities, onOpen }: { opportunities: GameOpportunity[]; onOpen: (item: GameOpportunity) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.savedGamesSection}>
      <Pressable accessibilityLabel="Saved games" accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={styles.savedGamesHeader}>
        <View>
          <Text style={styles.sectionTitle}>Saved games</Text>
          <Text style={styles.muted}>{opportunities.length} saved</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={19} color={colors.muted} />
      </Pressable>
      {expanded ? opportunities.map((item) => (
        <Pressable key={getOpportunityKey(item)} onPress={() => onOpen(item)} style={styles.savedGameRow}>
          <View style={styles.savedGameScore}>
            <Text style={styles.savedGameScoreValue}>{item.game.availableSeats ? `${item.game.availableSeats} open` : 'Saved'}</Text>
          </View>
          <View style={styles.savedGameCopy}>
            <Text style={styles.cardTitle}>{item.game.name} · {item.club.club.name}</Text>
            <Text style={styles.muted}>{getGameStatusLabel(item.game)} · {item.distanceMiles.toFixed(1)} mi · Alerts after joining</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
      )) : null}
    </View>
  );
}
