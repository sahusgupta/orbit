/** @vitest-environment jsdom */
import * as Dialog from '@radix-ui/react-dialog';
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationalDialog from './OperationalDialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mountedRoots: ReturnType<typeof createRoot>[] = [];

function ParentWorkspace({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) onClose();
    }}>
      <Dialog.Trigger asChild><button data-workspace-trigger type="button">Current tables</button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay data-workspace-backdrop />
        <Dialog.Content data-workspace-content aria-describedby={undefined}>
          <Dialog.Title>Current tables</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Harness({
  nested = false,
  removeOpenerOnOpen = false,
  dismissOnOutside = false,
  onParentClose = () => undefined,
  onChildClose = () => undefined
}: {
  nested?: boolean;
  removeOpenerOnOpen?: boolean;
  dismissOnOutside?: boolean;
  onParentClose?: () => void;
  onChildClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [openerRemoved, setOpenerRemoved] = useState(false);
  const fallbackFocusRef = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); onChildClose(); };
  // Constructed by the owner, passed into a parent dialog just like FloorView's modal props.
  const child = open ? (
    <OperationalDialog
      backdropClassName="test-operational-backdrop"
      onClose={close}
      fallbackFocusRef={fallbackFocusRef}
      dismissOnOutside={dismissOnOutside}
    >
      <section data-operational-content>
        <Dialog.Title>Seat a player</Dialog.Title>
        <button data-child-first type="button" onClick={close}>Close player picker</button>
        <input
          aria-label="Player name"
          data-dialog-initial-focus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <input aria-label="Initial buy-in" type="number" />
        <button data-child-last type="button" onClick={close}>Cancel</button>
      </section>
    </OperationalDialog>
  ) : null;
  const workspace = (
    <>
      {!openerRemoved ? (
        <button data-picker-trigger type="button" onClick={() => {
          setOpen(true);
          if (removeOpenerOnOpen) setOpenerRemoved(true);
        }}>Add player</button>
      ) : null}
      <input data-background-input aria-label="Dealer" ref={fallbackFocusRef} />
      {child}
    </>
  );
  return nested ? <ParentWorkspace onClose={onParentClose}>{workspace}</ParentWorkspace> : workspace;
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => { root.render(<Harness {...props} />); });
}

function element<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing test element: ${selector}`);
  return node;
}

function click(selector: string) {
  act(() => {
    const button = element<HTMLButtonElement>(selector);
    button.focus();
    button.click();
  });
}

async function flushDeferredFocus() {
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
}

function key(node: HTMLElement, keyName: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: keyName, shiftKey, bubbles: true, cancelable: true });
  act(() => { node.dispatchEvent(event); });
  return event;
}

afterEach(async () => {
  act(() => { mountedRoots.splice(0).forEach((root) => root.unmount()); });
  await flushDeferredFocus();
  document.body.innerHTML = '';
});

describe('OperationalDialog focus ownership', () => {
  it('keeps a prop-rendered child input focused and mounted while editing above a trapped parent', () => {
    renderHarness({ nested: true });
    click('[data-workspace-trigger]');
    click('[data-picker-trigger]');
    const input = element<HTMLInputElement>('[aria-label="Player name"]');
    expect(document.activeElement).toBe(input);
    expect(input.closest('[role="dialog"]')).toBe(element('[data-operational-content]'));
    expect(input.closest('[data-workspace-content]')).toBeNull();

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing native input value setter');
    for (const value of ['A', 'Al', 'Alex']) {
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(element('[aria-label="Player name"]')).toBe(input);
      expect(input.value).toBe(value);
      expect(document.activeElement).toBe(input);
    }
    act(() => { element('[data-background-input]').focus(); });
    expect(document.activeElement).toBe(input);
  });

  it('loops focus at the child boundaries and lets Escape close only the top dialog', async () => {
    const onParentClose = vi.fn();
    const onChildClose = vi.fn();
    renderHarness({ nested: true, onParentClose, onChildClose });
    click('[data-workspace-trigger]');
    click('[data-picker-trigger]');
    const first = element('[data-child-first]');
    const last = element('[data-child-last]');
    act(() => { last.focus(); });
    expect(key(last, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(key(first, 'Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    key(last, 'Escape');
    await flushDeferredFocus();
    expect(onChildClose).toHaveBeenCalledTimes(1);
    expect(onParentClose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-operational-content]')).toBeNull();
    expect(document.querySelector('[data-workspace-content]')).not.toBeNull();
    expect(document.activeElement).toBe(element('[data-picker-trigger]'));

    key(element('[data-picker-trigger]'), 'Escape');
    await flushDeferredFocus();
    expect(onParentClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(element('[data-workspace-trigger]'));
  });

  it('restores the page opener after cancel without a parent dialog', async () => {
    renderHarness();
    click('[data-picker-trigger]');
    expect(document.activeElement).toBe(element('[aria-label="Player name"]'));
    click('[data-child-last]');
    await flushDeferredFocus();
    expect(document.activeElement).toBe(element('[data-picker-trigger]'));
  });

  it('uses a connected fallback when the opener is removed', async () => {
    renderHarness({ removeOpenerOnOpen: true });
    click('[data-picker-trigger]');
    expect(document.activeElement).toBe(element('[aria-label="Player name"]'));
    click('[data-child-last]');
    await flushDeferredFocus();
    expect(document.activeElement).toBe(element('[data-background-input]'));
  });

  it.each([false, true])('preserves outside dismissal policy (%s)', async (dismissOnOutside) => {
    const onChildClose = vi.fn();
    renderHarness({ dismissOnOutside, onChildClose });
    click('[data-picker-trigger]');
    await flushDeferredFocus();
    act(() => {
      const backdrop = element('.test-operational-backdrop');
      backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
    await flushDeferredFocus();
    expect(onChildClose).toHaveBeenCalledTimes(dismissOnOutside ? 1 : 0);
    expect(Boolean(document.querySelector('[data-operational-content]'))).toBe(!dismissOnOutside);
  });
});
