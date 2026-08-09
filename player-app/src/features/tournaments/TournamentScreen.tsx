import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip } from '../../components/PlayerFields';
import { DistanceFilterControl, SearchToolbar } from '../../components/PlayerPresentation';
import type {
  PlayerClubSnapshot,
  PlayerTournament,
  PlayerTournamentRegistration
} from '../../domain/playerSync';
import type { DistanceFilter, TournamentFilter, TournamentOpportunity } from '../../domain/playerTypes';
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
  message,
  onSelectClub,
  onRegister,
  onUnregister
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onOpenFilters: () => void;
  opportunities: TournamentOpportunity[];
  hasOrbitAccount: boolean;
  message: string;
  onSelectClub: (club: PlayerClubSnapshot) => void;
  onRegister: (tournament: PlayerTournament) => void;
  onUnregister: (tournament: PlayerTournament, registration: PlayerTournamentRegistration) => void;
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

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Upcoming tournaments</Text>
        <Text style={styles.muted}>{opportunities.length} found</Text>
      </View>
      {opportunities.length ? Array.from(new Set(opportunities.map((item) => item.tournament.clubId))).map((clubId) => {
        const listings = opportunities.filter((item) => item.tournament.clubId === clubId);
        const club = listings[0]?.club;
        return (
          <View style={styles.tournamentClubSection} key={clubId}>
            <Pressable
              disabled={!club}
              style={styles.tournamentClubHeader}
              onPress={() => {
                if (!club) return;
                onSelectClub(club);
              }}
            >
              <View>
                <Text style={styles.cardTitle}>{club?.club.name ?? 'Tournament host'}</Text>
                <Text style={styles.muted}>{club ? `${listings[0].distanceMiles.toFixed(1)} mi · ${club.club.address ?? 'Address unavailable'}` : 'Club details unavailable'}</Text>
              </View>
              {club ? <Ionicons name="chevron-forward" size={19} color={colors.muted} /> : null}
            </Pressable>
            {listings.map(({ tournament, registration }) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                registration={registration}
                hasOrbitAccount={hasOrbitAccount}
                message={message}
                onRegister={() => onRegister(tournament)}
                onUnregister={() => registration && onUnregister(tournament, registration)}
              />
            ))}
          </View>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No tournaments found</Text>
          <Text style={styles.muted}>Try a different club, distance, or registration filter.</Text>
        </View>
      )}
    </>
  );
}

