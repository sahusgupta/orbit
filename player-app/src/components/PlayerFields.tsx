import { usePlayerTheme, useThemedStyles } from '../styles/PlayerThemeProvider';
import { useState, type ComponentProps } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { sharedStyles as baseStyles } from '../styles/sharedStyles';
import { colors } from '../styles/playerTheme';

export function Field({
  label,
  value,
  onChangeText,
  tone,
  keyboardType,
  onSubmit,
  error,
  placeholder,
  editable = true
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  tone?: 'light';
  keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
  onSubmit?: () => void;
  error?: string;
  placeholder?: string;
  editable?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const [touched, setTouched] = useState(false);
  const visibleError = touched ? error : '';
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, tone === 'light' && styles.fieldLabelLight]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={() => setTouched(true)}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === 'Enter') onSubmit?.();
        }}
        onSubmitEditing={onSubmit}
        placeholder={placeholder ?? label}
        placeholderTextColor={colors.muted}
        returnKeyType={onSubmit ? 'next' : 'done'}
        keyboardType={keyboardType}
        editable={editable}
        accessibilityLabel={label}
        accessibilityHint={visibleError || undefined}
        style={[styles.input, tone === 'light' && styles.inputLight, Boolean(visibleError) && styles.inputError]}
      />
      {visibleError ? (
        <Text accessibilityLiveRegion="polite" style={[styles.fieldError, tone === 'light' && styles.fieldErrorLight]}>{visibleError}</Text>
      ) : null}
    </View>
  );
}
export function Chip({ label, active, disabled = false, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  const styles = useThemedStyles(baseStyles);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}
