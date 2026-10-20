import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { connectionErrorCopy } from '../../components/PlayerPresentation';
import { getClubCity, getGameStatusLabel, getPublishedAvailabilityLabel, getRunningAvailableSeats } from '../../domain/discovery';
import { getClubFeeProfile } from '../../domain/clubAccess';
import {
  matchReferenceKey,
  defaultMatchPreferences,
  type MatchCandidate,
  type MatchDecision,
  type MatchPreferences,
  type MatchVariant,
  type RankedMatchCandidate,
  type SavedMatchGame
} from '../../domain/orbitMatchTypes';
import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import { orbitMatchStyles as baseStyles } from './orbitMatchStyles';

export type OrbitMatchScreenProps = {
  mode?: MatchMode;
  onModeChange?: (mode: MatchMode) => void;
  candidates: RankedMatchCandidate[];
  savedGames: SavedMatchGame[];
  inventoryStatus: 'idle' | 'loading' | 'ready' | 'error';
  inventoryPartial: boolean;
  storageReady: boolean;
  pending: boolean;
  error: string;
  canUndo: boolean;
  preferences: MatchPreferences;
  preferencesRevision?: number;
  clubs: { id: string; name: string }[];
  onDecision: (candidate: RankedMatchCandidate, decision: 'saved' | 'passed') => void;
  onUndo: () => void;
  onRemoveSaved: (record: MatchDecision) => void;
  onDetails: (candidate: MatchCandidate, source: 'deck' | 'saved') => void;
  onPreferences: (preferences: MatchPreferences, basePreferencesRevision?: number) => Promise<boolean> | boolean | void;
  onRetry: () => void;
  originLabel?: string | null;
  onSelectOrigin?: () => void;
  onClearOrigin?: () => void;
  timeZone?: string;
  onBack?: () => void;
  onSearch?: () => void;
  onFilters?: () => void;
  searchActive?: boolean;
  deviceScope?: boolean;
  minimumHeight?: number;
};

export type MatchMode = 'discover' | 'saved' | 'preferences';

export function OrbitMatchScreen(props: OrbitMatchScreenProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const [internalMode, setInternalMode] = useState<MatchMode>('discover');
  const mode = props.mode ?? internalMode;
  const modeGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; modeGeneration.current += 1; }; }, []);
  useEffect(() => { modeGeneration.current += 1; }, [mode]);
  const setMode = (next: MatchMode) => { modeGeneration.current += 1; setInternalMode(next); props.onModeChange?.(next); };
  const writable = props.storageReady && !props.pending;
  const live = props.inventoryStatus === 'ready';
  const overlayToolbar = mode === 'discover' && props.candidates.length > 0 && live && props.storageReady && !props.error && !props.pending && !props.inventoryPartial;
  return (
    <View style={[styles.screen, { minHeight: props.minimumHeight }]}>
      <View style={[styles.header, overlayToolbar && styles.deckToolbar]}>
        {props.onBack ? <Control label="Back to Games" onPress={props.onBack} icon="chevron-back" iconOnly /> : null}
        <View accessible accessibilityRole="header" accessibilityLabel="Orbit Match" style={styles.accessibleHeading} />
      <View accessibilityRole="tablist" accessibilityLabel="Orbit Match modes" style={styles.tabs}>
        {(['discover', 'saved'] as const).map((value) => (
          <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'saved' ? `Saved games, ${props.savedGames.length}` : 'Discover games'}
            accessibilityState={{ selected: mode === value }} aria-selected={mode === value} onPress={() => setMode(value)} style={[styles.tab, mode === value && styles.tabActive]}>
            <Ionicons name={value === 'discover' ? 'compass-outline' : 'heart-outline'} size={22} color={mode === value ? colors.ink : colors.muted} />
            {value === 'saved' && props.savedGames.length > 0 ? <Text style={[styles.tabText, mode === value && styles.tabTextActive]}>{props.savedGames.length}</Text> : null}
          </Pressable>
        ))}
      </View>
        {mode === 'discover' ? <Control label="Undo last swipe" onPress={props.onUndo} disabled={!writable || !props.canUndo} icon="arrow-undo-outline" iconOnly /> : null}
        {props.onSearch ? <Control label="Search games" onPress={props.onSearch} icon="search-outline" iconOnly primary={props.searchActive} selected={props.searchActive} /> : null}
        {props.onFilters ? <Control label="Show game filters" onPress={props.onFilters} icon="options-outline" iconOnly /> : null}
      </View>
      {!props.storageReady ? <View accessibilityRole="progressbar" accessibilityLabel="Restoring Match preferences and saved games" style={styles.notice}>
        <Text style={styles.copy}>Restoring your preferences and saved games…</Text>
      </View> : null}
      {props.error ? <View accessibilityRole="alert" style={styles.notice}>
        <Text style={styles.error}>{connectionErrorCopy(props.error, 'Match')}</Text>
        <Control label="Retry Match" onPress={props.onRetry} />
      </View> : null}
      {mode === 'discover' ? (
        <>
          {props.pending || props.inventoryPartial ? <Text accessibilityLiveRegion="polite" style={styles.copy}>{props.pending ? 'Saving your changes…' : 'Showing loaded games'}</Text> : null}
          {!live && props.candidates.length ? <Text accessibilityRole="alert" style={styles.copy}>Last loaded games. Refresh before saving or passing.</Text> : null}
          {props.candidates.length ? <MatchDeck candidates={props.candidates} disabled={!writable || !live} pending={props.pending} error={props.error}
            lastLoaded={!live} toolbarOverlay={overlayToolbar} onDecision={props.onDecision} onDetails={(item) => props.onDetails(item, 'deck')} /> : (
            <View accessibilityRole={props.inventoryStatus === 'loading' || props.inventoryStatus === 'idle' ? 'progressbar' : undefined}
              accessibilityLabel={props.inventoryStatus === 'loading' || props.inventoryStatus === 'idle' ? 'Loading Match games' : undefined} style={styles.notice}>
              <Text style={styles.sectionTitle}>{props.inventoryStatus === 'loading' || props.inventoryStatus === 'idle' ? 'Loading published games' : props.inventoryStatus === 'error' ? 'Games could not be refreshed' : props.inventoryPartial ? 'More games may be available' : 'No more matching games'}</Text>
              <Text style={styles.copy}>{props.inventoryStatus === 'error' ? 'Your saved games remain available. Retry when your connection returns.' : props.inventoryPartial ? 'Refresh to check for additional published games.' : 'Adjust your preferences or review your saved games. Excluded venues and strict limits stay in place.'}</Text>
              <Control label="Edit Match preferences" onPress={() => setMode('preferences')} />
              <Control label="Refresh Match games" onPress={props.onRetry} />
            </View>
          )}
        </>
      ) : mode === 'saved' ? <SavedGames games={props.savedGames} writable={writable} live={live} onRemove={props.onRemoveSaved} onDetails={(item) => props.onDetails(item, 'saved')} /> : (
        <View style={styles.form}><MatchPreferencesForm preferences={props.preferences} preferencesRevision={props.preferencesRevision} clubs={props.clubs} disabled={!writable} originLabel={props.originLabel}
          onSelectOrigin={props.onSelectOrigin} onClearOrigin={props.onClearOrigin} timeZone={props.timeZone} onSave={async (preferences, baseRevision) => {
            const expectedGeneration = modeGeneration.current;
            const accepted = await (baseRevision === undefined ? props.onPreferences(preferences) : props.onPreferences(preferences, baseRevision));
            if (accepted !== false && mounted.current && modeGeneration.current === expectedGeneration) setMode('discover');
            return accepted !== false;
          }} />
          {props.deviceScope ? <Text style={styles.copy}>This device's Match data stays separate. Signed-in Match changes sync across devices; signing in does not move these saves or preferences.</Text> : null}
        </View>
      )}
    </View>
  );
}

