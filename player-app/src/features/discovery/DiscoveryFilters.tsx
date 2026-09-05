import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, Field } from '../../components/PlayerFields';
import { isCasinoClub } from '../../domain/discovery';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import type { CasinoFilter, GameTypeFilter, MapVenueFilter } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function DiscoverySearchModal({
  visible,
  value,
  onChangeText,
  onClose
}: {
  visible: boolean;
  value: string;
  onChangeText: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.discoverySearchBackdrop}>
        <Pressable accessibilityLabel="Close game search" accessibilityRole="button" onPress={onClose} style={styles.filterSheetDismiss} />
        <View style={styles.discoverySearchPopup}>
          <View style={styles.discoverySearchHeader}>
            <Text style={styles.discoverySearchTitle}>Search games</Text>
            <Pressable accessibilityLabel="Close game search" accessibilityRole="button" onPress={onClose} style={styles.discoverySearchClose}>
              <Ionicons name="close" size={21} color="#9aabd0" />
            </Pressable>
          </View>
          <View style={styles.discoverySearchInputShell}>
            <Ionicons name="search-outline" size={20} color="#7184aa" />
            <TextInput
              autoFocus
              value={value}
              onChangeText={onChangeText}
              onSubmitEditing={onClose}
              returnKeyType="search"
              placeholder="Games, clubs, or stakes"
              placeholderTextColor="#7184aa"
              selectionColor={colors.primary}
              style={styles.discoverySearchInput}
            />
            {value ? (
              <Pressable accessibilityLabel="Clear game search" accessibilityRole="button" onPress={() => onChangeText('')} style={styles.discoverySearchClose}>
                <Ionicons name="close-circle" size={20} color="#7184aa" />
              </Pressable>
            ) : null}
          </View>
          <Pressable accessibilityLabel="Apply game search" accessibilityRole="button" onPress={onClose} style={styles.discoverySearchDone}>
            <Text style={styles.discoverySearchDoneText}>Show results</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function GameFilterPanel({
  clubs,
  gameType,
  setGameType,
  selectedClubId,
  setSelectedClubId,
  selectedCasinoId,
  setSelectedCasinoId,
  stakes,
  setStakes,
  fitScoreEnabled,
  setFitScoreEnabled,
}: {
  clubs: PlayerClubSnapshot[];
  gameType: GameTypeFilter;
  setGameType: (value: GameTypeFilter) => void;
  selectedClubId: string;
  setSelectedClubId: (value: string) => void;
  selectedCasinoId: CasinoFilter;
  setSelectedCasinoId: (value: CasinoFilter) => void;
  stakes: string;
  setStakes: (value: string) => void;
  fitScoreEnabled: boolean;
  setFitScoreEnabled: (value: boolean) => void;
}) {
  const typeOptions: Array<{ id: GameTypeFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'card-house', label: 'Card house' },
    { id: 'favorites', label: 'Favorites' }
  ];
  const cardHouseClubs = clubs.filter((club) => !isCasinoClub(club));
  const casinoClubs = clubs.filter(isCasinoClub);
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Game type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {typeOptions.map((option) => (
            <Chip key={option.id} label={option.label} active={gameType === option.id} onPress={() => setGameType(gameType === option.id ? 'none' : option.id)} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Card House</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.cardHouseScroller}
          contentContainerStyle={styles.filterChipRow}
        >
          <Chip
            label="All houses"
            active={selectedClubId === 'all'}
            onPress={() => setSelectedClubId(selectedClubId === 'all' ? 'none' : 'all')}
          />
          {cardHouseClubs.map((club) => (
            <Chip
              key={club.club.id}
              label={club.club.name}
              active={selectedClubId === club.club.id}
              onPress={() => setSelectedClubId(selectedClubId === club.club.id ? 'none' : club.club.id)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Casino</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          style={styles.cardHouseScroller}
          contentContainerStyle={styles.filterChipRow}
        >
          <Chip
            label="All casinos"
            active={selectedCasinoId === 'all'}
            onPress={() => setSelectedCasinoId(selectedCasinoId === 'all' ? 'none' : 'all')}
          />
          {casinoClubs.map((club) => (
            <Chip
              key={club.club.id}
              label={club.club.name}
              active={selectedCasinoId === club.club.id}
              onPress={() => setSelectedCasinoId(selectedCasinoId === club.club.id ? 'none' : club.club.id)}
            />
          ))}
        </ScrollView>
      </View>
      <View style={styles.filterGrid}>
        <Field label="Stakes" value={stakes} onChangeText={setStakes} />
      </View>
      <Pressable
        style={[styles.lockedFilterRow, fitScoreEnabled && styles.lockedFilterRowActive]}
        onPress={() => setFitScoreEnabled(!fitScoreEnabled)}
      >
        <Ionicons name="analytics-outline" size={16} color={fitScoreEnabled ? colors.teal : colors.muted} />
        <Text style={styles.lockedFilterText}>Sort by my preferences</Text>
      </Pressable>
    </View>
  );
}

export function MapFilterControls({
  venue,
  setVenue
}: {
  venue: MapVenueFilter;
  setVenue: (value: MapVenueFilter) => void;
}) {
  const options: Array<{ id: MapVenueFilter; label: string }> = [
    { id: 'all', label: 'All places' },
    { id: 'card-house', label: 'Card houses' },
    { id: 'casino', label: 'Casinos' },
    { id: 'club', label: 'Poker clubs' }
  ];
  return (
    <View style={styles.filterPanel}>
      <View style={styles.sheetField}>
        <Text style={styles.fieldLabel}>Venue type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
          {options.map((option) => (
            <Chip key={option.id} label={option.label} active={venue === option.id} onPress={() => setVenue(option.id)} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
