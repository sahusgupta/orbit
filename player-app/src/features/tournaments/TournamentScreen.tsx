import { useState } from 'react';
import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '../../components/PlayerFields';
import { SearchToolbar } from '../../components/PlayerPresentation';
import {
  isTournamentInterestOpen,
  tournamentScopeKey,
  type PlayerClubSnapshot,
  type PlayerTournament,
  type PlayerTournamentInterest,
  type PlayerTournamentRegistration
} from '../../domain/playerSync';
import type { TournamentFilter, TournamentOpportunity } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { tournamentStyles } from './tournamentStyles';
import { eventCardStyles } from './eventCardStyles';

const baseStyles = { ...sharedStyles, ...tournamentStyles, ...eventCardStyles };

export function TournamentScreen({
  query,
  onQueryChange,
  onOpenFilters,
  opportunities,
  hasOrbitAccount,
  readOnly,
  inventoryStatus = 'ready',
  inventoryPartial = false,
  message,
  pendingTournamentKeys,
  onSelectClub,
  onExpressInterest,
  onWithdrawInterest,
  onRegisterTournament,
  tournamentRegistrations = {}
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onOpenFilters: () => void;
  opportunities: TournamentOpportunity[];
  hasOrbitAccount: boolean;
  readOnly: boolean;
  inventoryStatus?: 'idle' | 'loading' | 'ready' | 'error';
  inventoryPartial?: boolean;
  message: string;
  pendingTournamentKeys: string[];
  onSelectClub: (club: PlayerClubSnapshot) => void;
  onExpressInterest: (tournament: PlayerTournament) => void;
  onWithdrawInterest: (tournament: PlayerTournament, interest: PlayerTournamentInterest) => void;
  onRegisterTournament?: (tournament: PlayerTournament) => void;
  tournamentRegistrations?: Record<string, PlayerTournamentRegistration>;
}) {
  const styles = useThemedStyles(baseStyles);
  const loading = inventoryStatus === 'idle' || inventoryStatus === 'loading';
  const listingsReadOnly = readOnly || inventoryStatus !== 'ready';
  const countLabel = opportunities.length && listingsReadOnly ? `${opportunities.length} last loaded`
    : inventoryStatus === 'ready' ? `${opportunities.length} ${inventoryPartial ? 'loaded' : 'found'}` : '';
  return (
    <>
      <SearchToolbar
        value={query}
        onChangeText={onQueryChange}
        placeholder="Search tournaments, clubs, or prizes"
        filterLabel="tournament"
        onOpenFilters={onOpenFilters}
      />

      {!hasOrbitAccount ? (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>Browse without signing in</Text>
          <Text style={styles.muted}>Sign in under Profile to register for free events or express interest in other events.</Text>
        </View>
      ) : null}
      {listingsReadOnly && opportunities.length ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Tournament listings are read-only</Text>
          <Text style={styles.muted}>{loading
            ? 'Showing last loaded tournaments while current listings refresh. Refresh published data before changing tournament interest.'
            : 'Orbit could not confirm the current venue and tournament data. Refresh published data before changing tournament interest.'}</Text>
        </View>
      ) : null}
      {message ? <Text style={styles.tournamentMessage}>{message}</Text> : null}

      {countLabel ? <Text style={styles.muted}>{countLabel}</Text> : null}
      {inventoryStatus === 'ready' && inventoryPartial && opportunities.length ? <Text style={styles.muted}>More tournaments may be available. This list covers only the venues loaded so far.</Text> : null}
      {opportunities.length ? opportunities.map(({ tournament, club, distanceMiles, interest }) => (
        <TournamentCard
          key={tournamentScopeKey(tournament)}
          tournament={tournament}
          interest={interest}
          venueName={club?.club.name}
          distanceMiles={distanceMiles}
          onSelectClub={club ? () => onSelectClub(club) : undefined}
          hasOrbitAccount={hasOrbitAccount}
          readOnly={listingsReadOnly}
          busy={pendingTournamentKeys.includes(tournamentScopeKey(tournament))}
          onExpressInterest={() => onExpressInterest(tournament)}
          onWithdrawInterest={() => interest && onWithdrawInterest(tournament, interest)}
          onRegisterTournament={onRegisterTournament ? () => onRegisterTournament(tournament) : undefined}
          registration={tournamentRegistrations[tournamentScopeKey(tournament)] ?? tournament.registration}
        />
      )) : (
        <View accessibilityRole={loading ? 'progressbar' : inventoryStatus === 'error' ? 'alert' : undefined}
          accessibilityLabel={loading ? 'Loading tournaments' : undefined} style={styles.emptyState}>
          <Text style={styles.cardTitle}>{loading ? 'Loading tournaments' : inventoryStatus === 'error' ? 'Tournament data is unavailable'
            : inventoryPartial ? 'More tournaments may be available' : 'No tournaments found'}</Text>
          <Text style={styles.muted}>{loading ? 'Published events will appear when the refresh completes.'
            : inventoryStatus === 'error' ? 'Reconnect and refresh published data to check upcoming events.'
              : inventoryPartial ? 'This list covers only the venues loaded so far. More published tournaments may be available.'
                : 'Try a different club or interest filter.'}</Text>
        </View>
      )}
    </>
  );
}