function Control({ label, displayLabel = label, onPress, disabled = false, icon, primary = false, iconOnly = false, round = false, selected }: {
  label: string; displayLabel?: string; onPress: () => void; disabled?: boolean; primary?: boolean; icon?: keyof typeof Ionicons.glyphMap; iconOnly?: boolean; round?: boolean; selected?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled, selected }} aria-pressed={selected} disabled={disabled} onPress={onPress}
    style={[styles.control, primary && styles.primary, iconOnly && styles.iconControl, round && styles.roundControl, round && primary && styles.saveControl, disabled && styles.disabled]}>
    {icon ? <Ionicons name={icon} color={round ? primary ? '#092720' : '#f4f7ff' : primary ? colors.onPrimary : colors.ink} size={round ? 28 : 20} /> : null}
    {!iconOnly ? <Text style={[styles.controlText, primary && styles.primaryText, round && styles.roundControlText, round && { color: primary ? '#092720' : '#f4f7ff' }]}>{displayLabel}</Text> : null}
  </Pressable>;
}

function useMatchReducedMotion() {
  // Avoid playing an animation before the asynchronous OS preference is known.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

export function getMatchSwipeDecision(dx: number, dy: number, velocityX: number): 'saved' | 'passed' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(velocityX) || Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  const longEnough = Math.abs(dx) >= 72;
  const fastEnough = Math.abs(dx) >= 24 && Math.abs(velocityX) >= 0.55 && Math.sign(dx) === Math.sign(velocityX);
  return longEnough || fastEnough ? dx > 0 ? 'saved' : 'passed' : null;
}

type MatchSwipePointerId = string | number;
type MatchSwipePointer = { identifier: MatchSwipePointerId; x0: number; y0: number };
type MatchSwipePoint = { identifier: MatchSwipePointerId; pageX: number; pageY: number };
type MatchSwipeGesture = { dx: number; dy: number; vx: number; x0?: number; y0?: number; numberActiveTouches?: number };
const isSwipeRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameSwipePoint = (left: MatchSwipePoint, right: MatchSwipePoint) => left.identifier === right.identifier && left.pageX === right.pageX && left.pageY === right.pageY;

function readMatchSwipePoint(value: unknown): MatchSwipePoint | null {
  if (!isSwipeRecord(value)) return null;
  const { identifier, pageX, pageY } = value;
  const validId = typeof identifier === 'string' ? identifier.length > 0 && identifier.length <= 128
    : typeof identifier === 'number' && Number.isSafeInteger(identifier) && identifier >= 0;
  if (!validId || (typeof identifier !== 'string' && typeof identifier !== 'number')
    || typeof pageX !== 'number' || !Number.isFinite(pageX) || typeof pageY !== 'number' || !Number.isFinite(pageY)) return null;
  return { identifier, pageX, pageY };
}

function readMatchSwipeEvent(event: unknown): { point: MatchSwipePoint; active: boolean } | null {
  try {
    if (!isSwipeRecord(event) || !isSwipeRecord(event.nativeEvent)) return null;
    const native = event.nativeEvent, point = readMatchSwipePoint(native);
    if (!point || !Array.isArray(native.touches) || !Array.isArray(native.changedTouches)
      || native.touches.length > 1 || native.changedTouches.length !== 1) return null;
    const changed = readMatchSwipePoint(native.changedTouches[0]);
    if (!changed || !sameSwipePoint(point, changed)) return null;
    if (native.touches.length === 0) return { point, active: false };
    const active = readMatchSwipePoint(native.touches[0]);
    return active && sameSwipePoint(point, active) ? { point, active: true } : null;
  } catch { return null; }
}

