/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { IdentityVerificationScreen } from './IdentityVerificationScreen';

const camera = vi.hoisted(() => ({
  permission: { granted: false, canAskAgain: true } as { granted: boolean; canAskAgain: boolean } | null,
  requestPermission: vi.fn(),
  scan: null as null | ((result: { data: string }) => void)
}));

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {})
    }, children as React.ReactNode);
  return {
    Platform: { OS: 'ios' },
    Pressable: element('button'),
    Text: element('span'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span data-testid="icon" /> }));
vi.mock('expo-camera', async () => {
  const ReactModule = await import('react');
  return {
    CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: (result: { data: string }) => void }) => {
      camera.scan = onBarcodeScanned;
      return ReactModule.createElement('div', { 'data-testid': 'camera' });
    },
    useCameraPermissions: () => [camera.permission, camera.requestPermission]
  };
});

const status: PlayerIdentityStatus = {
  status: 'unverified',
  ageVerified: false,
  ageEligible: false,
  ageLevel: 0,
  minimumAge: 18,
  verifiedAt: null,
  capturedAt: null,
  failureCode: null,
  reviewStatus: 'not-started',
  verifiedDetails: null
};

function barcode(dateOfBirth = '01021990') {
  return [
    '@ANSI 636000080002DL00410288ZA03290015DL',
    'DAQSECRET-ID-NUMBER',
    'DCSDOE',
    'DACJANE',
    'DADQUINN',
    `DBB${dateOfBirth}`,
    'DAG100 MAIN STREET',
    'DAIAUSTIN',
    'DAJTX',
    'DAK787010000',
    'DCGUSA'
  ].join('\n');
}

describe('IdentityVerificationScreen camera and data-minimization composition', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onStart = vi.fn<(details: { fullName: string; dateOfBirth: string; address: string }) => void>();
  let onOpenSettings = vi.fn<() => void>();

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    camera.permission = { granted: false, canAskAgain: true };
    camera.requestPermission.mockReset();
    camera.scan = null;
    onStart = vi.fn<(details: { fullName: string; dateOfBirth: string; address: string }) => void>();
    onOpenSettings = vi.fn<() => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(requiredMinimumAge: 18 | 21 = 18) {
    act(() => {
      root.render(
        <IdentityVerificationScreen
          status={status}
          signedIn
          busy={false}
          message=""
          requiredMinimumAge={requiredMinimumAge}
          onBack={vi.fn()}
          onOpenSettings={onOpenSettings}
          onSignIn={vi.fn()}
          onStart={onStart}
          onRefresh={vi.fn()}
        />
      );
    });
  }

  function button(label: string) {
    return Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === label);
  }

  it('requests camera permission when it may still prompt', () => {
    render();
    expect(container.textContent).toContain('Allow camera access');
    act(() => button('Allow camera access')?.click());
    expect(camera.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('routes permanently blocked permission to device settings', () => {
    camera.permission = { granted: false, canAskAgain: false };
    render();
    expect(container.textContent).toContain('Camera access is blocked in device settings');
    act(() => button('Open device settings')?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(camera.requestPermission).not.toHaveBeenCalled();
  });

  it('handles malformed and repeated scans, previews fields, and submits only sanitized details', async () => {
    camera.permission = { granted: true, canAskAgain: true };
    render(21);
    act(() => camera.scan?.({ data: 'not an ID' }));
    act(() => camera.scan?.({ data: 'not an ID' }));
    expect(container.textContent?.match(/did not include a complete name/g)).toHaveLength(1);

    act(() => camera.scan?.({ data: barcode() }));
    act(() => camera.scan?.({ data: barcode() }));
    expect(container.textContent).toContain('JANE QUINN DOE');
    expect(container.textContent).toContain('Review the details read from the ID');
    expect(container.textContent).toContain('does not take or retain an ID photo');
    expect(container.textContent).toContain('sends your name, date of birth, address, and an opaque request identifier');
    expect(container.textContent).toContain('server records the capture method/time, calculated age eligibility and level, review status, and audit timestamps');
    expect(container.textContent).not.toContain('SECRET-ID-NUMBER');
    await act(async () => button('Use these ID details')?.click());
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledWith({
      fullName: 'JANE QUINN DOE',
      dateOfBirth: '1990-01-02',
      address: '100 MAIN STREET, AUSTIN, TX 787010000, USA'
    });
  });

  it.each([
    ['underage', '01022010', 'does not meet the 18+ requirement'],
    ['age unavailable', '01021800', 'could not calculate an age']
  ])('prevents submission when captured age is %s', (_label, dob, copy) => {
    camera.permission = { granted: true, canAskAgain: true };
    render();
    act(() => camera.scan?.({ data: barcode(dob) }));
    expect(container.textContent).toContain(copy);
    expect(button('Use these ID details')?.hasAttribute('disabled')).toBe(true);
    act(() => button('Use these ID details')?.click());
    expect(onStart).not.toHaveBeenCalled();
  });
});
