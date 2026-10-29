export function createPlayerPollingSubscription(refreshOperation: () => Promise<void>, intervalMs: number) {
  let retired = false;
  let pending = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const requestRefresh = (invalidate: boolean): Promise<void> => {
    if (retired) return Promise.resolve();
    if (inFlight) {
      if (invalidate) pending = true;
      return inFlight;
    }

    let start: () => void = () => undefined;
    const owned = new Promise<void>((resolve, reject) => {
      start = () => {
        const drain = async () => {
          try {
            do {
              pending = false;
              await refreshOperation();
            } while (!retired && pending);
          } finally {
            // Release ownership in the same continuation that checks pending work.
            pending = false;
            inFlight = null;
          }
        };
        void drain().then(resolve, reject);
      };
    });
    // Publish the completion before invoking a read, preserving immediate fetch start.
    inFlight = owned;
    start();
    return owned;
  };

  const stopPolling = () => {
    pending = false;
    clearTimer();
  };

  return {
    refresh: () => requestRefresh(true),
    startPolling() {
      if (retired) return;
      // Reset only the timer; a foreground refresh may already have queued work.
      clearTimer();
      timer = setInterval(() => void requestRefresh(false), intervalMs);
    },
    stopPolling,
    unsubscribe() {
      retired = true;
      stopPolling();
    }
  };
}
