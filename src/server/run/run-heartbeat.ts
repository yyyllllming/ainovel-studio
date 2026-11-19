export async function runWithHeartbeat<T>(
  task: () => Promise<T>,
  touch: () => void | Promise<void>,
  input?: {
    intervalMs?: number;
    onError?: (error: unknown) => void | Promise<void>;
  },
) {
  const intervalMs = Math.max(10, input?.intervalMs ?? 20_000);
  let touching = false;

  const reportTouchError = (error: unknown) =>
    Promise.resolve()
      .then(() => input?.onError?.(error))
      .catch(() => { /* onError callback itself failed — nothing to escalate to */ });

  const timer = setInterval(() => {
    if (touching) {
      return;
    }
    touching = true;
    void Promise.resolve()
      .then(() => touch())
      .catch((error) => reportTouchError(error))
      .finally(() => {
        touching = false;
      });
  }, intervalMs);

  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}