type TournamentCardProps = {
  tournament: PlayerTournament;
  interest?: PlayerTournamentInterest;
  venueName?: string;
  distanceMiles?: number | null;
  onSelectClub?: () => void;
  hasOrbitAccount: boolean;
  readOnly: boolean;
  busy: boolean;
  onExpressInterest: () => void;
  onWithdrawInterest: () => void;
  onRegisterTournament?: () => void;
  registration?: PlayerTournamentRegistration;
};

export function TournamentCard(props: TournamentCardProps) {
  return <TournamentCardContent key={tournamentScopeKey(props.tournament)} {...props} />;
}

function TournamentCardContent({
  tournament,
  interest,
  venueName,
  distanceMiles,
  onSelectClub,
  hasOrbitAccount,
  readOnly,
  busy,
  onExpressInterest,
  onWithdrawInterest,
  onRegisterTournament,
  registration
}: TournamentCardProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const [section, setSection] = useState<'Structure' | 'Rules' | 'Request' | null>(null);
  const now = Date.now();
  const interestOpen = isTournamentInterestOpen(tournament, now);
  const activeInterest = interest?.status === 'interested';
  const canWithdraw = Boolean(activeInterest && tournament.withdrawalAllowed && now < Date.parse(tournament.startsAt));
  const registrationMode = tournament.registrationAvailable === true && Boolean(onRegisterTournament);
  const registered = Boolean(registration);
  return (
    <View style={[styles.eventCard, tournament.featured && styles.eventCardFeatured]}>
      <View style={styles.eventTopline}>
        <Text style={styles.eventEyebrow}>{tournament.featured ? 'Featured event' : 'Upcoming event'}</Text>
        <View style={[styles.eventStatus, interestOpen ? styles.eventStatusOpen : styles.eventStatusClosed]}>
          <Text style={styles.eventStatusText}>{registrationMode ? registered ? 'Registered' : interestOpen ? 'Registration open' : 'Registration closed' : interestOpen ? 'Interest open' : 'Interest closed'}</Text>
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.eventTitle}>{tournament.name}</Text>
      <Text style={styles.eventDate}>{formatEventDate(tournament.startsAt)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={venueName ? `View ${venueName}` : 'Tournament host unavailable'}
        accessibilityState={{ disabled: !onSelectClub || readOnly }} disabled={!onSelectClub || readOnly}
        onPress={() => { if (!readOnly) onSelectClub?.(); }} style={styles.eventVenue}>
        <Ionicons name="location-outline" size={17} color={colors.muted} />
        <Text style={styles.eventVenueText}>{venueName || 'Tournament host'}{distanceMiles != null && Number.isFinite(distanceMiles) && distanceMiles >= 0 ? ` · ${distanceMiles.toFixed(1)} mi` : ''}</Text>
        {onSelectClub ? <Ionicons name="chevron-forward" size={15} color={colors.muted} /> : null}
      </Pressable>
      <View style={styles.eventPriceRow}>
        <View style={styles.eventPriceCopy}>
          <Text style={styles.eventBuyIn}>{tournament.buyIn == null ? 'Not published' : `$${tournament.buyIn.toLocaleString()}`}</Text>
          <Text style={styles.eventCaption}>Published buy-in</Text>
        </View>
        {registered || activeInterest ? <View style={styles.eventInterestStatus}><Ionicons name="checkmark-circle" size={17} color={colors.teal} /><Text style={styles.eventInterestStatusText}>{registered ? 'Registered' : 'Interest expressed'}</Text></View> : null}
      </View>
      <View style={styles.eventControls}>
        {(['Structure', 'Rules', 'Request'] as const).map((label) => <Pressable key={label} accessibilityRole="button"
          accessibilityLabel={`${label} for ${tournament.name}`} accessibilityState={{ expanded: section === label }} aria-expanded={section === label}
          onPress={() => setSection((current) => current === label ? null : label)} style={[styles.eventControl, section === label && styles.eventControlOpen]}>
          <Text style={styles.eventControlText}>{label}</Text><Ionicons name={section === label ? 'chevron-up' : 'chevron-down'} size={14} color={colors.muted} />
        </Pressable>)}
      </View>
      {section === 'Structure' ? <View style={styles.eventDetails}>
        <Text accessibilityRole="header" style={styles.eventDetailTitle}>Published structure</Text>
        <View style={styles.eventStats}>
          <View style={styles.eventStat}><Text style={styles.eventStatValue}>{formatPublishedNumber(tournament.startingStack)}</Text><Text style={styles.eventCaption}>Starting chips</Text></View>
          <View style={styles.eventStat}><Text style={styles.eventStatValue}>{tournament.levelMinutes == null ? 'Not published' : `${tournament.levelMinutes} min`}</Text><Text style={styles.eventCaption}>Blind levels</Text></View>
          <View style={styles.eventStat}><Text style={styles.eventStatValue}>{formatPublishedNumber(tournament.entrantCount)}</Text><Text style={styles.eventCaption}>Entrants</Text></View>
        </View>
        <Text style={styles.eventDetailTitle}>Prize pool</Text><Text style={styles.eventBody}>{tournament.prizePoolLabel || 'Not published'}</Text>
        <Text style={styles.eventDetailTitle}>Rebuys · {formatRebuy(tournament)}</Text>
        <Text style={styles.eventBody}>{formatRebuyStructure(tournament)}</Text>
        <Text style={styles.eventBody}>{formatAddOnStructure(tournament)}</Text>
        <Text style={styles.eventBody}>{formatVenueTotals(tournament)}</Text>
      </View> : null}
      {section === 'Rules' ? <View style={styles.eventDetails}>
        <Text accessibilityRole="header" style={styles.eventDetailTitle}>Published rules</Text>
        {tournament.rules.length ? tournament.rules.map((rule) => <Text key={rule} style={styles.eventBody}>• {rule}</Text>)
          : <Text style={styles.eventBody}>Rules have not been published. Confirm the structure with the venue.</Text>}
      </View> : null}
      {section === 'Request' ? <View style={styles.eventDetails}>
        {registrationMode ? <>
          <Text accessibilityRole="header" style={styles.eventDetailTitle}>{registered ? 'Your registration' : 'Free event registration'}</Text>
          <Text style={styles.eventBody}>{registered ? 'You are on the venue’s entrant list. Check in with the venue before play. Contact staff to change your registration.' : 'Join the venue’s entrant list. No entry payment, rebuy payment, or add-on payment is collected in Orbit.'}</Text>
          {!hasOrbitAccount ? <Text style={styles.eventBody}>Sign in under Profile to register.</Text> : null}
          {!registered ? <Pressable accessibilityRole="button"
            accessibilityState={{ disabled: busy || readOnly || !interestOpen || !hasOrbitAccount }}
            disabled={busy || readOnly || !interestOpen || !hasOrbitAccount}
            style={[styles.eventRequestButton, styles.eventRequestButtonPrimary, (busy || readOnly || !interestOpen || !hasOrbitAccount) && styles.disabledAction]}
            onPress={() => { if (!busy && !readOnly && interestOpen && hasOrbitAccount) onRegisterTournament?.(); }}>
            <Ionicons name="ticket-outline" size={18} color={colors.onPrimary} />
            <Text style={[styles.eventRequestText, { color: colors.onPrimary }]}>{readOnly ? 'Refresh required' : busy ? 'Registering…' : interestOpen ? 'Register for free' : 'Registration closed'}</Text>
          </Pressable> : null}
        </> : <>
        <Text accessibilityRole="header" style={styles.eventDetailTitle}>{activeInterest ? 'Your interest' : 'Let the venue know'}</Text>
        <Text style={styles.eventBody}>Expressing interest is nonbinding. It does not register you, guarantee a seat, create a debt, collect payment, or establish prize eligibility. Venue staff separately confirms participation.</Text>
        {activeInterest ? <Text style={styles.eventBody}>This is nonbinding and does not reserve a seat. The venue must confirm entry.</Text> : null}
        {!hasOrbitAccount ? <Text style={styles.eventBody}>Sign in under Profile to express interest.</Text> : null}
        {activeInterest ? canWithdraw || readOnly ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || readOnly }} disabled={busy || readOnly}
          style={[styles.eventRequestButton, (busy || readOnly) && styles.disabledAction]} onPress={() => { if (!busy && !readOnly && canWithdraw) onWithdrawInterest(); }}>
          <Text style={styles.eventRequestText}>{readOnly ? 'Refresh required' : busy ? 'Updating…' : 'Withdraw interest'}</Text>
        </Pressable> : <Text style={styles.eventBody}>Contact the venue to change your interest.</Text> : <Pressable accessibilityRole="button"
          accessibilityState={{ disabled: busy || readOnly || !interestOpen || !hasOrbitAccount }} disabled={busy || readOnly || !interestOpen || !hasOrbitAccount}
          style={[styles.eventRequestButton, styles.eventRequestButtonPrimary, (busy || readOnly || !interestOpen || !hasOrbitAccount) && styles.disabledAction]}
          onPress={() => { if (!busy && !readOnly && interestOpen && hasOrbitAccount) onExpressInterest(); }}>
          <Text style={[styles.eventRequestText, { color: colors.onPrimary }]}>{readOnly ? 'Refresh required' : busy ? 'Updating…' : interestOpen ? 'Express interest' : 'Interest closed'}</Text>
        </Pressable>}
        </>}
      </View> : null}
    </View>
  );
}