function isMatchingMatchSwipeTouch(event: unknown, pointer: MatchSwipePointer | null, activeTouches: number | undefined): boolean {
  const value = readMatchSwipeEvent(event);
  return pointer !== null && activeTouches === 1 && value?.active === true && value.point.identifier === pointer.identifier;
}

function createMatchSwipePointer(event: unknown, gesture: Pick<MatchSwipeGesture, 'x0' | 'y0' | 'numberActiveTouches'> | undefined): MatchSwipePointer | null {
  if (!gesture || typeof gesture.x0 !== 'number' || !Number.isFinite(gesture.x0) || typeof gesture.y0 !== 'number' || !Number.isFinite(gesture.y0)) return null;
  const value = readMatchSwipeEvent(event);
  if (!value) return null;
  const pointer = { identifier: value.point.identifier, x0: gesture.x0, y0: gesture.y0 };
  return isMatchingMatchSwipeTouch(event, pointer, gesture.numberActiveTouches) ? pointer : null;
}

function getMatchSwipeReleaseDecision(event: unknown, gesture: MatchSwipeGesture, pointer: MatchSwipePointer | null): 'saved' | 'passed' | null {
  if (!Number.isFinite(gesture.dx) || !Number.isFinite(gesture.dy) || !Number.isFinite(gesture.vx)) return null;
  const legacy = () => getMatchSwipeDecision(gesture.dx, gesture.dy, gesture.vx);
  const value = readMatchSwipeEvent(event);
  if (!pointer || gesture.numberActiveTouches !== 0 || value?.active !== false || value.point.identifier !== pointer.identifier) return legacy();
  const dx = value.point.pageX - pointer.x0, dy = value.point.pageY - pointer.y0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return legacy();
  // END can carry a later position than the final MOVE. A valid endpoint also
  // remains authoritative when the finger returns or moves mostly vertically.
  return getMatchSwipeDecision(dx, dy, gesture.vx);
}

