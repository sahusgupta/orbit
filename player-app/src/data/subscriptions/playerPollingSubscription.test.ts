import { describe, expect, it, vi } from 'vitest';
import { createPlayerPollingSubscription } from './playerPollingSubscription';

function deferred() {
  let resolve: () => void = () => { throw new Error('Deferred fixture was not initialized.'); };
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('Player polling completion ownership', () => {
  it('preserves the next owner when a notification runs between the final read and completion settlement', async () => {
    const first = deferred(), second = deferred();
    const read = vi.fn<() => Promise<void>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const polling = createPlayerPollingSubscription(read, 60_000);
    let notificationTask: Promise<void> | undefined;
    // Register first so this notification runs after the drain's final check,
    // but before the completion's resolver resumes its awaiting caller.
    void first.promise.then(() => queueMicrotask(() => { notificationTask = polling.refresh(); }));
    const initialTask = polling.refresh();
    first.resolve();
    await initialTask;

    expect(read).toHaveBeenCalledTimes(2);
    if (!notificationTask) throw new Error('The completion notification did not run.');
    expect(notificationTask).not.toBe(initialTask);
    expect(polling.refresh()).toBe(notificationTask);
    polling.stopPolling();
    second.resolve();
    await notificationTask;
    expect(read).toHaveBeenCalledTimes(2);
    polling.unsubscribe();
  });

  it('rejects a synchronous operation failure without retaining ownership or hiding its error', async () => {
    const failure = new Error('Synthetic synchronous read failure');
    const read = vi.fn<() => Promise<void>>()
      .mockImplementationOnce(() => { throw failure; })
      .mockResolvedValueOnce(undefined);
    const polling = createPlayerPollingSubscription(read, 60_000);
    const first = polling.refresh();
    expect(read).toHaveBeenCalledOnce();
    await expect(first).rejects.toBe(failure);
    await expect(polling.refresh()).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
    polling.unsubscribe();
  });
});
