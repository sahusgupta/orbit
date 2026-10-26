import { usePlayerTheme, useThemedStyles } from '../styles/PlayerThemeProvider';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { sharedStyles as baseStyles } from '../styles/sharedStyles';
import { colors } from '../styles/playerTheme';

export function connectionErrorCopy(error: string, destination: 'Match' | 'published games'): string {
  return /\b(?:fetch failed|failed to fetch|network request failed)\b/i.test(error)
    ? `Could not connect to ${destination}. Try again shortly.`
    : error;
}

function useReducedMotionSetting() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);
  return reducedMotion;
}

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
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return (
    <View style={styles.searchToolbar}>
      <View style={styles.plainSearchBar}>
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel={placeholder}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
      </View>
      <Pressable accessibilityLabel={`Show ${filterLabel} filters`} accessibilityRole="button" onPress={onOpenFilters} style={styles.plainFiltersButton}>
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
  doneAccessibilityLabel,
  children
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onReset?: () => void;
  doneAccessibilityLabel?: string;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(baseStyles);
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.filterSheetBackdrop}>
        <Pressable accessibilityLabel={`Dismiss ${title.toLowerCase()}`} accessibilityRole="button" onPress={onClose} style={styles.filterSheetDismiss} />
        <View accessibilityViewIsModal style={styles.filterSheetCard}>
          <View style={styles.filterSheetHandle} />
          <View style={styles.filterSheetHeader}>
            {onReset ? <Pressable accessibilityLabel={`Reset ${title.toLowerCase()}`} accessibilityRole="button" onPress={onReset} style={styles.filterSheetHeaderAction}>
              <Text style={styles.filterSheetResetText}>Reset</Text>
            </Pressable> : <View style={styles.filterSheetHeaderAction} />}
            <Text style={styles.filterSheetTitle}>{title}</Text>
            <Pressable accessibilityLabel={doneAccessibilityLabel ?? `Apply ${title.toLowerCase()}`} accessibilityRole="button" onPress={onClose} style={[styles.filterSheetHeaderAction, styles.filterSheetDoneAction]}>
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
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.iconActionButton, active && styles.iconActionButtonActive, disabled && styles.iconActionButtonDisabled]}
    >
      <Ionicons name={icon} size={19} color={active ? colors.onPrimary : disabled ? colors.muted : colors.primary} />
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
  const reducedMotion = useReducedMotionSetting();

  const animate = (toScale: number, toLift: number) => {
    if (reducedMotion) {
      scale.setValue(1);
      lift.setValue(0);
      return;
    }
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
  const styles = useThemedStyles(baseStyles);
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotionSetting();

  const animate = (toScale: number, toGlow: number) => {
    if (reducedMotion) {
      scale.setValue(1);
      glow.setValue(0);
      return;
    }
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
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onHoverIn={() => animate(1.025, 1)}
        onHoverOut={() => animate(1, 0)}
        onPress={onPress}
        onPressIn={() => animate(0.97, 1)}
        onPressOut={() => animate(1, 0)}
        style={style}
      >
        {variant === 'primary' ? <View style={styles.buttonGradient}>{children}</View> : children}
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
  subtitle?: string;
  onPress: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return (
    <Pressable accessibilityLabel={title} accessibilityRole="button" onPress={onPress} style={styles.simpleMenuRow}>
      <View style={styles.simpleMenuIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View>
      <View style={styles.simpleMenuCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