function formatPublishedNumber(value?: number) {
  return value == null ? 'Not published' : value.toLocaleString();
}

function formatRebuy(tournament: PlayerTournament) {
  if (tournament.rebuysAllowed === false) return 'Not allowed';
  const price = tournament.rebuyPrice == null ? 'Price not published' : `$${tournament.rebuyPrice.toLocaleString()}`;
  return tournament.unlimitedRebuys === true ? `Unlimited · ${price}` : `${price} · limit not published`;
}

function formatRebuyStructure(tournament: PlayerTournament) {
  if (tournament.rebuysAllowed === false) return 'Rebuys are not allowed.';
  const terms = [
    formatRebuy(tournament),
    tournament.lateRegistrationThroughLevel == null ? 'Closing level not published' : `through Level ${tournament.lateRegistrationThroughLevel}`,
    tournament.rebuyStack == null ? 'Stack not published' : `${tournament.rebuyStack.toLocaleString()} chips`
  ];
  return terms.join(' · ');
}

function formatAddOnStructure(tournament: PlayerTournament) {
  if (tournament.addOnsAllowed === false) return 'Add-ons are not allowed.';
  const price = tournament.addOnPrice == null ? 'Price not published' : `$${tournament.addOnPrice.toLocaleString()}`;
  const stack = tournament.addOnStack == null ? 'Stack not published' : `${tournament.addOnStack.toLocaleString()} chips`;
  return `${price} add-on · ${stack}`;
}

