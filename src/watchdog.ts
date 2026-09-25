// Detects a Wire connection that is not coming back. SDK 0.1.0 stops
// reconnecting after 10 failures (~4.5 minutes of backoff) without notifying
// anyone, and a failed first connect produces no disconnect event. So: arm on
// start and on every disconnect; if no connect arrives within the timeout,
// fire once so the account run can end and OpenClaw restarts it.
export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const DEFAULT_RECONNECT_TIMEOUT_MS = 5 * 60 * 1000;

export class ConnectionWatchdog {
  private handle: unknown;
  private fired = false;
  private stopped = false;

  constructor(
    private readonly onTimeout: () => void,
    private readonly timeoutMs = DEFAULT_RECONNECT_TIMEOUT_MS,
    private readonly timers: Timers = defaultTimers,
  ) {}

  /** Start waiting for a connection (call at start and on each disconnect). */
  arm(): void {
    if (this.stopped || this.fired || this.handle !== undefined) return;
    this.handle = this.timers.setTimeout(() => {
      this.handle = undefined;
      if (this.stopped) return;
      this.fired = true;
      this.onTimeout();
    }, this.timeoutMs);
  }

  connected(): void {
    this.clear();
  }

  disconnected(): void {
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private clear(): void {
    if (this.handle !== undefined) {
      this.timers.clearTimeout(this.handle);
      this.handle = undefined;
    }
  }
}
