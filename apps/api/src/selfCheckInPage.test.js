/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const publicDirectory = path.resolve(process.cwd(), 'apps/api/public');
const pageHtml = readFileSync(path.join(publicDirectory, 'self-check-in.html'), 'utf8');
const pageScript = readFileSync(path.join(publicDirectory, 'self-check-in.js'), 'utf8');
const browser = /** @type {any} */ (globalThis);
const window = browser.window;
const document = browser.document;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  document.documentElement.innerHTML = '<head></head><body></body>';
  window.history.replaceState(null, '', '/');
});

describe('retired public self-check-in page', () => {
  it('publishes only truthful authenticated-membership-QR guidance', () => {
    document.documentElement.innerHTML = pageHtml;

    expect(document.querySelector('#assistance-heading')?.textContent).toBe('Printed self-check-in is unavailable');
    expect(document.querySelector('#assistance-message')?.textContent).toContain('short-lived membership QR');
    expect(document.querySelector('#lookup-form')).toBeNull();
    expect(document.querySelector('#player-name')).toBeNull();
    expect(pageHtml).not.toContain('/player/check-in/lookup');
    expect(pageHtml).not.toContain('/player/check-in/seat');
  });

  it('clears legacy credentials without making a network request', () => {
    document.documentElement.innerHTML = pageHtml;
    window.history.replaceState(null, '', '/check-in#token=legacy-name-capability');
    window.sessionStorage.setItem('orbit.selfCheckIn.capability', 'legacy-name-capability');
    window.sessionStorage.setItem('orbit.selfCheckIn.session', 'legacy-name-session');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    Function(pageScript)();

    expect(window.location.hash).toBe('');
    expect(window.sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
    expect(window.sessionStorage.getItem('orbit.selfCheckIn.session')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.querySelector('#assistance-heading'));
  });

  it('contains no active name lookup, seating, or check-in bearer implementation', () => {
    expect(pageScript).not.toContain('fetch(');
    expect(pageScript).not.toContain('x-orbit-check-in-token');
    expect(pageScript).not.toContain('x-orbit-check-in-session');
    expect(pageScript).not.toContain('/player/check-in/');
    expect(pageScript).not.toContain('innerHTML');
  });
});
