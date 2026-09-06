import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgGradient, Path, Rect, Stop } from 'react-native-svg';
import { getGameStatusLabel, getRunningAvailableSeats, hasRunningTable } from '../../domain/discovery';
import type { GameOpportunity } from '../../domain/playerTypes';
import { colors } from '../../styles/playerTheme';
import { playerLandingStyles as styles } from './playerLandingStyles';

const featureCards = [
  {
    id: 'current',
    rank: 'A',
    suit: '♠',
    tone: 'ink',
    label: 'Published',
    title: 'Room listings',
    detail: 'Room-published games, tables, and open-seat context.',
    left: 18,
    rotation: '-9deg'
  },
  {
    id: 'forming',
    rank: 'K',
    suit: '♦',
    tone: 'red',
    label: 'Forming',
    title: 'Building a table',
    detail: "See a room's published interest before the first hand is dealt.",
    left: 84,
    rotation: '0deg'
  },
  {
    id: 'interest',
    rank: 'Q',
    suit: '♥',
    tone: 'red',
    label: 'Open',
    title: 'Interest open',
    detail: 'Find published tournaments where venues accept nonbinding interest.',
    left: 150,
    rotation: '9deg'
  }
] as const;

const journeySteps = [
  { number: '01', title: 'Discover', body: 'See what rooms have published.' },
  { number: '02', title: 'Evaluate', body: 'Check the game, place, and timing.' },
  { number: '03', title: 'Commit', body: 'Send the room one clear request.' },
  { number: '04', title: 'Arrive', body: 'Walk in with the room informed.' }
] as const;

const faqItems = [
  {
    id: 'browse',
    question: 'What information is published?',
    answer: 'Participating rooms publish their current games, tables, seats, and tournament state from Orbit Core.'
  },
  {
    id: 'seat',
    question: 'Does a game request guarantee a seat?',
    answer: 'No. A request tells the room whether you are there, arriving later, or interested. The room remains authoritative for seating and waitlist order.'
  },
  {
    id: 'location',
    question: 'Can I use Orbit without sharing my location?',
    answer: 'Yes. Orbit lists venue-published addresses and does not require precise device location for discovery.'
  },
  {
    id: 'payments',
    question: 'How do memberships and tournament payments work?',
    answer: 'Orbit shows only options a room has published. Any membership or tournament fee is confirmed and collected by the venue in person.'
  }
] as const;

export function PlayerAmbientFlow() {
  return (
    <View pointerEvents="none" style={styles.ambientFlow}>
      <Svg height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 900" width="100%">
        <Defs>
          <SvgGradient id="flow" x1="0" x2="1" y1="0" y2="1">
            <Stop offset="0" stopColor="#4d7cfe" stopOpacity="0.28" />
            <Stop offset="0.55" stopColor="#a98bff" stopOpacity="0.12" />
            <Stop offset="1" stopColor="#35d3a1" stopOpacity="0.04" />
          </SvgGradient>
        </Defs>
        <Path d="M-80 62 C 32 8, 126 154, 248 92 S 440 46, 478 154 L 478 0 L -80 0 Z" fill="url(#flow)" />
        <Path d="M-68 148 C 64 74, 164 218, 286 144 S 442 112, 480 208" fill="none" stroke="#6e91ff" strokeOpacity="0.13" strokeWidth="1.5" />
        <Path d="M-92 704 C 46 606, 168 798, 286 716 S 430 648, 492 748 L 492 920 L -92 920 Z" fill="url(#flow)" opacity="0.34" />
        <Path d="M152 900 C 176 746, 284 698, 438 716" fill="none" stroke="#35d3a1" strokeOpacity="0.08" strokeWidth="2" />
        <Ellipse cx="374" cy="788" fill="none" rx="174" ry="128" stroke="#35d3a1" strokeOpacity="0.06" />
      </Svg>
    </View>
  );
}

