/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import PokerTable from './PokerTable';
import OperationalDialog from './OperationalDialog';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('PokerTable seat rendering', () => {
  it('renders and supports clicking the largest configured table cap', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSeatClick = vi.fn();

    act(() => {
      root.render(<PokerTable players={[]} maxPlayers={10} onSeatClick={onSeatClick} />);
    });

    const seatTen = container.querySelector<HTMLButtonElement>('button[title="Add player to seat 10"]');
    const seatMarkers = Array.from(container.querySelectorAll<HTMLButtonElement>('.poker-position-marker'));
    expect(seatMarkers).toHaveLength(10);
    expect(seatTen).not.toBeNull();
    expect(container.querySelector('.poker-dealer-position')).not.toBeNull();
    expect(container.querySelector('button[title="Add player to seat 11"]')).toBeNull();
    expect(seatMarkers.some((marker) => marker.style.left === '50%' && marker.style.top === '91%')).toBe(false);

    act(() => {
      seatTen?.click();
    });

    expect(onSeatClick).toHaveBeenCalledWith(10);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('moves a seated player by dragging them onto an open seat', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChangeSeat = vi.fn();
    const player = {
      id: 'player-1',
      name: 'Alex',
      seatNumber: 1,
      membershipId: 'member-1',
      joinedAt: Date.now()
    };

    act(() => {
      root.render(<PokerTable players={[player]} maxPlayers={9} onChangeSeat={onChangeSeat} />);
    });

    const dragSource = container.querySelector<HTMLButtonElement>('button[aria-label="Open details for Alex at seat 1"]');
    const targetSeat = container.querySelector<HTMLButtonElement>('button[title="Add player to seat 4"]');
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    };
    const dispatchDragEvent = (element: Element | null, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      element?.dispatchEvent(event);
    };

    act(() => {
      dispatchDragEvent(dragSource, 'dragstart');
      dispatchDragEvent(targetSeat, 'dragover');
      dispatchDragEvent(targetSeat, 'drop');
      dispatchDragEvent(dragSource, 'dragend');
    });

    expect(onChangeSeat).toHaveBeenCalledWith('player-1', 4);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the closed seat calm and retains financial actions in player details', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAddBuyIn = vi.fn(() => true);
    const onAddTime = vi.fn(() => true);
    const onDeductTime = vi.fn(() => true);
    const onPauseAndSaveTime = vi.fn(() => true);
    const onUseSavedTime = vi.fn(() => true);
    const onRemovePlayer = vi.fn();
    const player = {
      id: 'player-details',
      name: 'Alexandra Montgomery',
      seatNumber: 3,
      membershipId: 'member-details',
      joinedAt: Date.now(),
      buyInTotal: 1250,
      timeRemainingSeconds: 1199,
      savedTimeCreditMinutes: 45
    };

    act(() => {
      root.render(
        <PokerTable
          players={[player]}
          maxPlayers={9}
          moveTargets={[{ id: 'table-2', label: 'Second Table', openSeats: 4 }]}
          onAddBuyIn={onAddBuyIn}
          onAddTime={onAddTime}
          onDeductTime={onDeductTime}
          onPauseAndSaveTime={onPauseAndSaveTime}
          onUseSavedTime={onUseSavedTime}
          onMovePlayer={vi.fn()}
          onRemovePlayer={onRemovePlayer}
          showTimeRemaining
        />
      );
    });

    const seat = container.querySelector<HTMLButtonElement>('button[aria-label="Open details for Alexandra Montgomery at seat 3"]');
    expect(seat?.querySelector('.poker-seat-player-name')?.textContent).toBe('Alexandra Montgomery');
    expect(seat?.querySelector('.poker-seat-buyin')).toBeNull();
    expect(seat?.querySelector('.poker-seat-time')?.textContent).toBe('19:59');
    expect(seat?.getAttribute('aria-expanded')).toBe('false');
    expect(seat?.hasAttribute('aria-haspopup')).toBe(false);
    const detailsId = seat?.getAttribute('aria-controls');
    const timerDescriptionId = seat?.getAttribute('aria-describedby');
    expect(timerDescriptionId).toBeTruthy();
    expect(document.getElementById(timerDescriptionId ?? '')?.textContent?.trim()).toBe('19:59 remaining, approaching');
    expect(container.querySelector('.poker-seat-player-label')).toBeNull();

    act(() => {
      seat?.click();
    });

    expect(seat?.getAttribute('aria-expanded')).toBe('true');
    const details = container.querySelector<HTMLElement>('[role="region"]');
    expect(details?.id).toBe(detailsId);
    expect(details?.querySelector('.poker-seat-menu-header-actions strong')?.textContent).toBe('$1,250');
    expect(details?.textContent).not.toContain('member-details');
    expect(details?.querySelector('label[for="change-seat-player-details"]')?.textContent).toBe('Seat');
    expect(details?.querySelector('label[for="move-player-player-details"]')?.textContent).toBe('Move to table');
    expect(details?.querySelector('.poker-seat-action-panel')).toBeNull();
    const actionWorkspace = details?.querySelector('.poker-seat-menu-workspace.with-actions');
    expect(actionWorkspace).not.toBeNull();
    expect(actionWorkspace?.textContent).toContain('Table position');

    const actionChoices = Array.from(details?.querySelectorAll<HTMLButtonElement>('.poker-seat-action-choice') ?? []);
    const addTimeChoice = actionChoices.find((button) => button.textContent?.includes('Add time'));
    const deductTimeChoice = actionChoices.find((button) => button.textContent?.includes('Deduct time'));
    const pauseTimeChoice = actionChoices.find((button) => button.textContent?.includes('Pause'));
    const useSavedTimeChoice = actionChoices.find((button) => button.textContent?.includes('Use saved'));
    const recordBuyInChoice = actionChoices.find((button) => button.textContent?.includes('Record buy-in'));
    expect(addTimeChoice?.getAttribute('aria-pressed')).toBe('false');
    expect(recordBuyInChoice?.getAttribute('aria-pressed')).toBe('false');
    expect(details?.textContent).toContain('Saved time 45 min');

    act(() => {
      addTimeChoice?.click();
    });
    expect(details?.querySelector('.poker-seat-menu-workspace')).toBe(actionWorkspace);
    expect(actionWorkspace?.textContent).not.toContain('Table position');
    expect(details?.querySelector('.time-action-panel')).not.toBeNull();
    expect(details?.querySelector('.buyin-action-panel')).toBeNull();
    expect(addTimeChoice?.getAttribute('aria-label')).toBe('Hide add time controls for Alexandra Montgomery');

    act(() => {
      addTimeChoice?.click();
    });
    expect(details?.querySelector('.time-action-panel')).toBeNull();
    expect(actionWorkspace?.textContent).toContain('Table position');

    act(() => {
      deductTimeChoice?.click();
    });
    const deductPanel = details?.querySelector<HTMLElement>('.deduct-time-action-panel');
    expect(deductPanel).not.toBeNull();
    act(() => {
      deductPanel?.querySelector<HTMLButtonElement>('.mini-button')?.click();
    });
    expect(onDeductTime).toHaveBeenCalledWith('player-details', 15, 'Time added by mistake');
    expect(details?.querySelector('[role="status"]')?.textContent).toBe('15 minutes deducted.');

    act(() => {
      pauseTimeChoice?.click();
    });
    expect(onPauseAndSaveTime).toHaveBeenCalledWith('player-details');
    expect(details?.querySelector('[role="status"]')?.textContent).toContain('paused and saved');

    act(() => {
      useSavedTimeChoice?.click();
    });
    expect(onUseSavedTime).toHaveBeenCalledWith('player-details', 45);
    expect(details?.querySelector('[role="status"]')?.textContent).toBe('45 saved minutes applied.');
    expect(addTimeChoice?.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      addTimeChoice?.click();
    });

    act(() => {
      details?.querySelector<HTMLButtonElement>('.time-action-panel .poker-seat-submit-action')?.click();
    });
    expect(details?.querySelector('[role="alert"]')?.textContent).toBe('Enter minutes greater than zero.');
    expect(onAddTime).not.toHaveBeenCalled();

    act(() => {
      details?.querySelector<HTMLButtonElement>('.time-action-panel .mini-button')?.click();
    });
    expect(onAddTime).toHaveBeenCalledWith('player-details', 30);
    expect(onAddBuyIn).not.toHaveBeenCalled();
    expect(details?.querySelector('.time-action-panel')).toBeNull();
    expect(details?.querySelector('[role="status"]')?.textContent).toBe('30 minutes added.');
    expect(actionWorkspace?.textContent).toContain('Table position');

    act(() => {
      recordBuyInChoice?.click();
    });
    expect(details?.querySelector('.poker-seat-menu-workspace')).toBe(actionWorkspace);
    expect(actionWorkspace?.textContent).not.toContain('Table position');
    expect(details?.querySelector('.time-action-panel')).toBeNull();
    const buyInPanel = details?.querySelector<HTMLElement>('.buyin-action-panel');
    expect(buyInPanel).not.toBeNull();

    act(() => {
      buyInPanel?.querySelector<HTMLButtonElement>('.poker-seat-submit-action')?.click();
    });
    expect(details?.querySelector('[role="alert"]')?.textContent).toBe('Enter a buy-in amount greater than zero.');
    expect(onAddBuyIn).not.toHaveBeenCalled();

    const amountInput = buyInPanel?.querySelector<HTMLInputElement>('input[type="number"]');
    const noteInput = buyInPanel?.querySelector<HTMLInputElement>('input:not([type="number"])');
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(amountInput, '275');
      amountInput?.dispatchEvent(new Event('input', { bubbles: true }));
      valueSetter?.call(noteInput, 'second bullet');
      noteInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      buyInPanel?.querySelector<HTMLButtonElement>('.poker-seat-submit-action')?.click();
    });
    expect(onAddBuyIn).toHaveBeenCalledWith('player-details', 275, 'second bullet');
    expect(onAddTime).toHaveBeenCalledTimes(1);
    expect(onDeductTime).toHaveBeenCalledTimes(1);
    expect(details?.querySelector('.buyin-action-panel')).toBeNull();
    expect(details?.querySelector('[role="status"]')?.textContent).toBe('$275 buy-in recorded.');

    const cashOut = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Cash out and leave table');

    act(() => {
      cashOut?.click();
    });

    expect(onRemovePlayer).toHaveBeenCalledWith('player-details');
    expect(container.querySelector('[role="region"]')).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders optional revenue and dealer controls in the table center', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAssign = vi.fn();
    const onChange = vi.fn();
    const onEnd = vi.fn();

    act(() => {
      root.render(
        <PokerTable
          players={[]}
          revenueEstimate={{ label: 'Estimated time revenue', value: '$186.00' }}
          dealerControl={{
            currentDealer: 'Morgan',
            value: 'Taylor',
            options: ['Morgan', 'Taylor'],
            onChange,
            onAssign,
            onEnd
          }}
        />
      );
    });

    const controls = container.querySelector<HTMLElement>('[aria-label="Table revenue and dealer controls"]');
    expect(controls?.textContent).toContain('Estimated time revenue');
    expect(controls?.textContent).toContain('$186.00');
    expect(controls?.textContent).toContain('Current: Morgan');
    const dealerInput = controls?.querySelector<HTMLInputElement>('input[aria-label="Dealer selection"]');
    expect(dealerInput?.value).toBe('Taylor');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (dealerInput && valueSetter) valueSetter.call(dealerInput, 'New Dealer');
      dealerInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      Array.from(controls?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent === 'Assign dealer')?.click();
      Array.from(controls?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent === 'End down')?.click();
    });

    expect(onChange).toHaveBeenCalledWith('New Dealer');
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('dismisses player details with Escape or an outside pointer action', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const player = {
      id: 'player-dismiss',
      name: 'Jordan',
      seatNumber: 2,
      membershipId: 'member-dismiss',
      joinedAt: Date.now()
    };

    act(() => {
      root.render(<PokerTable players={[player]} maxPlayers={8} />);
    });

    const seat = container.querySelector<HTMLButtonElement>('button[aria-label="Open details for Jordan at seat 2"]');
    act(() => {
      seat?.click();
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });

    expect(seat?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(seat);

    act(() => {
      seat?.click();
    });
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });

    expect(seat?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('returns focus to the stable seat trigger after requesting cash out', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const player = { id: 'cash-out-player', name: 'Jordan', seatNumber: 2, membershipId: 'synthetic', joinedAt: Date.now() };
    const onRemovePlayer = vi.fn(() => {
      expect(document.activeElement?.classList.contains('poker-seat-cashout')).toBe(true);
      expect(container.querySelector('.poker-seat-menu')).not.toBeNull();
    });
    try {
      act(() => root.render(<PokerTable players={[player]} onRemovePlayer={onRemovePlayer} />));
      const seat = container.querySelector<HTMLButtonElement>('[aria-label="Open details for Jordan at seat 2"]')!;
      act(() => seat.click());
      const cashOut = container.querySelector<HTMLButtonElement>('.poker-seat-cashout')!;
      act(() => { cashOut.focus(); cashOut.click(); });

      expect(onRemovePlayer).toHaveBeenCalledWith(player.id);
      expect(cashOut.isConnected).toBe(false);
      expect(container.querySelector('.poker-seat-menu')).toBeNull();
      expect(container.querySelector('[aria-label="Open details for Jordan at seat 2"]')).toBe(seat);
      expect(seat.isConnected).toBe(true);
      expect(document.activeElement).toBe(seat);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it.each(['add', 'deduct'])('retains the focused %s time draft through a clock tick and unrelated parent render', (action) => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const player = { id: 'draft-player', name: 'Taylor', seatNumber: 1, membershipId: 'synthetic', joinedAt: Date.now(), timeRemainingSeconds: 3600 };
    const save = vi.fn(() => true);
    const renderTable = (remaining: number) => root.render(
      <PokerTable players={[{ ...player, timeRemainingSeconds: remaining }]} showTimeRemaining onAddTime={save} onDeductTime={save} />
    );
    try {
      act(() => renderTable(3600));
      act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open details for Taylor at seat 1"]')!.click());
      act(() => container.querySelector<HTMLButtonElement>(action === 'add'
        ? '[aria-label="Show add time controls for Taylor"]'
        : '[aria-label="Show deduct time controls for Taylor"]')!.click());
      const selector = action === 'add' ? '.time-action-panel input' : '.deduct-time-action-panel input:not([type])';
      const input = container.querySelector<HTMLInputElement>(selector)!;
      const draft = action === 'add' ? '45' : 'Synthetic correction';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        input.focus();
        setter.call(input, draft);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(input.value).toBe(draft);
      expect(document.activeElement).toBe(input);

      act(() => vi.advanceTimersByTime(1000));
      act(() => renderTable(3599));
      expect(container.querySelector(selector)).toBe(input);
      expect(input.isConnected).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe(draft);

      const nativeKey = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: action === 'add' ? '6' : 'x' });
      act(() => {
        input.dispatchEvent(nativeKey);
        setter.call(input, draft + (action === 'add' ? '6' : 'x'));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(nativeKey.defaultPrevented).toBe(false);
      expect(input.value).toBe(draft + (action === 'add' ? '6' : 'x'));
      expect(document.activeElement).toBe(input);
      expect(save).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.useRealTimers();
    }
  });

  it('leaves underlying player details open when Escape dismisses a separate topmost dialog', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const parentOpenChange = vi.fn();
    let openOtherDialog: () => void = () => undefined;
    const player = { id: 'stack-player', name: 'Taylor', seatNumber: 1, membershipId: 'synthetic', joinedAt: Date.now(), timeRemainingSeconds: 3600 };
    function Harness() {
      const [otherOpen, setOtherOpen] = useState(false);
      openOtherDialog = () => setOtherOpen(true);
      return (
        <Dialog.Root open onOpenChange={parentOpenChange}>
          <Dialog.Portal>
            <Dialog.Overlay />
            <Dialog.Content aria-describedby={undefined}>
              <Dialog.Title>Current tables</Dialog.Title>
              <PokerTable players={[player]} showTimeRemaining onAddTime={() => true} />
              {otherOpen ? (
                <OperationalDialog backdropClassName="synthetic-dialog-backdrop" onClose={() => setOtherOpen(false)}>
                  <section aria-label="Other operation"><Dialog.Title>Other operation</Dialog.Title><input data-dialog-initial-focus aria-label="Other operation note" /></section>
                </OperationalDialog>
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      );
    }
    try {
      await act(async () => root.render(<Harness />));
      const seat = document.querySelector<HTMLButtonElement>('[aria-label="Open details for Taylor at seat 1"]')!;
      act(() => seat.click());
      act(() => document.querySelector<HTMLButtonElement>('[aria-label="Show add time controls for Taylor"]')!.click());
      const draft = document.querySelector<HTMLInputElement>('.time-action-panel input')!;
      act(() => draft.focus());
      await act(async () => openOtherDialog());
      const topmostInput = document.querySelector<HTMLInputElement>('[aria-label="Other operation note"]')!;
      expect(document.activeElement).toBe(topmostInput);
      await act(async () => {
        topmostInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(document.querySelector('[aria-label="Other operation"]')).toBeNull();
      expect(parentOpenChange).not.toHaveBeenCalled();
      expect(seat.getAttribute('aria-expanded')).toBe('true');
      expect(document.querySelector('.time-action-panel input')).toBe(draft);
      expect(document.activeElement).toBe(draft);
    } finally {
      await act(async () => { root.unmount(); await new Promise((resolve) => setTimeout(resolve, 0)); });
      container.remove();
    }
  });
});

it('keeps the time form open and does not claim success when an addition is rejected', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onAddTime = vi.fn(() => false);
  const click = (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === label);
    expect(button).toBeDefined();
    act(() => button?.click());
  };
  act(() => root.render(<PokerTable players={[{ id: 'player', name: 'Test', seatNumber: 1, membershipId: 'member', joinedAt: Date.now(), timeRemainingSeconds: 60 }]} showTimeRemaining onAddTime={onAddTime} />));
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Open details for Test at seat 1"]')?.click());
  click('Add time');
  click('+30 min');
  expect(onAddTime).toHaveBeenCalledWith('player', 30);
  expect(container.textContent).not.toContain('30 minutes added.');
  expect(container.querySelector('.time-action-panel')).not.toBeNull();
  act(() => root.unmount());
  container.remove();
});


it.each(['add', 'deduct'])('waits for the %s save and retains the form on asynchronous rejection', async (action) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let resolveSave: (result: { ok: false; status: 'preflight-rejected'; error: string }) => void = () => undefined;
  const save = vi.fn(() => new Promise<{ ok: false; status: 'preflight-rejected'; error: string }>(resolve => { resolveSave = resolve; }));
  const click = (text: string) => {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === text);
    if (!button) throw new Error('Missing button ' + text);
    act(() => button.click());
  };
  act(() => root.render(<PokerTable players={[{ id: 'pending-player', name: 'Pending', seatNumber: 1, membershipId: 'synthetic', joinedAt: Date.now(), timeRemainingSeconds: 3600 }]} showTimeRemaining onAddTime={save} onDeductTime={save} />));
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open details for Pending at seat 1"]')!.click());
  click(action === 'add' ? 'Add time' : 'Deduct time');
  if (action === 'deduct') {
    const reason = container.querySelector<HTMLInputElement>('.deduct-time-action-panel input:not([type])')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(reason, ''); reason.dispatchEvent(new Event('input', { bubbles: true })); });
    click('-30 min');
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enter a correction reason.');
    act(() => { setter.call(reason, 'Synthetic correction'); reason.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  click(action === 'add' ? '+30 min' : '-30 min');
  expect(container.textContent).toContain('Saving to server');
  expect(container.textContent).not.toContain('minutes added.');
  expect(container.textContent).not.toContain('minutes deducted.');
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => resolveSave({ ok: false, status: 'preflight-rejected', error: '2,000,123 bytes exceeds 2,000,000-byte save limit. Export a backup and contact support.' }));
  expect(container.textContent).toContain('2,000,123 bytes');
  expect(container.querySelector(action === 'add' ? '.time-action-panel' : '.deduct-time-action-panel')).not.toBeNull();
  expect(container.textContent).not.toContain('minutes added.');
  expect(container.textContent).not.toContain('minutes deducted.');
  act(() => root.unmount());
  container.remove();
});
