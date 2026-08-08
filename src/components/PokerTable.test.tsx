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

    const dragSource = container.querySelector<HTMLButtonElement>('button[aria-label="Move Alex from seat 1"]');
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

  it('keeps player name, buy-in, and timer inside the circular seat control', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
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
      root.render(<PokerTable players={[player]} maxPlayers={9} showTimeRemaining />);
    });

    const seat = container.querySelector<HTMLButtonElement>('button[aria-label="Move Alexandra Montgomery from seat 3"]');
    expect(seat?.querySelector('.poker-seat-player-name')?.textContent).toBe('Alexandra Montgomery');
    expect(seat?.querySelector('.poker-seat-buyin')?.textContent).toBe('$1,250');
    expect(seat?.querySelector('.poker-seat-time')?.textContent).toBe('19:59');
    expect(container.querySelector('.poker-seat-player-label')).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
