/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import IdEnrollmentPanel from './IdEnrollmentPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('government ID enrollment panel', () => {
  it('discards an unrecognized raw scan after each read attempt', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onApply = vi.fn();

    act(() => root.render(<IdEnrollmentPanel minimumAge={21} onApply={onApply} />));
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Government ID scanner input"]');
    const readButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Read scan');
    if (!input || !readButton) throw new Error('Expected the ID scanner controls');

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setValue) throw new Error('Expected the textarea value setter');
      setValue.call(input, 'unrecognized raw ID data');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('unrecognized raw ID data');

    act(() => readButton.click());

    expect(input.value).toBe('');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('not recognized');
    expect(onApply).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
