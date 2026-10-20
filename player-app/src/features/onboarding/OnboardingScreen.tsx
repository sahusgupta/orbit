import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type DimensionValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Field } from '../../components/PlayerFields';
import { isValidEmail } from '../../domain/discovery';
import { adultDeclarationVersion, hasAdultDeclaration } from '../../domain/playerOnboarding';
import { e164PhoneExample, e164PhoneRequirement, normalizeE164Phone } from '../../domain/playerPhone';
import type { PlayerAccount } from '../../domain/playerSync';
import type { OnboardingStep } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { onboardingStyles } from './onboardingStyles';

const baseStyles = { ...sharedStyles, ...onboardingStyles };

export type OnboardingAccountConnection = {
  connected: boolean;
  email: string;
  password: string;
  status: string;
  busy: boolean;
  onChangeEmail: (email: string) => void;
  onChangePassword: (password: string) => void;
  onConnect: (profile: PlayerAccount, withMatchPreferences?: boolean, intent?: 'create' | 'signIn') => void;
  onRecover: () => void;
};

export function OnboardingScreen({
  draftPlayer,
  onboardingStep,
  setDraftPlayer,
  setOnboardingStep,
  onComplete,
  onCompleteWithMatchPreferences,
  onTryDemo,
  accountConnection
}: {
  draftPlayer: PlayerAccount;
  onboardingStep: OnboardingStep;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  onComplete: () => void;
  onCompleteWithMatchPreferences?: () => void;
  onTryDemo?: () => void;
  accountConnection?: OnboardingAccountConnection;
}) {
  const styles = useThemedStyles(baseStyles);
  const { statusBarStyle } = usePlayerTheme();
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, styles.onboardingSafeArea]}>
        <StatusBar style={statusBarStyle} />
        <AnimatedGradientBackground />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.onboardingViewport}>
        <ScrollView style={styles.onboardingShell} contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <OnboardingFlow
            draftPlayer={draftPlayer}
            onboardingStep={onboardingStep}
            setDraftPlayer={setDraftPlayer}
            setOnboardingStep={setOnboardingStep}
            onComplete={onComplete}
            onCompleteWithMatchPreferences={onCompleteWithMatchPreferences}
            onTryDemo={onTryDemo}
            accountConnection={accountConnection}
          />
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
function OnboardingFlow({
  draftPlayer,
  onboardingStep,
  setDraftPlayer,
  setOnboardingStep,
  onComplete,
  onCompleteWithMatchPreferences,
  onTryDemo,
  accountConnection
}: {
  draftPlayer: PlayerAccount;
  onboardingStep: OnboardingStep;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  onComplete: () => void;
  onCompleteWithMatchPreferences?: () => void;
  onTryDemo?: () => void;
  accountConnection?: OnboardingAccountConnection;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const [hoveredAction, setHoveredAction] = useState<'previous' | null>(null);
  const [entryStage, setEntryStage] = useState<'welcome' | 'profile' | 'credentials'>(
    accountConnection && !accountConnection.connected ? 'welcome' : 'profile'
  );
  const [accountIntent, setAccountIntent] = useState<'create' | 'signIn'>('create');
  const [withMatchPreferences, setWithMatchPreferences] = useState(false);
  const finalStep = 3;
  const totalSteps = finalStep + 1;
  const phoneTrimmed = (draftPlayer.phone ?? '').trim();
  const normalizedPhone = normalizeE164Phone(phoneTrimmed);
  const emailIsValid = isValidEmail(draftPlayer.email);
  const phoneIsValid = !phoneTrimmed || Boolean(normalizedPhone);
  const hasAuthenticatedContact = emailIsValid || Boolean(normalizedPhone);
  const canComplete = Boolean(draftPlayer.name.trim() && hasAuthenticatedContact && phoneIsValid && hasAdultDeclaration(draftPlayer));
  const canGoBack = onboardingStep > 0 || Boolean(accountConnection && !accountConnection.connected);
  const canContinue =
    onboardingStep === 0 ? Boolean(draftPlayer.name.trim()) :
    onboardingStep === 1 ? emailIsValid :
    onboardingStep === 2 ? phoneIsValid :
    true;
  const moveToStep = (step: OnboardingStep) => {
    Animated.timing(stepOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start(() => {
      setOnboardingStep(step);
      stepOpacity.setValue(0);
      Animated.timing(stepOpacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }).start();
    });
  };
  const nextStep = () => moveToStep(Math.min(finalStep, onboardingStep + 1) as OnboardingStep);
  const previousStep = () => onboardingStep === 0 && accountConnection && !accountConnection.connected
    ? setEntryStage('welcome')
    : moveToStep(Math.max(0, onboardingStep - 1) as OnboardingStep);
  const finishOnboarding = (complete: () => void) => {
    if (!canComplete || onboardingStep !== finalStep) return;
    if (accountConnection && !accountConnection.connected) {
      accountConnection.onChangeEmail(draftPlayer.email);
      setWithMatchPreferences(complete === onCompleteWithMatchPreferences);
      setEntryStage('credentials');
      return;
    }
    Animated.timing(stepOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start(complete);
  };
  const submitStep = onboardingStep < finalStep ? nextStep : () => finishOnboarding(onComplete);
  const canSubmit = onboardingStep < finalStep ? canContinue : canComplete;

  useEffect(() => {
    if (accountConnection?.connected) setEntryStage('profile');
  }, [accountConnection?.connected]);

  useEffect(() => {
    if (
      entryStage !== 'profile' ||
      Platform.OS !== 'web' ||
      typeof window === 'undefined' ||
      typeof window.addEventListener !== 'function' ||
      typeof window.removeEventListener !== 'function'
    ) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;
      if (event.key !== 'Enter' || isTypingTarget || !canSubmit) return;
      event.preventDefault();
      submitStep();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canSubmit, submitStep, entryStage]);

  if (entryStage === 'welcome' && accountConnection) {
    return <OnboardingWelcome onCreate={() => { setAccountIntent('create'); setEntryStage('profile'); }}
      onSignIn={() => { setAccountIntent('signIn'); setEntryStage('credentials'); }} onTryDemo={onTryDemo} />;
  }

  if (entryStage === 'credentials' && accountConnection) {
    return <OnboardingCredentials connection={accountConnection} intent={accountIntent} draftPlayer={draftPlayer}
      setDraftPlayer={setDraftPlayer} withMatchPreferences={withMatchPreferences}
      onBack={() => setEntryStage(accountIntent === 'create' ? 'profile' : 'welcome')} />;
  }

  return (
    <View style={styles.onboardingFlow}>
      <View style={styles.onboardingTopBar}>
        <View>
          <Text style={styles.onboardingBrand}>ORBIT</Text>
          <Text style={styles.onboardingBrandSubtle}>PLAYER</Text>
        </View>
        <OnboardingProgress activeStep={onboardingStep} totalSteps={totalSteps} />
      </View>

      <Text accessibilityRole="header" style={styles.onboardingTitle}>Set up your profile</Text>

      {onTryDemo && !accountConnection ? (
        <View style={styles.optionalStep}>
          <Pressable accessibilityRole="button" onPress={onTryDemo} style={styles.onboardingNextAction}>
            <Ionicons name="play-circle-outline" size={21} color={colors.onPrimary} />
            <Text style={styles.onboardingNextActionText}>Try demo account</Text>
          </Pressable>
          <Text style={styles.optionalStepText}>Explore fictional games at different locations. No sign-in required.</Text>
        </View>
      ) : null}

      <View style={styles.onboardingCenter}>
      <AnimatedStepCard stepKey={onboardingStep} opacity={stepOpacity}>
        {onboardingStep === 0 ? <NameStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 1 ? <EmailStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 2 ? <PhoneStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={submitStep} /> : null}
        {onboardingStep === 3 ? <HomeAreaStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
      </AnimatedStepCard>
      </View>

      <View style={styles.onboardingFooter}>
      <View style={styles.onboardingActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous step"
          accessibilityState={{ disabled: !canGoBack }}
          onHoverIn={() => setHoveredAction('previous')}
          onHoverOut={() => setHoveredAction(null)}
          onPress={canGoBack ? previousStep : undefined}
          disabled={!canGoBack}
          style={styles.arrowAction}
        >
          <Ionicons name="arrow-back" size={24} color={colors.ink} />
          {hoveredAction === 'previous' && onboardingStep > 0 ? (
            <View pointerEvents="none" style={styles.iconTooltip}>
              <Text style={styles.iconTooltipText}>Previous step</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={onboardingStep < finalStep ? 'Continue' : accountConnection && !accountConnection.connected ? 'Continue to account' : 'Start exploring'}
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          onPress={submitStep}
          style={[styles.onboardingNextAction, !canSubmit && styles.arrowActionDisabled]}
        >
          <Text style={styles.onboardingNextActionText}>{onboardingStep < finalStep ? 'Continue' : accountConnection && !accountConnection.connected ? 'Continue to account' : 'Start exploring'}</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
        </Pressable>
      </View>
      {onboardingStep === finalStep && onCompleteWithMatchPreferences ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="Set Match preferences"
        accessibilityState={{ disabled: !canComplete }}
        disabled={!canComplete}
        onPress={() => finishOnboarding(onCompleteWithMatchPreferences)}
        style={[styles.secondaryActionButton, !canComplete && styles.arrowActionDisabled]}
      ><Text style={styles.secondaryActionText}>Set Match preferences</Text></Pressable> : null}
      </View>
    </View>
  );
}

function OnboardingWelcome({ onCreate, onSignIn, onTryDemo }: {
  onCreate: () => void;
  onSignIn: () => void;
  onTryDemo?: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return <View style={styles.onboardingFlow}>
    <View><Text style={styles.onboardingBrand}>ORBIT</Text><Text style={styles.onboardingBrandSubtle}>PLAYER</Text></View>
    <View style={styles.onboardingCenter}>
      <View style={styles.welcomeArtwork}><Ionicons name="planet-outline" size={80} color={colors.primary} /></View>
      <Text accessibilityRole="header" style={styles.onboardingTitle}>Find your next game</Text>
      <Text style={styles.optionalStepText}>Create an account to connect with venues, or explore with a demo.</Text>
    </View>
    <View style={styles.onboardingFooter}>
      <Pressable accessibilityRole="button" onPress={onCreate} style={styles.onboardingNextAction}>
        <Ionicons name="person-add-outline" size={21} color={colors.onPrimary} /><Text style={styles.onboardingNextActionText}>Create account</Text>
      </Pressable>
      {onTryDemo ? <Pressable accessibilityRole="button" onPress={onTryDemo} style={[styles.secondaryActionButton, styles.onboardingIconAction]}>
        <Ionicons name="play-circle-outline" size={21} color={colors.ink} /><Text style={styles.secondaryActionText}>Try demo account</Text>
      </Pressable> : null}
      <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>Already have an account? Sign in</Text>
      </Pressable>
    </View>
  </View>;
}

function OnboardingCredentials({ connection, intent, draftPlayer, setDraftPlayer, withMatchPreferences, onBack }: {
  connection: OnboardingAccountConnection;
  intent: 'create' | 'signIn';
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  withMatchPreferences: boolean;
  onBack: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const canConnect = isValidEmail(connection.email) && connection.password.length >= 12 && hasAdultDeclaration(draftPlayer) && !connection.busy;
  const connect = () => {
    if (canConnect) connection.onConnect({ ...draftPlayer, email: connection.email.trim().toLowerCase() }, withMatchPreferences, intent);
  };
  return <View style={styles.onboardingFlow}>
    <View style={styles.onboardingTopBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={connection.busy} onPress={onBack} style={styles.arrowAction}>
        <Ionicons name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      <Text style={styles.onboardingBrand}>ORBIT</Text>
    </View>
    <Text accessibilityRole="header" style={styles.onboardingTitle}>{intent === 'create' ? 'Create your account' : 'Welcome back'}</Text>
    <View style={styles.onboardingCenter}>
      <View style={styles.credentialFields}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email address</Text>
          <TextInput accessibilityLabel="Account email address" value={connection.email} onChangeText={connection.onChangeEmail}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address" editable={!connection.busy} style={styles.input}
            placeholder="you@example.com" placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Password or passphrase</Text>
          <TextInput accessibilityLabel="Account password or passphrase" value={connection.password} onChangeText={connection.onChangePassword}
            autoCapitalize="none" autoComplete={intent === 'create' ? 'new-password' : 'current-password'} secureTextEntry editable={!connection.busy}
            onSubmitEditing={connect} returnKeyType="go" style={styles.input} placeholder="At least 12 characters" placeholderTextColor={colors.muted} />
        </View>
        {intent === 'signIn' ? <AdultDeclaration draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} disabled={connection.busy} /> : null}
        {connection.status ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.optionalStepText}>{connection.status}</Text> : null}
      </View>
    </View>
    <View style={styles.onboardingFooter}>
      <Text style={styles.optionalStepText}>{intent === 'create' ? 'Verify your email, then sign in to finish saving your profile.' : 'Sign in to restore your saved Orbit profile.'}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canConnect }} disabled={!canConnect} onPress={connect}
        style={[styles.onboardingNextAction, !canConnect && styles.arrowActionDisabled]}>
        <Ionicons name="lock-closed-outline" size={20} color={colors.onPrimary} />
        <Text style={styles.onboardingNextActionText}>{connection.busy ? 'Connecting...' : intent === 'create' ? 'Create account / sign in' : 'Sign in'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={connection.busy || !isValidEmail(connection.email)} onPress={connection.onRecover} style={styles.secondaryActionButton}>
        <Text style={styles.secondaryActionText}>Forgot password</Text>
      </Pressable>
    </View>
  </View>;
}

function AnimatedGradientBackground() {
  const styles = useThemedStyles(baseStyles);
  return (
    <View pointerEvents="none" style={styles.animatedGradientRoot} />
  );
}

function OnboardingProgress({ activeStep, totalSteps }: { activeStep: number; totalSteps: number }) {
  const styles = useThemedStyles(baseStyles);
  const progress = `${Math.round(((activeStep + 1) / totalSteps) * 100)}%` as DimensionValue;
  return (
    <View style={styles.onboardingProgressShell}>
      <View style={styles.onboardingProgressTrack}>
        <View style={[styles.onboardingProgressFill, { width: progress }]} />
      </View>
    </View>
  );
}

function AnimatedStepCard({ stepKey, children, opacity }: { stepKey: number; children: React.ReactNode; opacity?: Animated.Value }) {
  const styles = useThemedStyles(baseStyles);
  const fade = useRef(new Animated.Value(1)).current;
  const visibleOpacity = opacity ?? fade;

  useEffect(() => {
    if (opacity) return;
    fade.setValue(0);
    Animated.spring(fade, {
      toValue: 1,
      friction: 8,
      tension: 80,
      useNativeDriver: false
    }).start();
  }, [fade, opacity, stepKey]);

  return (
    <Animated.View
      style={[
        styles.onboardingStepSurface,
        {
          opacity: visibleOpacity,
          transform: [
            {
              translateY: visibleOpacity.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0]
              })
            }
          ]
        }
      ]}
    >
      {children}
    </Animated.View>
  );
}

function NameStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  return (
    <Field label="Name" placeholder="Your name" tone="light" value={draftPlayer.name} onChangeText={(name) => setDraftPlayer((current) => ({ ...current, name }))} onSubmit={onSubmit} />
  );
}

function EmailStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  return (
    <Field
      label="Email"
      placeholder="you@example.com"
      tone="light"
      value={draftPlayer.email}
      keyboardType="email-address"
      onChangeText={(email) => setDraftPlayer((current) => ({ ...current, email }))}
      onSubmit={onSubmit}
      error={draftPlayer.email.trim() && !isValidEmail(draftPlayer.email) ? 'Enter a valid email like name@example.com.' : ''}
    />
  );
}

function PhoneStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  return (
    <View style={styles.optionalStep}>
      <Field
        label="Phone Number"
        placeholder={e164PhoneExample}
        tone="light"
        value={draftPlayer.phone ?? ''}
        keyboardType="phone-pad"
        onChangeText={(phone) => setDraftPlayer((current) => ({ ...current, phone: normalizeE164Phone(phone) || phone }))}
        onSubmit={onSubmit}
        error={(draftPlayer.phone ?? '').trim() && !normalizeE164Phone(draftPlayer.phone) ? `Enter a valid phone number. ${e164PhoneRequirement}` : ''}
      />
      <Text style={styles.optionalStepText}>Optional account contact. {e164PhoneRequirement} Sign in with email; game and waitlist updates stay inside Orbit.</Text>
    </View>
  );
}

