import { beforeEach, describe, expect, it } from 'vitest';
import { readRouteQuery, replaceRouteQuery } from './query-state';

beforeEach(() => window.history.replaceState(null, '', '/games'));

describe('discovery route query composition', () => {
  it('reads pending browser query edits before the router snapshot changes', () => {
    window.history.replaceState(null, '', '/games?q=PLO&venue=club-alpha');
    const next = readRouteQuery('/games', new URLSearchParams());
    next.set('status', 'running');

    expect(window.location.search).toBe('?q=PLO&venue=club-alpha');
    replaceRouteQuery('/games', next);
    expect(window.location.search).toBe('?q=PLO&venue=club-alpha&status=running');
  });

  it('keeps another route browser query out of a still-rendered explorer', () => {
    window.history.replaceState(null, '', '/clubs?q=River');
    const next = readRouteQuery('/games', new URLSearchParams('type=plo'));

    expect(next.toString()).toBe('type=plo');
    expect(window.location.pathname).toBe('/clubs');
  });

  it('clears one filter while retaining other pending filters and replace-history behavior', () => {
    window.history.replaceState(null, '', '/games?q=PLO&status=running#results');
    const historyLength = window.history.length;
    const next = readRouteQuery('/games', new URLSearchParams());
    next.delete('status');
    replaceRouteQuery('/games', next);

    expect(`${window.location.pathname}${window.location.search}`).toBe('/games?q=PLO');
    expect(window.history.length).toBe(historyLength);
    expect(window.location.hash).toBe('');
  });

  it('retains the existing empty-query route shape', () => {
    window.history.replaceState(null, '', '/games?q=PLO');
    const next = readRouteQuery('/games', new URLSearchParams());
    next.delete('q');
    replaceRouteQuery('/games', next);

    expect(`${window.location.pathname}${window.location.search}`).toBe('/games');
  });
});
