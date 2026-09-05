import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, Text, View, type DimensionValue } from 'react-native';
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
import { PlayerAmbientFlow } from '../home/PlayerLandingExperience';
import { onboardingStyles } from './onboardingStyles';

const styles = { ...sharedStyles, ...onboardingStyles };

export function OnboardingScreen({
  draftPlayer,
  onboardingStep,
  setDraftPlayer,
  setOnboardingStep,
  onComplete
}: {
  draftPlayer: PlayerAccount;
  onboardingStep: OnboardingStep;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  onComplete: () => void;
}) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, styles.onboardingSafeArea]}>
        <StatusBar style="light" />
        <AnimatedGradientBackground />
        <ScrollView style={styles.onboardingShell} contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}>
          <OnboardingFlow
            draftPlayer={draftPlayer}
            onboardingStep={onboardingStep}
            setDraftPlayer={setDraftPlayer}
            setOnboardingStep={setOnboardingStep}
            onComplete={onComplete}
          />
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
function OnboardingFlow({
  draftPlayer,
  onboardingStep,
  setDraftPlayer,
  setOnboardingStep,
  onComplete
}: {
  draftPlayer: PlayerAccount;
  onboardingStep: OnboardingStep;
  setDraftPlayer: React.Dispatch<React.SetStateAction<PlayerAccount>>;
  setOnboardingStep: React.Dispatch<React.SetStateAction<OnboardingStep>>;
  onComplete: () => void;
}) {
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const [hoveredAction, setHoveredAction] = useState<'previous' | null>(null);
  const finalStep = 3;
  const totalSteps = finalStep + 1;
  const phoneTrimmed = (draftPlayer.phone ?? '').trim();
  const normalizedPhone = normalizeE164Phone(phoneTrimmed);
  const emailIsValid = isValidEmail(draftPlayer.email);
  const phoneIsValid = !phoneTrimmed || Boolean(normalizedPhone);
  const hasAuthenticatedContact = emailIsValid || Boolean(normalizedPhone);
  const canComplete = Boolean(draftPlayer.name.trim() && hasAuthenticatedContact && phoneIsValid && hasAdultDeclaration(draftPlayer));
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
  const previousStep = () => moveToStep(Math.max(0, onboardingStep - 1) as OnboardingStep);
  const finishOnboarding = () => {
    Animated.timing(stepOpacity, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false
    }).start(onComplete);
  };
  const submitStep = onboardingStep < finalStep ? nextStep : finishOnboarding;
  const canSubmit = onboardingStep < finalStep ? canContinue : canComplete;

  useEffect(() => {
    if (
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
  }, [canSubmit, submitStep]);

  return (
    <View style={styles.onboardingFlow}>
      <View style={styles.onboardingTopBar}>
        <View>
          <Text style={styles.onboardingBrand}>ORBIT</Text>
          <Text style={styles.onboardingBrandSubtle}>PLAYER</Text>
        </View>
        <OnboardingProgress activeStep={onboardingStep} totalSteps={totalSteps} />
      </View>

      <Text style={styles.onboardingTitle}>Find room-published games and send requests</Text>

      <AnimatedStepCard stepKey={onboardingStep} opacity={stepOpacity}>
        {onboardingStep === 0 ? <NameStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 1 ? <EmailStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
        {onboardingStep === 2 ? <PhoneStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={submitStep} /> : null}
        {onboardingStep === 3 ? <HomeAreaStep draftPlayer={draftPlayer} setDraftPlayer={setDraftPlayer} onSubmit={canSubmit ? submitStep : undefined} /> : null}
      </AnimatedStepCard>

      <View style={styles.onboardingActions}>
        <Pressable
          onHoverIn={() => setHoveredAction('previous')}
          onHoverOut={() => setHoveredAction(null)}
          onPress={onboardingStep > 0 ? previousStep : undefined}
          disabled={onboardingStep === 0}
          style={styles.arrowAction}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
          {hoveredAction === 'previous' && onboardingStep > 0 ? (
            <View pointerEvents="none" style={styles.iconTooltip}>
              <Text style={styles.iconTooltipText}>Previous step</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onPress={submitStep}
          style={[styles.onboardingNextAction, !canSubmit && styles.arrowActionDisabled]}
        >
          <Text style={styles.onboardingNextActionText}>{onboardingStep < finalStep ? 'Continue' : 'Start exploring'}</Text>
          <Ionicons name="arrow-forward" size={18} color="#ffffff" />
        </Pressable>
      </View>
    </View>
  );
}

function AnimatedGradientBackground() {
  return (
    <View style={styles.animatedGradientRoot}>
      <PlayerAmbientFlow />
      <View style={styles.orbitPattern} pointerEvents="none">
        <View style={styles.orbitHalo}>
          <View style={styles.orbitRing} />
          <View style={[styles.orbitNode, styles.orbitNodeOne]} />
          <View style={[styles.orbitNode, styles.orbitNodeTwo]} />
          <View style={[styles.orbitNode, styles.orbitNodeThree]} />
          <View style={[styles.orbitNode, styles.orbitNodeFour]} />
        </View>
      </View>
      <View style={styles.gradientShade} />
    </View>
  );
}

function OnboardingProgress({ activeStep, totalSteps }: { activeStep: number; totalSteps: number }) {
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
      <Text style={styles.optionalStepText}>Optional. {e164PhoneRequirement} Used only for phone sign-in and account contact when you choose those options; game and waitlist updates stay inside Orbit.</Text>
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
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: declared }}
        onPress={() => setDraftPlayer((current) => declared
          ? { ...current, adultDeclaredAt: undefined, adultDeclarationVersion: undefined }
          : { ...current, adultDeclaredAt: new Date().toISOString(), adultDeclarationVersion })}
        style={styles.secondaryActionButton}
      >
        <Ionicons name={declared ? 'checkbox' : 'square-outline'} size={20} color={declared ? colors.teal : colors.primaryDark} />
        <Text style={styles.secondaryActionText}>I confirm that I am 18 or older</Text>
      </Pressable>
      <Text style={styles.optionalStepText}>Orbit is for adults. Individual venues may require players to be 21 or older and may check physical ID for age-restricted access.</Text>
    </View>
  );
}
