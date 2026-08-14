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
  it('previews real discovery features through accessible poker-card buttons', async () => {
    render(<OrbitFeatureCards />);

    const live = screen.getByRole('button', { name: 'Preview live feature' });
    const registration = screen.getByRole('button', { name: 'Preview open feature' });
    expect(live).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Running now')).toBeVisible();

    await userEvent.click(registration);

    expect(live).toHaveAttribute('aria-pressed', 'false');
    expect(registration).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Registration open')).toBeVisible();
    expect(screen.getByText(/currently accepting entries/i)).toBeVisible();
  });

  it('updates the preview when a keyboard user focuses a card', async () => {
    render(<OrbitFeatureCards />);

    await userEvent.tab();
    await userEvent.tab();

    expect(screen.getByRole('button', { name: 'Preview forming feature' })).toHaveFocus();
    expect(screen.getByText('Building a table')).toBeVisible();
  });
});
