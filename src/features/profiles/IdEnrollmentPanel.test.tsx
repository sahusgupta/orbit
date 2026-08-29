/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IdEnrollmentPanel from './IdEnrollmentPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setTextareaValue = (input: HTMLTextAreaElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Expected the textarea value setter');
  setValue.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const mountPanel = (props: Partial<React.ComponentProps<typeof IdEnrollmentPanel>> = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onApply = vi.fn();
  act(() => root.render(<IdEnrollmentPanel minimumAge={21} onApply={onApply} {...props} />));
  return { container, onApply, root };
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('government ID enrollment panel', () => {
  it('makes hardware input visibly detectable and reads a complete scanner burst after an idle interval', () => {
    vi.useFakeTimers();
    const { container, onApply, root } = mountPanel();
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Government ID scanner input"]');
    if (!input) throw new Error('Expected the ID scanner input');
    const scan = [
      'DCSDOE',
      'DACJANE',
      'DBB01021990',
      'DAG100 MAIN STREET',
      'DAIAUSTIN',
      'DAJTX',
      'DAK78701'
    ].join('\n');

    act(() => setTextareaValue(input, scan));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Scanner input detected');

    act(() => vi.advanceTimersByTime(450));
    expect(input.value).toBe('');
    expect(container.querySelector('[aria-label="Extracted ID details"]')?.textContent).toContain('JANE DOE');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('ID details extracted');

    const apply = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Use details and continue');
    act(() => apply?.click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'JANE DOE' }), 'id-barcode');

    act(() => root.unmount());
    container.remove();
  });

  it('discards an unrecognized raw scan after each read attempt', () => {
    const { container, onApply, root } = mountPanel();
    const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Government ID scanner input"]');
    const readButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Read scan');
    if (!input || !readButton) throw new Error('Expected the ID scanner controls');

    act(() => setTextareaValue(input, 'unrecognized raw ID data'));
    expect(input.value).toBe('unrecognized raw ID data');

    act(() => readButton.click());

    expect(input.value).toBe('');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('not recognized');
    expect(onApply).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('requires explicit image comparison before applying OCR fields and revokes the preview URL', async () => {
    const createObjectUrl = vi.fn(() => 'blob:local-review-image');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const readImage = vi.fn(async (_file: File, options?: Parameters<NonNullable<React.ComponentProps<typeof IdEnrollmentPanel>['readImage']>>[1]) => {
      options?.onProgress?.({ stage: 'ocr', progress: 0.75 });
      return {
        identity: {
          fullName: 'CASEY EXAMPLE',
          dateOfBirth: '1990-01-02',
          address: '100 TEST WAY, AUSTIN, TX 78701',
          age: 36
        },
        captureMethod: 'id-image-ocr' as const
      };
    });
    const { container, onApply, root } = mountPanel({ readImage });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose government ID image"]');
    if (!input) throw new Error('Expected the image input');
    const file = new File(['synthetic image bytes'], 'synthetic-license.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    expect(readImage).toHaveBeenCalledWith(file, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(container.querySelector<HTMLImageElement>('img[alt="Selected government ID for local comparison"]')?.src)
      .toBe('blob:local-review-image');
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const apply = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Use details and continue');
    if (!checkbox || !apply) throw new Error('Expected OCR review controls');
    expect(apply.disabled).toBe(true);
    expect(container.textContent).toContain('Image OCR remains pending');

    act(() => checkbox.click());
    expect(apply.disabled).toBe(false);
    act(() => apply.click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'CASEY EXAMPLE' }), 'id-image-ocr');

    act(() => root.unmount());
    expect(createObjectUrl).toHaveBeenCalledExactlyOnceWith(file);
    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith('blob:local-review-image');
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
    container.remove();
  });

  it('keeps a PDF417 decoded from an image pending until explicit image comparison', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image-pdf417') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const readImage = vi.fn(async () => ({
      identity: {
        fullName: 'CASEY EXAMPLE',
        dateOfBirth: '1990-01-02',
        address: '100 TEST WAY, AUSTIN, TX 78701',
        age: 36
      },
      captureMethod: 'id-image-pdf417' as const
    }));
    const { container, onApply, root } = mountPanel({ readImage });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose government ID image"]');
    if (!input) throw new Error('Expected the image input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['synthetic'], 'synthetic-license.png', { type: 'image/png' })]
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const apply = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Use details and continue');
    if (!checkbox || !apply) throw new Error('Expected image review controls');
    expect(container.textContent).toContain('Image barcode capture remains pending');
    expect(apply.disabled).toBe(true);
    act(() => checkbox.click());
    act(() => apply.click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'CASEY EXAMPLE' }), 'id-image-pdf417');

    act(() => root.unmount());
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
    container.remove();
  });

  it('aborts an in-flight image read when the panel unmounts', () => {
    let signal: AbortSignal | undefined;
    const readImage = vi.fn((_file: File, options?: Parameters<NonNullable<React.ComponentProps<typeof IdEnrollmentPanel>['readImage']>>[1]) => {
      signal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    const { container, root } = mountPanel({ readImage });
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Choose government ID image"]');
    if (!input) throw new Error('Expected the image input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['synthetic'], 'synthetic-license.png', { type: 'image/png' })]
    });

    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(signal?.aborted).toBe(false);
    act(() => root.unmount());
    expect(signal?.aborted).toBe(true);
    container.remove();
  });
});