function MatchDeck({ candidates, disabled, pending, error, lastLoaded, toolbarOverlay, onDecision, onDetails }: {
  candidates: RankedMatchCandidate[]; disabled: boolean; pending: boolean; error: string; lastLoaded: boolean; toolbarOverlay: boolean;
  onDecision: OrbitMatchScreenProps['onDecision']; onDetails: (candidate: MatchCandidate) => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const item = candidates[0];
  const primaryFacts = getCandidatePrimaryFacts(item, lastLoaded);
  const key = matchReferenceKey(item.ref);
  const reducedMotion = useMatchReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const promotionScale = useRef(new Animated.Value(1)).current;
  const promotionOpacity = useRef(new Animated.Value(1)).current;
  const promotion = useRef<Animated.CompositeAnimation | null>(null);
  const promotedKey = useRef(key);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const committedKey = useRef<string | null>(null);
  const gestureSession = useRef<{ key: string; generation: number; pointer: MatchSwipePointer | null } | null>(null);
  const latest = useRef({ item, key, disabled, onDecision });
  latest.current = { item, key, disabled, onDecision };
  const [animating, setAnimating] = useState(false);
  const nativeDriver = Platform.OS !== 'web';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      animation.current?.stop();
      promotion.current?.stop();
      x.stopAnimation();
      y.stopAnimation();
      promotionScale.stopAnimation();
      promotionOpacity.stopAnimation();
    };
  }, [x, y, promotionScale, promotionOpacity]);
  useEffect(() => {
    generation.current += 1;
    animation.current?.stop();
    animation.current = null;
    busy.current = false;
    committedKey.current = null;
    gestureSession.current = null;
    setAnimating(false);
    x.setValue(0);
    y.setValue(0);
  }, [key, disabled, pending, error, reducedMotion, x, y]);
  useEffect(() => {
    promotion.current?.stop();
    promotion.current = null;
    promotionScale.setValue(1);
    promotionOpacity.setValue(1);
    if (reducedMotion) { promotedKey.current = key; return; }
    if (disabled || promotedKey.current === key) return;
    promotedKey.current = key;
    const expectedGeneration = generation.current;
    promotionScale.setValue(0.98);
    promotionOpacity.setValue(0.86);
    const next = Animated.parallel([
      Animated.spring(promotionScale, { toValue: 1, friction: 9, tension: 120, useNativeDriver: nativeDriver }),
      Animated.timing(promotionOpacity, { toValue: 1, duration: 160, useNativeDriver: nativeDriver })
    ]);
    promotion.current = next;
    next.start(({ finished }) => {
      if (!finished || !mounted.current || generation.current !== expectedGeneration || latest.current.key !== key) return;
      promotion.current = null;
      promotionScale.setValue(1);
      promotionOpacity.setValue(1);
    });
    return () => { next.stop(); promotionScale.setValue(1); promotionOpacity.setValue(1); };
  }, [key, disabled, pending, error, reducedMotion, nativeDriver, promotionScale, promotionOpacity]);

  const stopPromotion = () => {
    promotion.current?.stop();
    promotion.current = null;
    promotionScale.stopAnimation(); promotionOpacity.stopAnimation();
    promotionScale.setValue(1); promotionOpacity.setValue(1);
  };

  const commit = (decision: 'saved' | 'passed') => {
    const current = latest.current;
    if (current.disabled || busy.current || committedKey.current === current.key || !mounted.current) return;
    stopPromotion();
    gestureSession.current = null;
    busy.current = true;
    const expectedGeneration = generation.current;
    const expectedKey = current.key;
    const finish = (finished: boolean) => {
      if (!finished || !mounted.current || generation.current !== expectedGeneration || latest.current.key !== expectedKey || latest.current.disabled || committedKey.current === expectedKey) return;
      busy.current = false;
      committedKey.current = expectedKey;
      setAnimating(false);
      x.setValue(0);
      y.setValue(0);
      latest.current.onDecision(latest.current.item, decision);
    };
    if (reducedMotion) { finish(true); return; }
    setAnimating(true);
    animation.current = Animated.parallel([
      Animated.timing(x, { toValue: decision === 'saved' ? 500 : -500, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.timing(y, { toValue: -12, duration: 180, useNativeDriver: nativeDriver })
    ]);
    animation.current.start(({ finished }) => finish(finished));
  };
  const springBack = () => {
    if (reducedMotion) { x.setValue(0); y.setValue(0); return; }
    animation.current = Animated.parallel([
      Animated.spring(x, { toValue: 0, friction: 8, tension: 100, useNativeDriver: nativeDriver }),
      Animated.spring(y, { toValue: 0, friction: 8, tension: 100, useNativeDriver: nativeDriver })
    ]);
    animation.current.start();
  };
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !latest.current.disabled && !busy.current && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderGrant: (event, gesture) => {
      if (latest.current.disabled || busy.current) return;
      stopPromotion();
      animation.current?.stop(); x.stopAnimation(); y.stopAnimation();
      gestureSession.current = { key: latest.current.key, generation: generation.current, pointer: createMatchSwipePointer(event, gesture) };
    },
    onPanResponderStart: (event, gesture) => {
      const session = gestureSession.current;
      if (!session || session.key !== latest.current.key || session.generation !== generation.current) return;
      if (session.pointer && !isMatchingMatchSwipeTouch(event, session.pointer, gesture.numberActiveTouches)) session.pointer = null;
    },
    onPanResponderMove: (event, gesture) => {
      if (latest.current.disabled || busy.current || gestureSession.current?.key !== latest.current.key || gestureSession.current.generation !== generation.current) return;
      if (gestureSession.current.pointer && !isMatchingMatchSwipeTouch(event, gestureSession.current.pointer, gesture.numberActiveTouches)) gestureSession.current.pointer = null;
      x.setValue(gesture.dx);
      y.setValue(gesture.dy * 0.08);
    },
    onPanResponderRelease: (event, gesture) => {
      const session = gestureSession.current;
      gestureSession.current = null;
      if (!session || session.key !== latest.current.key || session.generation !== generation.current) return;
      const decision = getMatchSwipeReleaseDecision(event, gesture, session.pointer);
      if (decision) commit(decision); else springBack();
    },
    onPanResponderTerminationRequest: () => !busy.current,
    onPanResponderTerminate: () => { gestureSession.current = null; springBack(); }
  }), [reducedMotion, nativeDriver, x, y]);
  return <View style={styles.deck}>
    {candidates[1] ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.card, styles.cardBehind]}>
      <CandidateContent candidate={candidates[1]} compact facts={getCandidatePrimaryFacts(candidates[1], lastLoaded)} />
    </View> : null}
    <Animated.View key={key} {...responder.panHandlers} style={[styles.card, { opacity: promotionOpacity, transform: [{ translateX: x }, { translateY: y }, { scale: promotionScale }, { rotate: reducedMotion ? '0deg' : x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-6deg', '0deg', '6deg'], extrapolate: 'clamp' }) }] }]}>
      {!reducedMotion ? <>
        <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.feedback, styles.saveFeedback, { opacity: x.interpolate({ inputRange: [0, 40, 100], outputRange: [0, 0.4, 1], extrapolate: 'clamp' }) }]}><Text style={styles.feedbackText}>Save</Text></Animated.View>
        <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.feedback, styles.passFeedback, { opacity: x.interpolate({ inputRange: [-100, -40, 0], outputRange: [1, 0.4, 0], extrapolate: 'clamp' }) }]}><Text style={styles.feedbackText}>Pass</Text></Animated.View>
      </> : null}
      <Pressable style={styles.cardHero} accessibilityRole="button" accessibilityLabel={[`Open ${item.summary.gameName} at ${item.summary.venueName}`, primaryFacts.eyebrow, primaryFacts.status, primaryFacts.location, primaryFacts.starts, primaryFacts.buyIn].filter(Boolean).join('; ')} onPress={() => onDetails(item)} disabled={animating}>
        <CandidateContent candidate={item} facts={primaryFacts} toolbarOverlay={toolbarOverlay} />
      </Pressable>
      <View style={styles.cardActions}>
        <Control label={`Pass ${item.summary.gameName}`} displayLabel="Pass" onPress={() => commit('passed')} disabled={disabled || animating} icon="close-outline" round />
        <Control label={`Save ${item.summary.gameName}`} displayLabel="Save" onPress={() => commit('saved')} disabled={disabled || animating} icon="heart" primary round />
        <Control label="View details" displayLabel="Details" onPress={() => onDetails(item)} disabled={animating} icon="information-circle-outline" round />
      </View>
      <CandidateDetails key={key} candidate={item} />
    </Animated.View>
  </View>;
}

