import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleAtBoundary } from './boundary-timer';

afterEach(() => vi.useRealTimers());

describe('tournament boundary timer', () => {
  it('runs only after the requested boundary and can be cancelled', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const callback = vi.fn();
    const cancel = scheduleAtBoundary(Date.now() + 1_000, callback);
    vi.advanceTimersByTime(1_099);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
    cancel();
  });

  it('does not overflow the platform timer for distant boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const callback = vi.fn();
    scheduleAtBoundary(Date.now() + 2_147_000_500, callback);
    vi.advanceTimersByTime(2_147_000_000);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(callback).toHaveBeenCalledOnce();
  });
});