function formatVenueTotals(tournament: PlayerTournament) {
  if (tournament.totalRebuys == null && tournament.totalAddOns == null) return 'Venue totals not published.';
  return `Venue totals: ${formatPublishedNumber(tournament.totalRebuys)} rebuys · ${formatPublishedNumber(tournament.totalAddOns)} add-ons`;
}

export function formatEventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function TournamentFilterControls({
  clubs,
  eventFilter,
  setEventFilter,
  clubFilter,
  setClubFilter
}: {
  clubs: PlayerClubSnapshot[];
  eventFilter: TournamentFilter;
  setEventFilter: (value: TournamentFilter) => void;
  clubFilter: string;
  setClubFilter: (value: string) => void;
}) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Event type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {([
            ['all', 'All events'],
            ['open', 'Interest open'],
            ['free', '$0 published buy-in'],
            ['interested', 'My interests']
          ] as Array<[TournamentFilter, string]>).map(([id, label]) => (
            <Chip key={id} label={label} active={eventFilter === id} onPress={() => setEventFilter(id)} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Club</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          <Chip label="All clubs" active={clubFilter === 'all'} onPress={() => setClubFilter('all')} />
          {clubs.map((club) => (
            <Chip
              key={club.club.id}
              label={club.club.name}
              active={clubFilter === club.club.id}
              onPress={() => setClubFilter(club.club.id)}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