function getCandidatePrimaryFacts(candidate: MatchCandidate, lastLoaded: boolean) {
  const game = candidate.opportunity?.game;
  const status = game ? getGameStatusLabel(game) : candidate.status === 'scheduled' ? 'Scheduled tournament' : candidate.status === 'inactive' ? 'No longer active' : candidate.status === 'forming' ? 'Forming' : candidate.status === 'paused' ? 'Paused' : 'Published game';
  const city = candidate.opportunity ? getClubCity(candidate.opportunity.club) : '';
  const startsAt = candidate.tournament?.startsAt;
  const starts = startsAt && Number.isFinite(Date.parse(startsAt)) ? new Date(startsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return {
    eyebrow: candidate.ref.kind === 'tournament' ? 'TOURNAMENT' : candidate.variant === 'plo' ? 'OMAHA' : candidate.variant === 'nlh' ? 'HOLD\u2019EM' : 'CASH GAME',
    status: lastLoaded ? `Last loaded: ${status}` : status,
    location: [city, candidate.distanceMiles === null ? null : `${candidate.distanceMiles.toFixed(1)} mi away`].filter(Boolean).join(' \u00b7 '),
    starts,
    buyIn: candidate.buyIn === null ? null : `$${candidate.buyIn} buy-in`
  };
}

function CandidateContent({ candidate, compact = false, facts, toolbarOverlay = false }: {
  candidate: MatchCandidate; compact?: boolean; facts: ReturnType<typeof getCandidatePrimaryFacts>; toolbarOverlay?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const accent = candidate.variant === 'plo' ? { color: '#55e8d6', background: '#0B2F32' }
    : (candidate.availableSeats ?? 0) > 3 ? { color: '#65edb1', background: '#0B3528' }
    : { color: '#a2c1ff', background: '#102C65' };
  return <View style={[styles.cardContent, compact && styles.compactCardContent, toolbarOverlay && styles.cardContentWithToolbar, { backgroundColor: accent.background }]}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.heroGlow, { borderColor: accent.color }]} />
    <View style={styles.heroTop}>
      <Text style={[styles.heroEyebrow, { color: '#e1ebff' }]}>{facts.eyebrow}</Text>
      <Ionicons name="arrow-forward" size={21} color="#e1ebff" />
    </View>
    <View style={styles.gameCopy}>
      <Text style={[styles.status, { color: accent.color }]}>{facts.status}</Text>
      <Text style={[styles.heroTitle, { color: accent.color }]}>{candidate.summary.gameName}</Text>
      <Text style={[styles.heroVenue, { color: '#f4f7ff' }]}>{candidate.summary.venueName}</Text>
      {facts.location ? <Text style={[styles.heroLocation, { color: '#d2def4' }]}>{facts.location}</Text> : null}
      {facts.starts ? <Text style={[styles.heroLocation, { color: '#d2def4' }]}>{facts.starts}</Text> : null}
      {facts.buyIn ? <Text style={[styles.heroLocation, { color: '#d2def4' }]}>{facts.buyIn}</Text> : null}
    </View>
  </View>;
}

function CandidateDetails({ candidate }: { candidate: RankedMatchCandidate }) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const [expanded, setExpanded] = useState(false);
  const game = candidate.opportunity?.game;
  const runningTables = game?.openTables.filter((table) => table.status === 'Running').length ?? 0;
  const runningSeats = game && runningTables ? getRunningAvailableSeats(game) : null;
  const repeatedSeatReason = runningSeats !== null && Number.isSafeInteger(runningSeats) && runningSeats > 0 && candidate.availableSeats === runningSeats
    ? `${runningSeats} published open seat${runningSeats === 1 ? '' : 's'}.` : null;
  const repeatedDistanceReason = candidate.distanceMiles !== null && Number.isFinite(candidate.distanceMiles) && candidate.distanceMiles >= 0
    ? `${candidate.distanceMiles.toFixed(1)} miles from your selected location.` : null;
  const distinctReasons = candidate.reasons.filter((reason) => reason !== repeatedSeatReason && reason !== repeatedDistanceReason);
  const fee = candidate.opportunity ? getClubFeeProfile(candidate.opportunity.club, candidate.opportunity.game) : null;
  return <View style={styles.cardInfo}>
    <Pressable accessibilityRole="button" accessibilityLabel="Game info" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded((value) => !value)} style={styles.infoToggle}>
      <Text style={styles.label}>Game info</Text><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
    </Pressable>
    {expanded ? <View style={styles.infoBody}>
      <View style={styles.facts}>
        {game ? <View style={styles.fact}><Text style={styles.factValue}>{runningTables}</Text><Text style={styles.label}>Running tables</Text></View> : null}
        {candidate.waitlistCount !== null ? <View style={styles.fact}><Text style={styles.factValue}>{candidate.waitlistCount}</Text><Text style={styles.label}>Waiting</Text></View> : null}
        {candidate.buyIn !== null ? <View style={styles.fact}><Text style={styles.factValue}>${candidate.buyIn}</Text><Text style={styles.label}>Published buy-in</Text></View> : null}
      </View>
      {fee ? <Text style={styles.copy}>{fee.label}</Text> : null}
      {distinctReasons.slice(0, 2).map((reason) => <Text key={reason} style={styles.reason}>{reason}</Text>)}
      <Text style={styles.copy}>Saving keeps a game for later. Requests are confirmed separately with the venue.</Text>
    </View> : null}
  </View>;
}