function HomeAreaStep({
  draftPlayer,
  setDraftPlayer,
  onSubmit
}: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  onSubmit?: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const declared = hasAdultDeclaration(draftPlayer);
  return (
    <View style={styles.optionalStep}>
      <Field
        label="Home Area"
        placeholder="City or neighborhood"
        tone="light"
        value={draftPlayer.homeLocation ?? ''}
        onChangeText={(homeLocation) => setDraftPlayer((current) => ({ ...current, homeLocation }))}
        onSubmit={declared ? onSubmit : undefined}
      />
      <AdultDeclaration draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} />
      <Text style={styles.optionalStepText}>Orbit is for adults. Individual venues may require players to be 21 or older and may check physical ID for age-restricted access.</Text>
    </View>
  );
}

function AdultDeclaration({ draftPlayer, setDraftPlayer, disabled = false }: {
  draftPlayer: PlayerAccount;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  disabled?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const declared = hasAdultDeclaration(draftPlayer);
  return <Pressable accessibilityRole="checkbox" accessibilityLabel="I confirm that I am 18 or older"
    accessibilityState={{ checked: declared, disabled }} disabled={disabled}
    onPress={() => setDraftPlayer((current) => declared
      ? { ...current, adultDeclaredAt: undefined, adultDeclarationVersion: undefined }
      : { ...current, adultDeclaredAt: new Date().toISOString(), adultDeclarationVersion })}
    style={styles.adultDeclaration}>
    <Ionicons name={declared ? 'checkbox' : 'square-outline'} size={22} color={declared ? colors.teal : colors.muted} />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={styles.adultDeclarationText}>I am 18 or older</Text>
  </Pressable>;
}
