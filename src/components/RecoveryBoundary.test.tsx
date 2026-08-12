/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoveryBoundary } from './RecoveryBoundary';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RecoveryBoundary', () => {
  it('replaces a failed render with an actionable incident reference', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onIncident = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Broken = () => {
      throw new Error('sensitive render detail');
    };

    act(() => root.render(
      <RecoveryBoundary label="Test workspace" onIncident={onIncident}>
        <Broken />
      </RecoveryBoundary>
    ));

    expect(container.textContent).toContain('Test workspace could not be displayed.');
    expect(container.textContent).toMatch(/Incident orbit-/);
    expect(container.querySelector('button')?.textContent).toBe('Retry view');
    expect(onIncident).toHaveBeenCalledWith(expect.stringMatching(/^orbit-/));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('sensitive render detail'));

    act(() => root.unmount());
  });
});
