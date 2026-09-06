const MAX_TIMER_DELAY_MS = 2_147_000_000;

export function scheduleAtBoundary(boundaryMs: number, callback: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    const remaining = boundaryMs - Date.now() + 100;
    if (remaining <= 0) {
      callback();
      return;
    }
    timer = setTimeout(() => {
      if (Date.now() < boundaryMs) arm();
      else callback();
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  };
  arm();
  return () => clearTimeout(timer);
}
