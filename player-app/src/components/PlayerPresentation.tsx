import React, { useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { DistanceFilter } from '../domain/playerTypes';
import { sharedStyles as styles } from '../styles/sharedStyles';
import { colors } from '../styles/playerTheme';

export function SearchToolbar({
  value,
  onChangeText,
  placeholder,
  filterLabel,
  onOpenFilters
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  filterLabel: string;
  onOpenFilters: () => void;
}) {
  return (
    <View style={styles.searchToolbar}>
      <View style={styles.plainSearchBar}>
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
      </View>
      <Pressable accessibilityLabel={`Show ${filterLabel} filters`} onPress={onOpenFilters} style={styles.plainFiltersButton}>
        <Ionicons name="options-outline" size={18} color={colors.ink} />
        <Text style={styles.plainFiltersText}>Filters</Text>
      </Pressable>
    </View>
  );
}

export function FiltersBottomSheet({
  visible,
  title,
  onClose,
  onReset,
  children
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.filterSheetBackdrop}>
        <Pressable accessibilityLabel={`Dismiss ${title.toLowerCase()}`} onPress={onClose} style={styles.filterSheetDismiss} />
        <View style={styles.filterSheetCard}>
          <View style={styles.filterSheetHandle} />
          <View style={styles.filterSheetHeader}>
            <Pressable accessibilityLabel={`Reset ${title.toLowerCase()}`} onPress={onReset} style={styles.filterSheetHeaderAction}>
              <Text style={styles.filterSheetResetText}>Reset</Text>
            </Pressable>
            <Text style={styles.filterSheetTitle}>{title}</Text>
            <Pressable accessibilityLabel={`Apply ${title.toLowerCase()}`} onPress={onClose} style={[styles.filterSheetHeaderAction, styles.filterSheetDoneAction]}>
              <Text style={styles.filterSheetDoneText}>Done</Text>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.filterSheetContent}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function DistanceFilterControl({ value, onChange }: { value: DistanceFilter; onChange: (value: DistanceFilter) => void }) {
  return (
    <View style={styles.sheetField}>
      <Text style={styles.fieldLabel}>Distance</Text>
      <View style={styles.distanceRow}>
        {([
          { value: 'none' as const, label: 'All' },
          { value: 5 as const, label: '5 mi' },
          { value: 10 as const, label: '10 mi' },
          { value: 20 as const, label: '20 mi' },
          { value: 50 as const, label: '50 mi' }
        ]).map((option) => (
          <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.distanceChip, value === option.value && styles.distanceChipActive]}>
            <Text style={[styles.distanceChipText, value === option.value && styles.distanceChipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function IconActionButton({
  icon,
  label,
  onPress,
  active,
  disabled
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.iconActionButton, active && styles.iconActionButtonActive, disabled && styles.iconActionButtonDisabled]}
    >
      <Ionicons name={icon} size={19} color={active ? '#ffffff' : disabled ? colors.muted : colors.primary} />
      {hovered && !disabled ? (
        <View pointerEvents="none" style={styles.iconTooltip}>
          <Text style={styles.iconTooltipText}>{label}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function AnimatedSurface({ children, style }: { children: React.ReactNode; style?: object | object[] }) {
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const animate = (toScale: number, toLift: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: toScale, friction: 7, tension: 120, useNativeDriver: false }),
      Animated.spring(lift, { toValue: toLift, friction: 8, tension: 90, useNativeDriver: false })
    ]).start();
  };

  return (
    <Animated.View
      onTouchStart={() => animate(0.992, 1)}
      onTouchEnd={() => animate(1, 0)}
      style={[
        style,
        {
          transform: [
            { scale },
            {
              translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] })
            }
          ],
          shadowOpacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.16] })
        }
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function AnimatedButton({
  children,
  onPress,
  style,
  disabled,
  variant
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: object | object[];
  disabled?: boolean;
  variant: 'primary' | 'soft';
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const animate = (toScale: number, toGlow: number) => {
    Animated.parallel([
      Animated.spring(scale, { toValue: toScale, friction: 5, tension: 160, useNativeDriver: false }),
      Animated.spring(glow, { toValue: toGlow, friction: 7, tension: 90, useNativeDriver: false })
    ]).start();
  };

  return (
    <Animated.View
      style={[
        {
          transform: [{ scale }],
          shadowOpacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.08, variant === 'primary' ? 0.22 : 0.14] })
        },
        styles.animatedButtonShadow
      ]}
    >
      <Pressable
        disabled={disabled}
        onHoverIn={() => animate(1.025, 1)}
        onHoverOut={() => animate(1, 0)}
        onPress={onPress}
        onPressIn={() => animate(0.97, 1)}
        onPressOut={() => animate(1, 0)}
        style={style}
      >
        {variant === 'primary' ? (
          <LinearGradient colors={disabled ? ['#94a3b8', '#7f8ea3'] : ['#0B1020', '#4D7CFE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonGradient}>
            {children}
          </LinearGradient>
        ) : (
          children
        )}
      </Pressable>
    </Animated.View>
  );
}
export function SimpleMenuRow({
  icon,
  title,
  subtitle,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.simpleMenuRow}>
      <View style={styles.simpleMenuIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View>
      <View style={styles.simpleMenuCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.muted}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
