/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import PokerTable from './PokerTable';

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
});
