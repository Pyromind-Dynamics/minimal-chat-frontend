export const OBSERVATION_POLL_INTERVAL_MS = 5_000;
export const LIVE_TRAINING_POLL_INTERVAL_MS = 1_000;

export interface PollingCallbacks<T> {
  read: (signal: AbortSignal) => Promise<T>;
  onData: (value: T) => void;
  onError: (error: Error) => void;
  isVisible: () => boolean;
  isTrainingRunning?: () => boolean;
  delay?: number;
}
export function startObservationPolling<T>(callbacks: PollingCallbacks<T>) {
  let active = true;
  let halted = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let nextAt = 0;
  let invalidated = false;
  const delay = Math.max(OBSERVATION_POLL_INTERVAL_MS, callbacks.delay ?? OBSERVATION_POLL_INTERVAL_MS);
  function schedule() {
    clearTimeout(timer);
    if (active && !halted && callbacks.isVisible()) timer = setTimeout(refresh, Math.max(0, nextAt - Date.now()));
  }
  async function refresh() {
    if (!active || halted || controller || !callbacks.isVisible()) return;
    if (Date.now() < nextAt) { schedule(); return; }
    const request = new AbortController();
    controller = request;
    const interval = callbacks.isTrainingRunning?.() ? LIVE_TRAINING_POLL_INTERVAL_MS : delay;
    nextAt = Date.now() + interval;
    try {
      const value = await callbacks.read(request.signal);
      if (active && !request.signal.aborted) { failures = 0; callbacks.onData(value); }
    } catch (value) {
      if (active && !request.signal.aborted) {
        const error = value instanceof Error ? value : new Error(String(value));
        halted = 'status' in error && (error.status === 401 || error.status === 403);
        failures += 1;
        nextAt = Date.now() + Math.min(300_000, delay * 2 ** Math.min(failures, 4));
        callbacks.onError(error);
      }
    } finally {
      if (controller === request) controller = undefined;
      if (invalidated) { invalidated = false; nextAt = 0; }
      schedule();
    }
  }
  function visibilityChanged() {
    if (!callbacks.isVisible()) { clearTimeout(timer); controller?.abort(); }
    else { void refresh(); }
  }
  function invalidate() {
    if (!active || halted) return;
    nextAt = 0;
    if (controller) invalidated = true;
    else { void refresh(); }
  }
  void refresh();
  return {
    refresh, invalidate, visibilityChanged,
    stop: () => { active = false; clearTimeout(timer); controller?.abort(); },
  };
}
