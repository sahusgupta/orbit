import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PlayerInAppNotification } from '../domain/playerSync';
import { notificationStyles } from '../styles/notificationStyles';
import { colors } from '../styles/playerTheme';

const styles = notificationStyles;

export function InAppNotificationPopup({
  notification,
  onDismiss
}: {
  notification: PlayerInAppNotification;
  onDismiss: () => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.alertToastHost}>
      <View style={styles.alertPopup}>
        <View style={styles.alertPopupIcon}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.alertPopupCopy}>
          <Text style={styles.alertPopupTitle}>{notification.title}</Text>
          <Text style={styles.alertPopupBody}>{notification.body}</Text>
        </View>
        <Pressable accessibilityLabel="Dismiss notification" style={styles.alertPopupClose} onPress={onDismiss}>
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}
