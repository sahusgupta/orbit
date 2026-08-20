import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  registerDemoResetWatcher,
  type DemoResetWatcher
} from '../demoResetPlugin';

describe('sales-map demo reset development hook', () => {
  it('reloads for its reset signal and ignores unrelated file changes', () => {
    type ResetEvent = 'add' | 'change';
    type ResetListener = (filePath: string) => void;
    const listeners: Record<ResetEvent, ResetListener[]> = {
      add: [],
      change: []
    };
    const watcher: DemoResetWatcher = {
      add: vi.fn(),
      off: vi.fn((event: ResetEvent, listener: ResetListener) => {
        listeners[event] = listeners[event].filter((candidate) => candidate !== listener);
      }),
      on: vi.fn((event: ResetEvent, listener: ResetListener) => {
        listeners[event].push(listener);
      })
    };
    const reload = vi.fn();
    const resetSignalPath = path.resolve('.orbit', 'sales-map-demo-reset');

    const dispose = registerDemoResetWatcher(watcher, reload, resetSignalPath);
    listeners.change[0](path.resolve('.orbit', 'unrelated-state.json'));
    expect(reload).not.toHaveBeenCalled();

    listeners.add[0](resetSignalPath);
    listeners.change[0](resetSignalPath);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenLastCalledWith({ type: 'full-reload', path: '*' });

    dispose();
    expect(listeners.add).toHaveLength(0);
    expect(listeners.change).toHaveLength(0);
  });
});
