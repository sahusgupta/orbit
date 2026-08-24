/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import PokerTable from './PokerTable';

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
    const onAddBuyIn = vi.fn();
    const onAddTime = vi.fn();
    const onRemovePlayer = vi.fn();
    const player = {
      id: 'player-details',
      name: 'Alexandra Montgomery',
      seatNumber: 3,
      membershipId: 'member-details',
      joinedAt: Date.now(),
      buyInTotal: 1250,
      timeRemainingSeconds: 1199
    };

    act(() => {
      root.render(
        <PokerTable
          players={[player]}
          maxPlayers={9}
          moveTargets={[{ id: 'table-2', label: 'Second Table', openSeats: 4 }]}
          onAddBuyIn={onAddBuyIn}
          onAddTime={onAddTime}
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
    const recordBuyInChoice = actionChoices.find((button) => button.textContent?.includes('Record buy-in'));
    expect(addTimeChoice?.getAttribute('aria-pressed')).toBe('false');
    expect(recordBuyInChoice?.getAttribute('aria-pressed')).toBe('false');

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
});
