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
});