export function PlayerLandingHero({
  opportunities,
  inventoryPartial,
  inventoryStatus,
  openTournamentCount,
  clubCount,
  onFindGame,
  onOpenGame,
  onBrowseTournaments,
  onBrowseClubs
}: {
  opportunities: GameOpportunity[];
  inventoryPartial: boolean;
  inventoryStatus: 'idle' | 'loading' | 'ready' | 'error';
  openTournamentCount: number;
  clubCount: number;
  onFindGame: () => void;
  onOpenGame: (item: GameOpportunity) => void;
  onBrowseTournaments: () => void;
  onBrowseClubs: () => void;
}) {
  const [activeFeatureId, setActiveFeatureId] = useState<(typeof featureCards)[number]['id']>('current');
  const activeFeature = featureCards.find((feature) => feature.id === activeFeatureId) ?? featureCards[0];
  const currentGames = opportunities.slice(0, 3);
  let emptyInventoryTitle = 'Loading published games';
  let emptyInventoryCopy = 'Orbit is checking the latest updates from current rooms.';
  if (inventoryPartial) {
    emptyInventoryTitle = 'More published games are loading';
    emptyInventoryCopy = 'No matches are in the rooms loaded so far. More rooms are still refreshing.';
  } else if (inventoryStatus === 'ready') {
    emptyInventoryTitle = 'No current games published yet';
    emptyInventoryCopy = 'Browse current rooms while they update their floors.';
  } else if (inventoryStatus === 'error') {
    emptyInventoryTitle = 'Published games unavailable';
    emptyInventoryCopy = 'Orbit could not refresh current games. Try again when your connection returns.';
  }

  return (
    <View style={styles.landingHero}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <OrbitMark />
        </View>
        <View>
          <Text style={styles.brandName}>Orbit</Text>
          <Text style={styles.brandDescriptor}>Room-published player network</Text>
        </View>
      </View>

      <View style={styles.heroCopy}>
        <View style={styles.eyebrowRow}>
          <Ionicons color={colors.teal} name="sparkles-outline" size={15} />
          <Text style={styles.eyebrow}>Current room listings start here</Text>
        </View>
        <Text accessibilityRole="header" style={styles.heroTitle}>Find your game.</Text>
        <View style={styles.heroActions}>
          <Pressable accessibilityRole="button" onPress={onFindGame} style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>Start matching</Text>
            <Ionicons color="#ffffff" name="arrow-forward" size={18} />
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onBrowseTournaments} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Browse tournaments</Text>
          </Pressable>
        </View>
        <View style={styles.heroProof}>
          <View style={styles.liveDot} />
          <Text style={styles.heroProofText}>Current information published by rooms using Orbit Core</Text>
        </View>
      </View>

      <View style={styles.atmosphere}>
        <PokerTableAtmosphere />
        <View accessibilityLabel="Explore Orbit discovery features" style={styles.cardShowcase}>
          <View style={styles.cardHand}>
            {featureCards.map((feature, index) => {
              const active = activeFeature.id === feature.id;
              const red = feature.tone === 'red';
              return (
                <Pressable
                  key={feature.id}
                  accessibilityLabel={`Preview ${feature.label.toLowerCase()} feature`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setActiveFeatureId(feature.id)}
                  style={[
                    styles.pokerCard,
                    {
                      left: feature.left,
                      transform: [{ translateY: active ? -14 : 0 }, { rotate: feature.rotation }],
                      zIndex: active ? 10 : index + 1
                    },
                    active && styles.pokerCardActive
                  ]}
                >
                  <View style={styles.cardCornerTop}>
                    <Text style={[styles.cardRank, red && styles.cardRed]}>{feature.rank}</Text>
                    <Text style={[styles.cardCornerSuit, red && styles.cardRed]}>{feature.suit}</Text>
                  </View>
                  <Text style={[styles.cardSuit, red && styles.cardRed]}>{feature.suit}</Text>
                  <Text style={styles.cardLabel}>{feature.label}</Text>
                  <View style={styles.cardCornerBottom}>
                    <Text style={[styles.cardRank, red && styles.cardRed]}>{feature.rank}</Text>
                    <Text style={[styles.cardCornerSuit, red && styles.cardRed]}>{feature.suit}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View accessibilityLiveRegion="polite" style={styles.cardReadout}>
            <Text style={styles.cardReadoutLabel}>Pick a card</Text>
            <Text style={styles.cardReadoutTitle}>{activeFeature.title}</Text>
            <Text style={styles.cardReadoutBody}>{activeFeature.detail}</Text>
          </View>
        </View>
      </View>

      <View accessibilityLabel="Useful published poker activity" style={styles.nowBoard}>
        <View style={styles.nowBoardHeader}>
          <View style={styles.nowBoardTitleRow}>
            <View style={styles.liveDot} />
            <Text style={styles.nowBoardTitle}>Now on Orbit</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onFindGame} style={styles.quietAction}>
            <Text style={styles.quietActionText}>View matches</Text>
            <Ionicons color="#9bb0ff" name="arrow-forward" size={15} />
          </Pressable>
        </View>
        {currentGames.length ? (
          <View style={styles.nowBoardList}>
            {currentGames.map((item) => (
              <Pressable
                key={`${item.club.club.id}:${item.game.id}`}
                accessibilityLabel={`Open ${item.game.name} at ${item.club.club.name}`}
                accessibilityRole="button"
                onPress={() => onOpenGame(item)}
                style={styles.liveGameRow}
              >
                <View style={styles.liveGameCopy}>
                  <View style={styles.liveGameStatusRow}>
                    <View style={[styles.liveGameStatusDot, !hasRunningTable(item.game) && styles.formingGameStatusDot]} />
                    <Text style={styles.liveGameKicker}>{getGameStatusLabel(item.game)}</Text>
                  </View>
                  <Text numberOfLines={1} style={styles.liveGameTitle}>{item.game.name}</Text>
                  <Text numberOfLines={1} style={styles.liveGameMeta}>{[item.club.club.name, item.distanceMiles == null ? null : `${item.distanceMiles.toFixed(1)} mi`].filter(Boolean).join(' · ')}</Text>
                </View>
                <View style={styles.liveGameFacts}>
                  <View>
                    <Text style={styles.liveGameFactLabel}>Open seats</Text>
                    <Text style={styles.liveGameFactValue}>{hasRunningTable(item.game) ? getRunningAvailableSeats(item.game) : '—'}</Text>
                  </View>
                  <View>
                    <Text style={styles.liveGameFactLabel}>Wait</Text>
                    <Text style={styles.liveGameFactValue}>{item.game.waitlistCount}</Text>
                  </View>
                </View>
                <Ionicons color="#8ca7ff" name="chevron-forward" size={18} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.nowBoardEmpty}>
            <Ionicons color={colors.primary} name="radio-outline" size={22} />
            <View style={styles.nowBoardEmptyCopy}>
              <Text style={styles.nowBoardEmptyTitle}>{emptyInventoryTitle}</Text>
              <Text style={styles.nowBoardEmptyText}>{emptyInventoryCopy}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.spotlightRow}>
        <Pressable accessibilityRole="button" onPress={onBrowseTournaments} style={styles.spotlightCard}>
          <View style={styles.spotlightIcon}>
            <Ionicons color="#8ca7ff" name="calendar-outline" size={20} />
          </View>
          <Text style={styles.spotlightEyebrow}>Review venue listings</Text>
          <Text style={styles.spotlightTitle}>Published events</Text>
          <View style={styles.spotlightFooter}>
            <Text style={styles.spotlightCount}>{openTournamentCount}</Text>
            <Text style={styles.spotlightMeta}>{openTournamentCount === 1 ? 'open interest window' : 'open interest windows'}</Text>
            <Ionicons color="#8ca7ff" name="arrow-forward" size={16} />
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onBrowseClubs} style={styles.spotlightCard}>
          <View style={styles.spotlightMonogram}>
            <Text style={styles.spotlightMonogramText}>O</Text>
          </View>
          <Text style={styles.spotlightEyebrow}>Choose the room</Text>
          <Text style={styles.spotlightTitle}>Current rooms</Text>
          <View style={styles.spotlightFooter}>
            <Text style={styles.spotlightCount}>{clubCount}</Text>
            <Text style={styles.spotlightMeta}>{clubCount === 1 ? 'club' : 'clubs'}</Text>
            <Ionicons color="#8ca7ff" name="arrow-forward" size={16} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export function OrbitJourney() {
  return (
    <View style={styles.journey}>
      <Text style={styles.journeyEyebrow}>A shorter path to the table</Text>
      <Text accessibilityRole="header" style={styles.journeyTitle}>From “I want to play” to a real room.</Text>
      <View style={styles.journeyList}>
        {journeySteps.map((step) => (
          <View key={step.number} style={styles.journeyStep}>
            <Text style={styles.journeyNumber}>{step.number}</Text>
            <View style={styles.journeyCopy}>
              <Text style={styles.journeyStepTitle}>{step.title}</Text>
              <Text style={styles.journeyStepBody}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function OrbitPlayerFaq() {
  const [openItemId, setOpenItemId] = useState<string | null>('browse');
  return (
    <View style={styles.faqSection}>
      <View style={styles.faqIntro}>
        <View style={styles.faqIcon}>
          <Ionicons color="#8ca7ff" name="help-circle-outline" size={23} />
        </View>
        <Text style={styles.faqEyebrow}>Before you go</Text>
        <Text accessibilityRole="header" style={styles.faqTitle}>Straight answers for venue listings.</Text>
      </View>
      <View style={styles.faqList}>
        {faqItems.map((item, index) => {
          const open = openItemId === item.id;
          return (
            <View key={item.id} style={styles.faqItem}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpenItemId((current) => current === item.id ? null : item.id)}
                style={styles.faqTrigger}
              >
                <Text style={styles.faqNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.faqQuestion}>{item.question}</Text>
                <Ionicons color={colors.muted} name={open ? 'remove' : 'add'} size={19} />
              </Pressable>
              {open ? <Text style={styles.faqAnswer}>{item.answer}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function OrbitPlayerFooter() {
  return (
    <View style={styles.footer}>
      <View style={styles.footerBrand}>
        <OrbitMark size={34} />
        <View style={styles.footerBrandCopy}>
          <Text style={styles.footerBrandName}>Orbit</Text>
          <Text style={styles.footerDeveloper}>Developed by Caminus Labs, LLC</Text>
        </View>
      </View>
      <Text style={styles.footerRoutes}>Games · Tournaments · Clubs · My Orbit</Text>
    </View>
  );
}

function PokerTableAtmosphere() {
  return (
    <View pointerEvents="none" style={styles.tableAtmosphere}>
      <LinearGradient colors={['#0f1b32', '#080f1f', '#11182b']} style={styles.tableGradient} />
      <Svg height="100%" viewBox="0 0 360 390" width="100%">
        <Defs>
          <SvgGradient id="tableGlow" x1="0" x2="1" y1="0" y2="1">
            <Stop offset="0" stopColor="#4d7cfe" stopOpacity="0.24" />
            <Stop offset="1" stopColor="#35d3a1" stopOpacity="0.08" />
          </SvgGradient>
        </Defs>
        <Ellipse cx="180" cy="158" fill="#0b1830" rx="152" ry="108" stroke="url(#tableGlow)" strokeWidth="2" />
        <Ellipse cx="180" cy="158" fill="none" rx="125" ry="83" stroke="#6e91ff" strokeOpacity="0.13" />
        <Rect fill="#f2eee6" height="58" opacity="0.14" originX="86" originY="96" rotation="-16" rx="7" width="40" x="66" y="67" />
        <Rect fill="#f2eee6" height="58" opacity="0.1" originX="279" originY="222" rotation="18" rx="7" width="40" x="259" y="193" />
        <Circle cx="60" cy="206" fill="#35d3a1" opacity="0.25" r="14" />
        <Circle cx="302" cy="106" fill="#4d7cfe" opacity="0.28" r="12" />
        <Circle cx="314" cy="119" fill="#a98bff" opacity="0.2" r="9" />
        <Path d="M30 304 C 108 252, 248 348, 338 280" fill="none" stroke="#a98bff" strokeOpacity="0.09" strokeWidth="2" />
      </Svg>
    </View>
  );
}

function OrbitMark({ size = 42 }: { size?: number }) {
  return (
    <Svg accessibilityLabel="Orbit" height={size} viewBox="0 0 1024 1024" width={size}>
      <Rect fill="#10212B" height="1024" rx="176" width="1024" />
      <Path d="M777.5 421.5C755.5 268.5 627.8 165.3 475.2 179.1C309 194.1 181.1 337.2 190.3 506.3C200 686.7 351.2 824.9 530.9 808.3C675.3 794.9 785.5 686.9 798.8 547.9" fill="none" stroke="#F7F2E8" strokeLinecap="round" strokeWidth="38" />
      <Circle cx="774" cy="433" fill="#F7F2E8" r="65" stroke="#10212B" strokeWidth="12" />
      <Circle cx="774" cy="433" fill="#C66A2B" r="36" />
    </Svg>
  );
}
