/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import AppShell from './AppShell';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AppShell', () => {
  it('shows the current desktop version in the sidebar', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AppShell
          active="floor"
          clubName="Example Club"
          operator="Alex"
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
        >
          <main>Floor</main>
        </AppShell>
      );
    });

    const version = container.querySelector(`[aria-label="Orbit version ${packageJson.version}"]`);
    expect(version?.textContent).toBe(`Version ${packageJson.version}`);

    act(() => root.unmount());
    container.remove();
  });

  it('shows only actionable desktop update notices', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const installDownloadedUpdate = vi.fn().mockResolvedValue({ ok: true });
    let statusListener: ((status: { state: string; version?: string; message?: string; updateReady?: boolean }) => void) | undefined;
    window.tableManagerDesktop = {
      getUpdateStatus: vi.fn().mockResolvedValue({ state: 'idle' }),
      installDownloadedUpdate,
      onUpdateStatus: vi.fn((callback) => { statusListener = callback; return vi.fn(); })
    } as unknown as NonNullable<Window['tableManagerDesktop']>;

    await act(async () => {
      root.render(
        <AppShell active="floor" clubName="Example Club" onNavigate={vi.fn()} onSignOut={vi.fn()}>
          <main>Floor</main>
        </AppShell>
      );
    });
    await act(async () => statusListener?.({ state: 'downloaded', version: '2.0.0' }));

    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === 'Install update and restart');
    expect(container.textContent).toContain('Orbit 2.0.0 is ready');
    expect(button).toBeTruthy();
    await act(async () => button?.click());
    expect(installDownloadedUpdate).toHaveBeenCalledOnce();

    await act(async () => statusListener?.({ state: 'error', message: 'Background update check failed.' }));
    expect(container.querySelector('.orbit-update-notice')).toBeNull();

    await act(async () => statusListener?.({
      state: 'error',
      message: 'The downloaded update could not be installed.',
      updateReady: true
    }));
    expect(container.querySelector('.orbit-update-notice')?.getAttribute('role')).toBe('alert');
    expect(container.textContent).toContain('The downloaded update could not be installed.');
    expect(Array.from(container.querySelectorAll('button')).some((candidate) => candidate.textContent === 'Install update and restart')).toBe(true);

    act(() => root.unmount());
    delete window.tableManagerDesktop;
    container.remove();
  });
});
