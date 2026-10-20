/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeTextContrast } from '../test-utils/nativeContrast';
import { PlayerThemeProvider, playerPalettes, resolvePlayerStyles, usePlayerTheme, useThemedStyles } from './PlayerThemeProvider';
import { colors } from './playerTheme';
import { sharedStyles } from './sharedStyles';
import { onboardingStyles } from '../features/onboarding/onboardingStyles';
import { clubStyles } from '../features/clubs/clubStyles';
import { settingsStyles } from '../features/settings/settingsStyles';
import { playerHomeStyles } from '../features/home/playerHomeStyles';
import { notificationStyles } from './notificationStyles';
import { discoveryStyles } from '../features/discovery/discoveryStyles';

const appearance = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' | null, listeners: new Set<() => void>(), remove: vi.fn() }));
vi.mock('react-native', () => ({ StyleSheet: { create: <T,>(value: T) => value, absoluteFill: {} }, Platform: { OS: 'ios' }, Appearance: {
  getColorScheme: () => appearance.scheme,
  addChangeListener: (listener: () => void) => { appearance.listeners.add(listener); return { remove: () => { appearance.listeners.delete(listener); appearance.remove(); } }; }
} }));
const base = {
  page: { backgroundColor: colors.canvas, padding: 16 }, panel: { backgroundColor: colors.panel },
  title: { color: colors.ink }, muted: { color: colors.muted }, primary: { backgroundColor: colors.primary },
  primaryText: { color: colors.primaryDark }, primaryButtonText: { color: '#ffffff' },
  membershipQrCode: { backgroundColor: '#ffffff' }, cameraCaption: { color: '#ffffff' },
  cameraShell: { backgroundColor: '#111827' }, qrActionButton: { backgroundColor: colors.primaryDark }, qrActionText: { color: '#ffffff' }
};
describe('player system theme', () => {
  afterEach(() => { document.body.replaceChildren(); appearance.listeners.clear(); appearance.remove.mockClear(); });
  it('resolves immutable light/dark semantic styles while preserving QR/camera contrast and layout', () => {
    const copy = structuredClone(base);
    const light = resolvePlayerStyles(base, 'light');
    const dark = resolvePlayerStyles(base, 'dark');
    expect(light.page).toEqual({ backgroundColor: playerPalettes.light.canvas, padding: 16 });
    expect(light.title.color).toBe(playerPalettes.light.ink);
    expect(light.primaryText.color).toBe(playerPalettes.light.onPrimary);
    expect(dark.primaryButtonText.color).toBe(playerPalettes.dark.onPrimary);
    expect(light.membershipQrCode.backgroundColor).toBe('#ffffff');
    expect(light.cameraCaption.color).toBe('#ffffff');
    expect(light.cameraShell.backgroundColor).toBe('#111827');
    expect(light.qrActionButton.backgroundColor).toBe(colors.primaryDark);
    expect(light.qrActionText.color).toBe('#ffffff');
    expect(base).toEqual(copy);
  });
  it('follows real OS scheme changes, updates contrast and native chrome, and removes the listener', async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    appearance.scheme = 'light';
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    function Probe() {
      const theme = usePlayerTheme(), styles = useThemedStyles(base);
      return <div data-scheme={theme.scheme} data-status-bar={theme.statusBarStyle} style={styles.page}>
        <div style={styles.panel}><span data-ink style={styles.title}>Game details</span><span data-muted style={styles.muted}>Published seats</span></div>
        <button style={styles.primary}><span data-primary style={styles.primaryText}>Save game</span></button>
      </div>;
    }
    await act(async () => { root.render(<PlayerThemeProvider><Probe /></PlayerThemeProvider>); });
    expect(container.querySelector('[data-scheme]')?.getAttribute('data-scheme')).toBe('light');
    expect(container.querySelector('[data-status-bar]')?.getAttribute('data-status-bar')).toBe('dark');
    for (const selector of ['[data-ink]', '[data-muted]', '[data-primary]']) expect(nativeTextContrast(container.querySelector(selector))).toBeGreaterThanOrEqual(4.5);
    act(() => { appearance.scheme = 'dark'; appearance.listeners.forEach((changed) => changed()); });
    expect(container.querySelector('[data-scheme]')?.getAttribute('data-scheme')).toBe('dark');
    expect(container.querySelector('[data-status-bar]')?.getAttribute('data-status-bar')).toBe('light');
    for (const selector of ['[data-ink]', '[data-muted]', '[data-primary]']) expect(nativeTextContrast(container.querySelector(selector))).toBeGreaterThanOrEqual(4.5);
    act(() => root.unmount());
    expect(appearance.listeners.size).toBe(0); expect(appearance.remove).toHaveBeenCalledOnce();
  });
  it.each(['light', 'dark'] as const)('keeps Home/Profile/membership/onboarding/notification style paint readable in %s', (scheme) => {
    const shared = resolvePlayerStyles(sharedStyles, scheme), home = resolvePlayerStyles(playerHomeStyles, scheme),
      onboarding = resolvePlayerStyles(onboardingStyles, scheme), clubs = resolvePlayerStyles(clubStyles, scheme),
      profile = resolvePlayerStyles(settingsStyles, scheme), notifications = resolvePlayerStyles(notificationStyles, scheme), discovery = resolvePlayerStyles(discoveryStyles, scheme);
    const container = document.createElement('div'); container.style.backgroundColor = playerPalettes[scheme].canvas; document.body.appendChild(container);
    const paint = (name: string, foreground: { color?: unknown }, background: { backgroundColor?: unknown }) => {
      const panel = document.createElement('div'), text = document.createElement('span'); panel.style.backgroundColor = typeof background.backgroundColor === 'string' ? background.backgroundColor : 'transparent';
      text.style.color = typeof foreground.color === 'string' ? foreground.color : ''; text.textContent = name; panel.appendChild(text); container.appendChild(panel);
      expect(nativeTextContrast(text), name).toBeGreaterThanOrEqual(4.5);
    };
    paint('Home greeting', home.greeting, {});
    paint('Profile title', profile.profileName, {});
    paint('Profile description', shared.muted, {});
    paint('Membership venue', clubs.membershipWalletClub, clubs.membershipWalletCard);
    paint('Membership plan', clubs.membershipWalletPlan, clubs.membershipWalletCard);
    paint('Membership check-in copy', clubs.checkedInText, clubs.checkedInBand);
    paint('QR title outside the scannable white code', clubs.membershipQrTitle, clubs.membershipQrShell);
    paint('QR member name', clubs.membershipQrMember, clubs.membershipQrShell);
    paint('QR action', clubs.qrActionText, clubs.qrActionButton);
    paint('Onboarding title', onboarding.onboardingTitle, onboarding.onboardingSafeArea);
    paint('Onboarding primary action', onboarding.onboardingNextActionText, onboarding.onboardingNextAction);
    paint('Notification title', notifications.alertPopupTitle, notifications.alertPopup);
    paint('Notification body', notifications.alertPopupBody, notifications.alertPopup);
    paint('Legacy Search/Filters toolbar', discovery.discoveryToolbarText, discovery.discoveryToolbarButton);
    paint('Current request status', discovery.myGameStatusLabel, discovery.myGameStatusBand);
    paint('Current request status detail', discovery.myGameStatusDetail, discovery.myGameStatusBand);
    paint('Club monogram', shared.clubAvatarText, { backgroundColor: playerPalettes[scheme].primarySoft });
    const selectedNavigation = resolvePlayerStyles({ activeTabText: { color: colors.primary } }, scheme);
    paint('Selected primary navigation', selectedNavigation.activeTabText, { backgroundColor: playerPalettes[scheme].primarySoft });
  });
});
