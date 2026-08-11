import { useState, type ComponentProps } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { sharedStyles as styles } from '../styles/sharedStyles';
import { colors } from '../styles/playerTheme';

export function Field({
  label,
  value,
  onChangeText,
  tone,
  keyboardType,
  onSubmit,
  error,
  placeholder
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  tone?: 'light';
  keyboardType?: ComponentProps<typeof TextInput>['keyboardType'];
  onSubmit?: () => void;
  error?: string;
  placeholder?: string;
}) {
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
        placeholderTextColor={tone === 'light' ? 'rgba(255,255,255,0.56)' : colors.muted}
        returnKeyType={onSubmit ? 'next' : 'done'}
        keyboardType={keyboardType}
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
export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}
