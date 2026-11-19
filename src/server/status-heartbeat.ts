export function startStatusHeartbeat(
  emit: (event: Record<string, unknown>) => Promise<void> | void,
  event: Record<string, unknown>,
  intervalMs = 1500,
) {
  let active = true;
  let inFlight = false;

  const timer = setInterval(async () => {
    if (!active || inFlight) {
      return;
    }

    inFlight = true;
    try {
      await emit({ ...event });
    } catch {
      // Heartbeats are best-effort; the main workflow result path still owns errors.
    } finally {
      inFlight = false;
    }
  }, intervalMs);

  timer.unref?.();

  return () => {
    active = false;
    clearInterval(timer);
  };
}
