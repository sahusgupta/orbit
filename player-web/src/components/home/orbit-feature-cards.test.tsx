import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrbitFeatureCards } from '@/src/components/home/orbit-feature-cards';

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Orbit feature cards', () => {
  it('connects the poker-card story to nearby games and membership management', async () => {
    render(<OrbitFeatureCards />);

    const nearby = screen.getByRole('button', { name: 'Preview nearby feature' });
    const memberships = screen.getByRole('button', { name: 'Preview my clubs feature' });
    expect(nearby).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Live games near you')).toBeVisible();
    expect(screen.getByRole('link', { name: /Browse nearby games/ })).toHaveAttribute('href', '/games');

    await userEvent.click(memberships);

    expect(nearby).toHaveAttribute('aria-pressed', 'false');
    expect(memberships).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Every membership in one place')).toBeVisible();
    expect(screen.getByText(/active, pending, and expired poker-club memberships/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /Manage my memberships/ })).toHaveAttribute('href', '/me/clubs');
  });

  it('updates the preview when a keyboard user focuses a card', async () => {
    render(<OrbitFeatureCards />);

    await userEvent.tab();
    await userEvent.tab();

    expect(screen.getByRole('button', { name: 'Preview your fit feature' })).toHaveFocus();
    expect(screen.getByText('The games you like to play')).toBeVisible();
  });
});
