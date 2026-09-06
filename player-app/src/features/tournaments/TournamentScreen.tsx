import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '../../components/PlayerFields';
import { SearchToolbar } from '../../components/PlayerPresentation';
import {
  isTournamentInterestOpen,
  tournamentScopeKey,
  type PlayerClubSnapshot,
  type PlayerTournament,
  type PlayerTournamentInterest
} from '../../domain/playerSync';
import type { TournamentFilter, TournamentOpportunity } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { tournamentStyles } from './tournamentStyles';

const styles = { ...sharedStyles, ...tournamentStyles };

export function TournamentScreen({
  query,
  onQueryChange,
  onOpenFilters,
  opportunities,
  hasOrbitAccount,
  readOnly,
  message,
  pendingTournamentKeys,
  onSelectClub,
  onExpressInterest,
  onWithdrawInterest
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onOpenFilters: () => void;
  opportunities: TournamentOpportunity[];
  hasOrbitAccount: boolean;
  readOnly: boolean;
  message: string;
  pendingTournamentKeys: string[];
  onSelectClub: (club: PlayerClubSnapshot) => void;
  onExpressInterest: (tournament: PlayerTournament) => void;
  onWithdrawInterest: (tournament: PlayerTournament, interest: PlayerTournamentInterest) => void;
}) {
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
          <Text style={styles.muted}>Sign in under Profile when you want to express nonbinding interest to a venue.</Text>
        </View>
      ) : null}
      {readOnly && opportunities.length ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Tournament listings are read-only</Text>
          <Text style={styles.muted}>Orbit could not confirm the current venue catalog. Refresh published data before changing tournament interest.</Text>
        </View>
      ) : null}
      <Text style={styles.muted}>Expressing interest is nonbinding. It does not register you, guarantee a seat, create a debt, collect payment, or establish prize eligibility. Venue staff separately confirms participation.</Text>
      {message ? <Text style={styles.tournamentMessage}>{message}</Text> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Upcoming tournaments</Text>
        <Text style={styles.muted}>{opportunities.length} found</Text>
      </View>
      {opportunities.length ? Array.from(new Set(opportunities.map((item) => item.tournament.clubId))).map((clubId) => {
        const listings = opportunities.filter((item) => item.tournament.clubId === clubId);
        const club = listings[0]?.club;
        const distance = listings[0]?.distanceMiles;
        return (
          <View style={styles.tournamentClubSection} key={clubId}>
            <Pressable
              disabled={!club || readOnly}
              style={styles.tournamentClubHeader}
              onPress={() => {
                if (club) onSelectClub(club);
              }}
            >
              <View>
                <Text style={styles.cardTitle}>{club?.club.name ?? 'Tournament host'}</Text>
                <Text style={styles.muted}>
                  {club
                    ? [distance == null ? null : `${distance.toFixed(1)} mi`, club.club.address ?? 'Address unavailable'].filter(Boolean).join(' · ')
                    : 'Club details unavailable'}
                </Text>
              </View>
              {club ? <Ionicons name="chevron-forward" size={19} color={colors.muted} /> : null}
            </Pressable>
            {listings.map(({ tournament, interest }) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                interest={interest}
                hasOrbitAccount={hasOrbitAccount}
                readOnly={readOnly}
                busy={pendingTournamentKeys.includes(tournamentScopeKey(tournament))}
                onExpressInterest={() => onExpressInterest(tournament)}
                onWithdrawInterest={() => interest && onWithdrawInterest(tournament, interest)}
              />
            ))}
          </View>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No tournaments found</Text>
          <Text style={styles.muted}>Try a different club or interest filter.</Text>
        </View>
      )}
    </>
  );
}

