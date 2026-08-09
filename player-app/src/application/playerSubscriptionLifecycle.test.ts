import { describe, expect, it } from 'vitest';
import type { PlayerAppState } from '../app/playerPlatform';
import { bindPlayerPollingLifecycle, type PlayerPollingSubscription } from './playerSubscriptionLifecycle';

function createHarness(initialState: PlayerAppState | null) {
  const events: string[] = [];
  let listener: ((state: PlayerAppState) => void) | null = null;
  const platform = {
    getCurrentAppState: () => initialState,
    subscribeToAppState(nextListener: (state: PlayerAppState) => void) {
      listener = nextListener;
      events.push('listen');
      return () => events.push('unlisten');
    }
  };
  const subscription: PlayerPollingSubscription = {
    async refresh() {
      events.push('refresh');
    },
    startPolling() {
      events.push('start');
    },
    stopPolling() {
      events.push('stop');
    },
    unsubscribe() {
      events.push('unsubscribe');
    }
  };
  return {
    events,
    platform,
    subscription,
    emit(state: PlayerAppState) {
      if (!listener) throw new Error('App-state listener was not registered.');
      listener(state);
    }
  };
}

describe('Player polling lifecycle', () => {
  it('refreshes immediately, polls while active, refreshes once on foreground return, and tears down both owners', () => {
    const harness = createHarness('active');
    const cleanup = bindPlayerPollingLifecycle(harness.platform, harness.subscription);
    expect(harness.events).toEqual(['listen', 'refresh', 'start']);

    harness.emit('background');
    harness.emit('active');
    harness.emit('active');
    expect(harness.events).toEqual(['listen', 'refresh', 'start', 'stop', 'refresh', 'start', 'start']);

    cleanup();
    expect(harness.events.slice(-2)).toEqual(['unlisten', 'unsubscribe']);
  });

  it('still refreshes in the background but defers polling until the app becomes active', () => {
    const harness = createHarness('background');
    bindPlayerPollingLifecycle(harness.platform, harness.subscription);
    expect(harness.events).toEqual(['listen', 'refresh']);

    harness.emit('active');
    expect(harness.events).toEqual(['listen', 'refresh', 'refresh', 'start']);
  });
});