function SavedGames({ games, writable, live, onRemove, onDetails }: {
  games: SavedMatchGame[]; writable: boolean; live: boolean; onRemove: (record: MatchDecision) => void; onDetails: (candidate: MatchCandidate) => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const [visibleCount, setVisibleCount] = useState(20);
  return <View style={styles.savedList}>
    {!games.length ? <View style={styles.notice}><Text style={styles.sectionTitle}>No saved games yet</Text><Text style={styles.copy}>Save a game from Discover to keep it here.</Text></View> : null}
    {games.slice(0, visibleCount).map(({ record, candidate, unavailableReason }) => {
      const available = Boolean(candidate && !unavailableReason);
      return <View key={matchReferenceKey(record.ref)} style={styles.savedRow}>
        <Text style={styles.sectionTitle}>{record.summary.gameName}</Text>
        <Text style={styles.copy}>{record.summary.venueName}</Text>
        {available && candidate ? <Text style={styles.copy}>{!live ? 'Last loaded: ' : ''}{candidate.opportunity ? getPublishedAvailabilityLabel(candidate.opportunity.game) : 'Scheduled tournament'}</Text>
          : <Text accessibilityRole="alert" style={styles.copy}>{unavailableReason || 'This game is no longer published.'}</Text>}
        <View style={styles.savedActions}>
          <Control label={`Details for saved ${record.summary.gameName}`} displayLabel="Details" disabled={!available || !live} onPress={() => { if (candidate && available && live) onDetails(candidate); }} />
          <Control label={`Remove saved ${record.summary.gameName}`} displayLabel="Remove" disabled={!writable} onPress={() => onRemove(record)} />
        </View>
      </View>;
    })}
    {games.length > visibleCount ? <Control label="Show more saved games" onPress={() => setVisibleCount((current) => Math.min(games.length, current + 20))} /> : null}
  </View>;
}

const variants: { id: MatchVariant; label: string }[] = [
  { id: 'nlh', label: 'No Limit Holdem' }, { id: 'plo', label: 'Pot Limit Omaha' }, { id: 'limit-holdem', label: 'Limit Holdem' }, { id: 'mixed', label: 'Mixed games' }
];
type NumericDraft = { stakeMin: string; stakeMax: string; buyInMin: string; buyInMax: string; distance: string; waitlist: string };

function numericPreferenceDraft(preferences: MatchPreferences): NumericDraft {
  return {
    stakeMin: preferences.stakes ? String(preferences.stakes.minBigBlind) : '', stakeMax: preferences.stakes ? String(preferences.stakes.maxBigBlind) : '',
    buyInMin: preferences.buyIn ? String(preferences.buyIn.min) : '', buyInMax: preferences.buyIn ? String(preferences.buyIn.max) : '',
    distance: preferences.maxDistanceMiles === null ? '' : String(preferences.maxDistanceMiles), waitlist: preferences.maxWaitlist === null ? '' : String(preferences.maxWaitlist)
  };
}

function preferenceKey(preferences: MatchPreferences) {
  return JSON.stringify([
    [...preferences.variants].sort(), preferences.stakes ? [preferences.stakes.minBigBlind, preferences.stakes.maxBigBlind] : null,
    preferences.format, preferences.buyIn ? [preferences.buyIn.min, preferences.buyIn.max] : null, preferences.maxDistanceMiles,
    [...preferences.favoriteClubIds].sort(), [...preferences.excludedClubIds].sort(), preferences.requireSeatsNow,
    preferences.willingToWait, preferences.maxWaitlist, [...preferences.preferredDays].sort((left, right) => left - right),
    preferences.preferredTime, preferences.exploreNewVenues, preferences.strictVariants, preferences.strictStakes, preferences.strictBuyIn
  ]);
}

function MatchPreferencesForm({ preferences, preferencesRevision, clubs, disabled: externallyDisabled, originLabel, onSelectOrigin, onClearOrigin, onSave, timeZone = 'UTC' }: {
  preferences: MatchPreferences; preferencesRevision?: number; clubs: OrbitMatchScreenProps['clubs']; disabled: boolean; originLabel?: string | null;
  onSelectOrigin?: () => void; onClearOrigin?: () => void; onSave: (value: MatchPreferences, baseRevision?: number) => Promise<boolean>;
  timeZone?: string;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const [draft, setDraft] = useState(preferences);
  const [numbers, setNumbers] = useState(() => numericPreferenceDraft(preferences));
  const [baseRevision, setBaseRevision] = useState(preferencesRevision);
  const [baseKey, setBaseKey] = useState(() => preferenceKey(preferences));
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = externallyDisabled || saving;
  const conflict = preferencesRevision !== baseRevision || preferenceKey(preferences) !== baseKey;
  const [validationError, setValidationError] = useState('');
  const [openSection, setOpenSection] = useState<'games' | 'travel' | 'availability' | 'venues' | null>(null);
  const toggleSection = (section: NonNullable<typeof openSection>) => setOpenSection((current) => current === section ? null : section);
  const [venueQuery, setVenueQuery] = useState('');
  const matchingClubs = clubs.filter((club) => club.name.toLowerCase().includes(venueQuery.trim().toLowerCase()));
  const visibleClubs = matchingClubs.slice(0, 50);
  const toggleId = (values: string[], id: string) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  const updateVenuePreference = (field: 'favoriteClubIds' | 'excludedClubIds', id: string) => {
    if (!draft[field].includes(id) && draft[field].length >= 100) {
      setValidationError('You can select up to 100 favorite venues and 100 excluded venues.');
      return;
    }
    setDraft((current) => ({ ...current, [field]: toggleId(current[field], id),
      ...(field === 'favoriteClubIds' ? { excludedClubIds: current.excludedClubIds.filter((value) => value !== id) }
        : { favoriteClubIds: current.favoriteClubIds.filter((value) => value !== id) }) }));
  };
  const input = (label: string, field: keyof NumericDraft) => <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} keyboardType="decimal-pad" editable={!disabled} value={numbers[field]} placeholder="Any" placeholderTextColor={colors.muted}
      onChangeText={(value) => setNumbers((current) => ({ ...current, [field]: value }))} style={styles.input} />
  </View>;
  const apply = async () => {
    if (disabled || conflict) return;
    const range = (minInput: string, maxInput: string, label: string) => {
      if (!minInput.trim() && !maxInput.trim()) return null;
      const min = Number(minInput), max = Number(maxInput);
      if (!minInput.trim() || !maxInput.trim() || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100_000 || min > max) throw new Error(`${label}: enter both bounds from 0 to 100,000, with the minimum no greater than the maximum.`);
      return { min, max };
    };
    try {
      const stakes = range(numbers.stakeMin, numbers.stakeMax, 'Stakes');
      const buyIn = range(numbers.buyInMin, numbers.buyInMax, 'Buy-in');
      const distance = numbers.distance.trim() ? Number(numbers.distance) : null;
      const waitlist = numbers.waitlist.trim() ? Number(numbers.waitlist) : null;
      if (distance !== null && (!Number.isFinite(distance) || distance < 1 || distance > 500)) throw new Error('Travel distance must be between 1 and 500 miles.');
      if (waitlist !== null && (!Number.isInteger(waitlist) || waitlist < 0 || waitlist > 10_000)) throw new Error('Waitlist limit must be a whole number from 0 to 10,000.');
      setValidationError('');
      setSaving(true);
      const accepted = await onSave({ ...draft, stakes: stakes ? { minBigBlind: stakes.min, maxBigBlind: stakes.max } : null, buyIn,
        maxDistanceMiles: distance, maxWaitlist: waitlist, strictVariants: draft.variants.length > 0 && draft.strictVariants,
        strictStakes: Boolean(stakes) && draft.strictStakes, strictBuyIn: Boolean(buyIn) && draft.strictBuyIn }, baseRevision);
      if (!accepted && mounted.current) setValidationError('Preferences could not be saved. Your edits are still here.');
    } catch (error) { if (mounted.current) setValidationError(error instanceof Error ? error.message : 'Check your preferences before saving.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  return <View style={styles.form}>
    <Text style={styles.copy}>Optional preferences help order games. Strict limits exclude games that do not match.</Text>
    {conflict ? <View accessibilityRole="alert" style={styles.notice}>
      <Text style={styles.copy}>Current preferences changed. Your edits remain here. Reload the current preferences before saving.</Text>
      <Control label="Reload current Match preferences" disabled={disabled} onPress={() => {
        setDraft(preferences); setNumbers(numericPreferenceDraft(preferences)); setBaseRevision(preferencesRevision); setBaseKey(preferenceKey(preferences)); setValidationError('');
      }} />
    </View> : null}
    <PreferenceSection title="Games" summary={draft.variants.length ? `${draft.variants.length} variant${draft.variants.length === 1 ? '' : 's'} selected` : 'Variants, stakes, and format'} expanded={openSection === 'games'} onPress={() => toggleSection('games')}>
      <View style={styles.options}>{variants.map(({ id, label }) => <Option key={id} label={label} active={draft.variants.includes(id)} disabled={disabled}
        onPress={() => setDraft((current) => ({ ...current, variants: current.variants.includes(id) ? current.variants.filter((value) => value !== id) : [...current.variants, id] }))} />)}</View>
      <Toggle label="Only these variants" checked={draft.strictVariants} disabled={disabled || !draft.variants.length} onPress={() => setDraft((current) => ({ ...current, strictVariants: !current.strictVariants }))} />
      <View style={styles.options}>{(['any', 'cash', 'tournament'] as const).map((format) => <Option key={format} label={format === 'any' ? 'Cash and tournaments' : format === 'cash' ? 'Cash games' : 'Tournaments'} active={draft.format === format} disabled={disabled} onPress={() => setDraft((current) => ({ ...current, format }))} />)}</View>
      <Text style={styles.label}>Preferred big blind ($)</Text>
      <View style={styles.range}>{input('Minimum big blind', 'stakeMin')}{input('Maximum big blind', 'stakeMax')}</View>
      <Toggle label="Only this stakes range" checked={draft.strictStakes} disabled={disabled || !numbers.stakeMin.trim() || !numbers.stakeMax.trim()} onPress={() => setDraft((current) => ({ ...current, strictStakes: !current.strictStakes }))} />
      <Text style={styles.label}>Published buy-in ($)</Text>
      <View style={styles.range}>{input('Minimum buy-in', 'buyInMin')}{input('Maximum buy-in', 'buyInMax')}</View>
      <Toggle label="Only this buy-in range" checked={draft.strictBuyIn} disabled={disabled || !numbers.buyInMin.trim() || !numbers.buyInMax.trim()} onPress={() => setDraft((current) => ({ ...current, strictBuyIn: !current.strictBuyIn }))} />
    </PreferenceSection>
    <PreferenceSection title="Travel" summary={originLabel || 'Optional discovery area and radius'} expanded={openSection === 'travel'} onPress={() => toggleSection('travel')}>
      <Text style={styles.copy}>{originLabel || 'No location selected. Choose an area to use a travel radius.'}</Text>
      {onSelectOrigin ? <Control label="Choose discovery location" onPress={onSelectOrigin} disabled={disabled} /> : null}
      {onClearOrigin && originLabel ? <Control label="Clear discovery location" onPress={onClearOrigin} disabled={disabled} /> : null}
      {input('Maximum travel miles', 'distance')}
    </PreferenceSection>
    <PreferenceSection title="Availability" summary={draft.requireSeatsNow ? 'Open seats required' : 'Seats, waitlists, and playing times'} expanded={openSection === 'availability'} onPress={() => toggleSection('availability')}>
      <Toggle label="Require open seats now" checked={draft.requireSeatsNow} disabled={disabled} onPress={() => setDraft((current) => ({ ...current, requireSeatsNow: !current.requireSeatsNow }))} />
      <Toggle label="Willing to join a waitlist" checked={draft.willingToWait} disabled={disabled} onPress={() => setDraft((current) => ({ ...current, willingToWait: !current.willingToWait }))} />
      {input('Maximum waitlist length', 'waitlist')}
      <Text style={styles.copy}>Days and times help order published scheduled tournaments in {timeZone}. Cash game schedules are not published.</Text>
      <Text style={styles.copy}>Daytime: 06:00–17:59. Evenings: 18:00–23:59.</Text>
      <Text style={styles.label}>Preferred playing days</Text>
      <View style={styles.options}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => <Option key={day} label={label} active={draft.preferredDays.includes(day)} disabled={disabled}
        onPress={() => setDraft((current) => ({ ...current, preferredDays: current.preferredDays.includes(day) ? current.preferredDays.filter((value) => value !== day) : [...current.preferredDays, day] }))} />)}</View>
      <View style={styles.options}>{(['any', 'day', 'evening'] as const).map((preferredTime) => <Option key={preferredTime} label={preferredTime === 'any' ? 'Any time' : preferredTime === 'day' ? 'Daytime' : 'Evenings'} active={draft.preferredTime === preferredTime} disabled={disabled} onPress={() => setDraft((current) => ({ ...current, preferredTime }))} />)}</View>
    </PreferenceSection>
    <PreferenceSection title="Venues" summary={`${draft.favoriteClubIds.length} favorite · ${draft.excludedClubIds.length} excluded`} expanded={openSection === 'venues'} onPress={() => toggleSection('venues')}>
      <Toggle label="Explore unfamiliar venues" checked={draft.exploreNewVenues} disabled={disabled} onPress={() => setDraft((current) => ({ ...current, exploreNewVenues: !current.exploreNewVenues }))} />
      <Text style={styles.copy}>Explore venues outside your favorites and currently saved games. This does not infer where you have played.</Text>
      <Text style={styles.label}>Search venues</Text>
      <TextInput accessibilityLabel="Search Match venues" value={venueQuery} onChangeText={setVenueQuery} placeholder="Venue name" placeholderTextColor={colors.muted} style={styles.input} />
      {matchingClubs.length > visibleClubs.length ? <Text style={styles.copy}>Search to narrow the venue list.</Text> : null}
      {visibleClubs.map((club) => <View key={club.id} style={styles.venuePreference}>
        <Text style={styles.label}>{club.name}</Text>
        <View style={styles.options}>
          <Option label={`Favorite ${club.name}`} displayLabel="Favorite" active={draft.favoriteClubIds.includes(club.id)} disabled={disabled} onPress={() => updateVenuePreference('favoriteClubIds', club.id)} />
          <Option label={`Exclude ${club.name}`} displayLabel="Exclude" active={draft.excludedClubIds.includes(club.id)} disabled={disabled} onPress={() => updateVenuePreference('excludedClubIds', club.id)} />
        </View>
      </View>)}
    </PreferenceSection>
    {validationError ? <Text accessibilityRole="alert" style={styles.error}>{validationError}</Text> : null}
    <View style={styles.options}>
      <Control label={saving ? 'Saving Match preferences' : 'Save Match preferences'} displayLabel={saving ? 'Saving…' : 'Save preferences'} onPress={apply} disabled={disabled || conflict} primary />
      <Control label="Reset Match preferences draft" displayLabel="Reset preferences" disabled={disabled} onPress={() => {
        const reset = { ...defaultMatchPreferences, variants: [], favoriteClubIds: [], excludedClubIds: [], preferredDays: [] };
        setDraft(reset); setNumbers(numericPreferenceDraft(reset)); setValidationError('');
      }} />
    </View>
  </View>;
}

function PreferenceSection({ title, summary, expanded, onPress, children }: PropsWithChildren<{
  title: string; summary: string; expanded: boolean; onPress: () => void;
}>) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return <View style={styles.preferenceSection}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Match ${title.toLowerCase()} preferences`} accessibilityState={{ expanded }} aria-expanded={expanded} onPress={onPress} style={styles.preferenceHeading}>
      <View style={styles.preferenceHeadingCopy}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.copy}>{summary}</Text></View>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} color={colors.muted} size={20} />
    </Pressable>
    {expanded ? <View style={styles.preferenceBody}>{children}</View> : null}
  </View>;
}

function Option({ label, displayLabel = label, active, disabled, onPress }: { label: string; displayLabel?: string; active: boolean; disabled: boolean; onPress: () => void }) {
  const styles = useThemedStyles(baseStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress}
    style={[styles.option, active && styles.optionActive, disabled && styles.disabled]}><Text style={styles.controlText}>{displayLabel}</Text></Pressable>;
}

function Toggle({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled: boolean; onPress: () => void }) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }} aria-checked={checked} disabled={disabled} onPress={onPress}
    style={[styles.toggle, disabled && styles.disabled]}>
    <Ionicons name={checked ? 'checkbox-outline' : 'square-outline'} color={colors.ink} size={22} /><Text style={styles.toggleText}>{label}</Text>
  </Pressable>;
}