export function TournamentCard({
  tournament,
  interest,
  hasOrbitAccount,
  readOnly,
  busy,
  onExpressInterest,
  onWithdrawInterest
}: {
  tournament: PlayerTournament;
  interest?: PlayerTournamentInterest;
  hasOrbitAccount: boolean;
  readOnly: boolean;
  busy: boolean;
  onExpressInterest: () => void;
  onWithdrawInterest: () => void;
}) {
  const now = Date.now();
  const interestOpen = isTournamentInterestOpen(tournament, now);
  const activeInterest = interest?.status === 'interested';
  const canWithdraw = Boolean(activeInterest && tournament.withdrawalAllowed && now < Date.parse(tournament.startsAt));
  return (
    <View style={[styles.tournamentCard, tournament.featured && styles.tournamentCardFeatured]}>
      <View style={styles.tournamentTitleRow}>
        <View style={styles.tournamentIcon}><Ionicons name="trophy-outline" size={22} color={colors.primary} /></View>
        <View style={styles.clubMain}>
          <Text style={styles.cardTitle}>{tournament.name}</Text>
          <Text style={styles.muted}>{formatEventDate(tournament.startsAt)}</Text>
        </View>
        <View style={[styles.statusPill, interestOpen ? styles.tournamentOpenPill : styles.tournamentClosedPill]}>
          <Text style={styles.statusText}>{interestOpen ? 'Interest open' : 'Interest closed'}</Text>
        </View>
      </View>
      <Text style={styles.tournamentPrize}>{tournament.buyIn == null ? 'BUY-IN NOT PUBLISHED' : `$${tournament.buyIn.toLocaleString()} VENUE-PUBLISHED BUY-IN`}</Text>
      <View style={styles.tournamentMoneyGrid}>
        <View style={styles.tournamentMoneyItem}>
          <Text style={styles.tournamentStatLabel}>Buy-in</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.buyIn == null ? 'Not published' : `$${tournament.buyIn.toLocaleString()}`}</Text>
        </View>
        <View style={styles.tournamentMoneyItem}>
          <Text style={styles.tournamentStatLabel}>Rebuys</Text>
          <Text style={styles.tournamentMoneyValue}>{formatRebuy(tournament)}</Text>
        </View>
        <View style={[styles.tournamentMoneyItem, styles.tournamentMoneyItemWide]}>
          <Text style={styles.tournamentStatLabel}>Prize pool</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.prizePoolLabel || 'Not published'}</Text>
        </View>
      </View>
      <View style={styles.tournamentStats}>
        <View><Text style={styles.tournamentStatValue}>{formatPublishedNumber(tournament.startingStack)}</Text><Text style={styles.tournamentStatLabel}>Starting chips</Text></View>
        <View><Text style={styles.tournamentStatValue}>{tournament.levelMinutes == null ? 'Not published' : `${tournament.levelMinutes} min`}</Text><Text style={styles.tournamentStatLabel}>Blind levels</Text></View>
        <View><Text style={styles.tournamentStatValue}>{formatPublishedNumber(tournament.entrantCount)}</Text><Text style={styles.tournamentStatLabel}>Entrants</Text></View>
      </View>
      <View style={styles.tournamentStructure}>
        <Text style={styles.cardTitle}>Structure</Text>
        <Text style={styles.muted}>{formatRebuyStructure(tournament)}</Text>
        <Text style={styles.muted}>{formatAddOnStructure(tournament)}</Text>
        <Text style={styles.muted}>{formatVenueTotals(tournament)}</Text>
      </View>
      {tournament.rules.length ? (
        <View style={styles.tournamentRules}>
          <Text style={styles.cardTitle}>Published rules</Text>
          {tournament.rules.map((rule) => <Text key={rule} style={styles.tournamentRule}>• {rule}</Text>)}
        </View>
      ) : <Text style={styles.muted}>Rules have not been published. Confirm the structure with the venue.</Text>}
      {activeInterest ? (
        <View style={styles.tournamentConfirmation}>
          <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
          <View style={styles.clubMain}>
            <Text style={styles.cardTitle}>Interest expressed</Text>
            <Text style={styles.muted}>This is nonbinding and does not reserve a seat. The venue must confirm entry.</Text>
          </View>
        </View>
      ) : null}
      {activeInterest ? (
        canWithdraw || readOnly ? (
          <Pressable disabled={busy || readOnly} style={[styles.secondaryActionButton, (busy || readOnly) && styles.disabledAction]} onPress={onWithdrawInterest}>
            <Text style={styles.secondaryActionText}>{readOnly ? 'Refresh required' : busy ? 'Updating…' : 'Withdraw interest'}</Text>
          </Pressable>
        ) : null
      ) : (
        <Pressable disabled={busy || readOnly || !interestOpen || !hasOrbitAccount} style={[styles.compactButton, (busy || readOnly || !interestOpen || !hasOrbitAccount) && styles.disabledAction]} onPress={onExpressInterest}>
          <Text style={styles.compactButtonText}>{readOnly ? 'Refresh required' : busy ? 'Updating…' : interestOpen ? 'Express interest' : 'Interest closed'}</Text>
        </Pressable>
      )}
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