export function TournamentCard({
  tournament,
  registration,
  hasOrbitAccount,
  message,
  onRegister,
  onUnregister
}: {
  tournament: PlayerTournament;
  registration?: PlayerTournamentRegistration;
  hasOrbitAccount: boolean;
  message: string;
  onRegister: () => void;
  onUnregister: () => void;
}) {
  const registrationOpen = tournament.registrationStatus === 'open' && Date.now() < Date.parse(tournament.registrationClosesAt);
  const canUnregister = Boolean(registration && tournament.unregisterAllowed && Date.now() < Date.parse(tournament.startsAt));
  const liveEntrants = Math.max(tournament.entrantCount, registration ? 1 : 0);
  return (
    <View style={[styles.tournamentCard, tournament.featured && styles.tournamentCardFeatured]}>
      <View style={styles.tournamentTitleRow}>
        <View style={styles.tournamentIcon}><Ionicons name="trophy-outline" size={22} color={colors.primary} /></View>
        <View style={styles.clubMain}>
          <Text style={styles.cardTitle}>{tournament.name}</Text>
          <Text style={styles.muted}>{formatEventDate(tournament.startsAt)}</Text>
        </View>
        <View style={[styles.statusPill, registrationOpen ? styles.tournamentOpenPill : styles.tournamentClosedPill]}>
          <Text style={styles.statusText}>{registrationOpen ? 'Open' : 'Closed'}</Text>
        </View>
      </View>
      <Text style={styles.tournamentPrize}>{tournament.buyIn === 0 ? 'FREE ENTRY · FREEROLL' : `$${tournament.buyIn} ENTRY`}</Text>
      <View style={styles.tournamentMoneyGrid}>
        <View style={styles.tournamentMoneyItem}>
          <Text style={styles.tournamentStatLabel}>Buy-in</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.buyIn === 0 ? 'Free' : `$${tournament.buyIn.toLocaleString()}`}</Text>
        </View>
        <View style={styles.tournamentMoneyItem}>
          <Text style={styles.tournamentStatLabel}>Rebuys</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.unlimitedRebuys ? `Unlimited · $${tournament.rebuyPrice}` : 'Not allowed'}</Text>
        </View>
        <View style={[styles.tournamentMoneyItem, styles.tournamentMoneyItemWide]}>
          <Text style={styles.tournamentStatLabel}>Prize pool</Text>
          <Text style={styles.tournamentMoneyValue}>{tournament.prizePoolLabel}</Text>
        </View>
      </View>
      <View style={styles.tournamentStats}>
        <View><Text style={styles.tournamentStatValue}>{tournament.startingStack.toLocaleString()}</Text><Text style={styles.tournamentStatLabel}>Starting chips</Text></View>
        <View><Text style={styles.tournamentStatValue}>{tournament.levelMinutes} min</Text><Text style={styles.tournamentStatLabel}>Blind levels</Text></View>
        <View><Text style={styles.tournamentStatValue}>{liveEntrants}</Text><Text style={styles.tournamentStatLabel}>Entrants</Text></View>
      </View>
      <View style={styles.tournamentStructure}>
        <Text style={styles.cardTitle}>Structure</Text>
        <Text style={styles.muted}>Unlimited ${tournament.rebuyPrice} rebuys through Level {tournament.lateRegistrationThroughLevel} · {tournament.rebuyStack.toLocaleString()} chips each</Text>
        <Text style={styles.muted}>${tournament.addOnPrice} add-on after late registration · {tournament.addOnStack.toLocaleString()} chips</Text>
        <Text style={styles.muted}>Live: {tournament.totalRebuys} rebuys · {tournament.totalAddOns} add-ons</Text>
      </View>
      <View style={styles.tournamentRules}>
        <Text style={styles.cardTitle}>Rules</Text>
        {tournament.rules.map((rule) => <Text key={rule} style={styles.tournamentRule}>• {rule}</Text>)}
      </View>
      {registration ? (
        <View style={styles.tournamentConfirmation}>
          <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
          <View style={styles.clubMain}><Text style={styles.cardTitle}>Registration confirmed</Text><Text style={styles.muted}>Status: {registration.status.replace(/-/g, ' ')}</Text></View>
        </View>
      ) : null}
      {!hasOrbitAccount ? <Text style={styles.tournamentMessage}>Sign in with your email address or phone number under Profile to register.</Text> : null}
      {message ? <Text style={styles.tournamentMessage}>{message}</Text> : null}
      {registration ? (
        canUnregister ? <Pressable style={styles.secondaryActionButton} onPress={onUnregister}><Text style={styles.secondaryActionText}>Unregister</Text></Pressable> : null
      ) : (
        <Pressable disabled={!registrationOpen || !hasOrbitAccount} style={[styles.compactButton, (!registrationOpen || !hasOrbitAccount) && styles.disabledAction]} onPress={onRegister}>
          <Text style={styles.compactButtonText}>{registrationOpen ? 'Register free' : 'Registration closed'}</Text>
        </Pressable>
      )}
    </View>
  );
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
  setClubFilter,
  distance,
  setDistance
}: {
  clubs: PlayerClubSnapshot[];
  eventFilter: TournamentFilter;
  setEventFilter: (value: TournamentFilter) => void;
  clubFilter: string;
  setClubFilter: (value: string) => void;
  distance: DistanceFilter;
  setDistance: (value: DistanceFilter) => void;
}) {
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Event type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {([
            ['all', 'All events'],
            ['open', 'Registration open'],
            ['free', 'Freerolls'],
            ['registered', 'My entries']
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
      <DistanceFilterControl value={distance} onChange={setDistance} />
    </View>
  );
}
