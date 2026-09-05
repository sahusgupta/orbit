import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { parseGovernmentIdBarcode, type ScannedGovernmentId } from '../../domain/governmentId';
import type { PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { settingsStyles } from './settingsStyles';

const cameraStyles = StyleSheet.create({
  cameraShell: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#111827' },
  camera: { height: 280, width: '100%' },
  cameraGuide: {
    position: 'absolute', top: 62, right: 24, bottom: 62, left: 24,
    borderWidth: 2, borderColor: '#ffffff', borderRadius: 14
  },
  cameraCaption: {
    position: 'absolute', right: 16, bottom: 14, left: 16,
    color: '#ffffff', textAlign: 'center', fontWeight: '700'
  },
  previewCard: {
    gap: 10, padding: 16, borderWidth: 1, borderColor: '#dbe5ec',
    borderRadius: 16, backgroundColor: '#f8fafc'
  },
  previewTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  detailRow: { gap: 2 },
  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  detailValue: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  ageNotice: { color: '#b42318', fontWeight: '700' },
  captureActions: { gap: 8 }
});

const styles = { ...sharedStyles, ...settingsStyles, ...cameraStyles };

export function IdentityVerificationScreen({
  status,
  signedIn,
  busy,
  message,
  requiredMinimumAge,
  onBack,
  onOpenSettings,
  onSignIn,
  onStart,
  onRefresh
}: {
  status: PlayerIdentityStatus;
  signedIn: boolean;
  busy: boolean;
  message: string;
  requiredMinimumAge: 18 | 21;
  onBack: () => void;
  onOpenSettings: () => void;
  onSignIn: () => void;
  onStart: (details: Pick<ScannedGovernmentId, 'fullName' | 'dateOfBirth' | 'address'>) => void | Promise<void>;
  onRefresh: () => void | Promise<unknown>;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedIdentity, setScannedIdentity] = useState<ScannedGovernmentId | null>(null);
  const [scanMessage, setScanMessage] = useState('');
  const approved = status.reviewStatus === 'approved' && status.ageLevel >= requiredMinimumAge;
  const provisional = status.status === 'provisional' && status.ageEligible && status.ageLevel >= requiredMinimumAge;
  const capturedAgeUnavailable = Boolean(scannedIdentity && scannedIdentity.age == null);
  const capturedUnderage = scannedIdentity?.age != null && scannedIdentity.age < requiredMinimumAge;
  const persistedBelowRequirement = status.ageLevel > 0 && status.ageLevel < requiredMinimumAge;
  const underage = status.status === 'underage' || persistedBelowRequirement || capturedUnderage;

  const handleBarcode = ({ data }: BarcodeScanningResult) => {
    const parsed = parseGovernmentIdBarcode(data);
    if (!parsed) {
      setScanMessage('That barcode did not include a complete name, date of birth, and address. Try again in better light.');
      return;
    }
    setScannedIdentity(parsed);
    setScanMessage('Review the details read from the ID before continuing.');
  };

  const confirmCapture = async () => {
    if (!scannedIdentity || capturedUnderage || capturedAgeUnavailable) return;
    await onStart({
      fullName: scannedIdentity.fullName,
      dateOfBirth: scannedIdentity.dateOfBirth,
      address: scannedIdentity.address
    });
  };

  return (
    <View style={[styles.accountCard, styles.identityCard]}>
      <View style={styles.identityIcon}>
        <Ionicons
          name={approved ? 'checkmark-circle' : underage ? 'alert-circle-outline' : provisional ? 'time-outline' : 'scan-outline'}
          size={34}
          color={approved ? colors.teal : underage ? '#b42318' : colors.primary}
        />
      </View>
      <View style={styles.identityCopy}>
        <Text style={styles.sectionTitle}>
          {approved
            ? 'ID approved'
            : provisional
              ? 'Physical ID review pending'
              : underage
                ? 'Age requirement not met'
                : `Scan your ID to confirm ${requiredMinimumAge}+`}
        </Text>
        <Text style={styles.muted}>
          {approved
            ? 'Identity and age verification approved.'
            : provisional
              ? 'You may continue sharing nonbinding tournament interest and sending membership or waitlist requests. Venue staff must check the physical ID on your first visit.'
            : underage
              ? `This venue action requires players to be age ${requiredMinimumAge} or older.`
              : 'Use the camera on the PDF417 barcode on the back of a government-issued ID. Orbit reads the name, date of birth, and address on this device.'}
        </Text>
      </View>
      {!signedIn ? (
        <Pressable onPress={onSignIn} style={[styles.primaryButton, styles.fullWidthButton]}>
          <Text style={styles.primaryButtonText}>Sign in to continue</Text>
        </Pressable>
      ) : provisional || approved ? (
        <>
          {status.verifiedDetails ? <IdentityPreview identity={status.verifiedDetails} ageLabel={`${status.ageLevel}+ eligibility confirmed`} /> : null}
          <Pressable onPress={onBack} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void onRefresh()} style={styles.secondaryActionButton}>
            <Text style={styles.secondaryActionText}>Check review status</Text>
          </Pressable>
        </>
      ) : scannedIdentity ? (
        <>
          <IdentityPreview identity={scannedIdentity} />
          {capturedUnderage ? <Text style={styles.ageNotice}>This ID does not meet the {requiredMinimumAge}+ requirement.</Text> : null}
          {capturedAgeUnavailable ? <Text style={styles.ageNotice}>Orbit could not calculate an age from this date of birth. Scan the ID again.</Text> : null}
          <View style={styles.captureActions}>
            <Pressable
              disabled={busy || capturedUnderage || capturedAgeUnavailable}
              onPress={() => void confirmCapture()}
              style={[styles.primaryButton, styles.fullWidthButton, (busy || capturedUnderage || capturedAgeUnavailable) && styles.disabledAction]}
            >
              <Text style={styles.primaryButtonText}>{busy ? 'Saving details...' : 'Use these ID details'}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setScannedIdentity(null); setScanMessage(''); }} style={styles.secondaryActionButton}>
              <Text style={styles.secondaryActionText}>Scan again</Text>
            </Pressable>
          </View>
        </>
      ) : Platform.OS === 'web' ? (
        <Text style={styles.actionStatus}>ID barcode scanning is available in the Orbit Player iOS and Android apps.</Text>
      ) : permission?.granted ? (
        <View style={styles.cameraShell}>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ['pdf417'] }}
            facing="back"
            onBarcodeScanned={handleBarcode}
            style={styles.camera}
          />
          <View pointerEvents="none" style={styles.cameraGuide} />
          <Text style={styles.cameraCaption}>Center the barcode inside the frame</Text>
        </View>
      ) : permission && permission.canAskAgain === false ? (
        <View style={styles.captureActions}>
          <Text style={styles.muted}>Camera access is blocked in device settings. Orbit cannot scan the PDF417 barcode until you enable camera access there.</Text>
          <Pressable onPress={onOpenSettings} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Text style={styles.primaryButtonText}>Open device settings</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => void requestPermission()} style={[styles.primaryButton, styles.fullWidthButton]}>
          <Text style={styles.primaryButtonText}>Allow camera access</Text>
        </Pressable>
      )}
      {scanMessage ? <Text style={styles.actionStatus}>{scanMessage}</Text> : null}
      {message ? <Text style={styles.actionStatus}>{message}</Text> : null}
      <Pressable onPress={onBack} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>{provisional || approved ? 'Back' : 'Not now'}</Text>
      </Pressable>
      <Text style={styles.identityPrivacy}>
        Orbit does not take or retain an ID photo. The raw barcode and ID number stay on this device and are discarded after reading. Orbit sends your name, date of birth, address, and an opaque request identifier. The server records the capture method/time, calculated age eligibility and level, review status, and audit timestamps. Those verification details and statuses may be shared with a venue when you request its age-restricted services.
      </Text>
    </View>
  );
}

function IdentityPreview({
  identity,
  ageLabel
}: {
  identity: Pick<ScannedGovernmentId, 'fullName' | 'dateOfBirth' | 'address'> & Partial<Pick<ScannedGovernmentId, 'age'>>;
  ageLabel?: string;
}) {
  return (
    <View style={styles.previewCard}>
      <Text style={styles.previewTitle}>ID details</Text>
      <IdentityDetail label="Name" value={identity.fullName} />
      <IdentityDetail label="Date of birth" value={identity.dateOfBirth} />
      <IdentityDetail label="Address" value={identity.address} />
      <IdentityDetail label="Age" value={ageLabel ?? (identity.age == null ? 'Unavailable' : String(identity.age))} />
    </View>
  );
}

function IdentityDetail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}
