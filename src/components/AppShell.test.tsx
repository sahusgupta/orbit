/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import AppShell from './AppShell';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AppShell', () => {
  it('opens commands by keyboard, filters actions, and closes after invoking the selected action once', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const action = vi.fn();
    const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

    try {
      await act(async () => root.render(
        <AppShell active="floor" clubName="Example Club" onNavigate={vi.fn()} onSignOut={vi.fn()}
          commands={[{ id: 'fixture-action', label: 'Fixture action', group: 'Actions', action }]}>
          <main>Floor</main>
        </AppShell>
      ));
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(document.querySelector('input[placeholder="Search players, tables, actions…"]')).toBeTruthy();
      });
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Search players, tables, actions…"]');
      if (!input) throw new Error('Command search did not load.');
      expect(document.activeElement).toBe(input);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Fixture');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Open Players'));
      const item = Array.from(document.querySelectorAll<HTMLElement>('[cmdk-item]')).find((candidate) => candidate.textContent === 'Fixture action');
      if (!item) throw new Error('Filtered command was not available.');
      await act(async () => item.click());

      expect(action).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(container.textContent).toContain('Floor');
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it.each(['keyboard', 'pointer'])('restores the %s command opener without remounting or clearing an editable draft', async (method) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    function Harness() {
      const [draft, setDraft] = useState('');
      const draftField = <input aria-label="Quick Add player name" value={draft} onChange={(event) => setDraft(event.target.value)} />;
      return (
        <AppShell active="floor" clubName="Example Club" onNavigate={vi.fn()} onSignOut={vi.fn()}>
          <main>{method === 'keyboard' ? (
            <Dialog.Root open>
              <Dialog.Portal>
                <Dialog.Overlay />
                <Dialog.Content aria-describedby={undefined}><Dialog.Title>Quick Add</Dialog.Title>{draftField}</Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          ) : draftField}</main>
        </AppShell>
      );
    }
    try {
      await act(async () => root.render(<Harness />));
      const draftInput = document.querySelector<HTMLInputElement>('[aria-label="Quick Add player name"]')!;
      const trigger = container.querySelector<HTMLButtonElement>('.orbit-command-trigger')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        draftInput.focus();
        setter.call(draftInput, 'Alice');
        draftInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(document.activeElement).toBe(draftInput);
      for (const key of ['k', '4', 'Backspace', 'ArrowLeft']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        act(() => draftInput.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(false);
      }
      expect(document.querySelector('.command-dialog')).toBeNull();

      await act(async () => {
        if (method === 'keyboard') {
          draftInput.setSelectionRange(1, 4, 'backward');
          expect([draftInput.selectionStart, draftInput.selectionEnd, draftInput.selectionDirection]).toEqual([1, 4, 'backward']);
          draftInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
        } else {
          trigger.click();
        }
      });
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(document.querySelector('.command-dialog input')).not.toBeNull();
      });
      const commandInput = document.querySelector<HTMLInputElement>('.command-dialog input')!;
      expect(document.activeElement).toBe(commandInput);
      expect(document.querySelector('[aria-label="Quick Add player name"]')).toBe(draftInput);
      expect(draftInput.value).toBe('Alice');

      await act(async () => {
        commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector('.command-dialog')).toBeNull();
      expect(document.activeElement).toBe(method === 'keyboard' ? draftInput : trigger);
      expect(document.querySelector('[aria-label="Quick Add player name"]')).toBe(draftInput);
      expect(draftInput.isConnected).toBe(true);
      expect(draftInput.value).toBe('Alice');
      if (method === 'keyboard') {
        expect([draftInput.selectionStart, draftInput.selectionEnd, draftInput.selectionDirection]).toEqual([1, 4, 'backward']);
      }
      act(() => {
        draftInput.focus();
        setter.call(draftInput, 'Alice Smith');
        draftInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(draftInput.value).toBe('Alice Smith');
      expect(document.activeElement).toBe(draftInput);
    } finally {
      await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      container.remove();
      vi.unstubAllGlobals();
      if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

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

  it('keeps Undo visible and enables it only when an operational action is available', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onUndo = vi.fn();

    act(() => {
      root.render(
        <AppShell
          active="floor"
          canUndo
          clubName="Example Club"
          onNavigate={vi.fn()}
          onSignOut={vi.fn()}
          onUndo={onUndo}
          undoLabel="Added player time"
        >
          <main>Floor</main>
        </AppShell>
      );
    });

    const undo = container.querySelector<HTMLButtonElement>('.orbit-undo');
    expect(undo?.disabled).toBe(false);
    expect(undo?.getAttribute('aria-label')).toBe('Undo Added player time');
    act(() => undo?.click());
    expect(onUndo).toHaveBeenCalledOnce();

    act(() => {
      root.render(
        <AppShell active="floor" clubName="Example Club" onNavigate={vi.fn()} onSignOut={vi.fn()}>
          <main>Floor</main>
        </AppShell>
      );
    });
    expect(container.querySelector<HTMLButtonElement>('.orbit-undo')?.disabled).toBe(true);

    act(() => root.unmount());
    container.remove();
  });
});
