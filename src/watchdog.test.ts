import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionWatchdog } from "./watchdog.js";

describe("ConnectionWatchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires when no connection arrives after arming", () => {
    const onTimeout = vi.fn();
    const dog = new ConnectionWatchdog(onTimeout, 1000);
    dog.arm();
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("is cleared by a connection and re-armed by a disconnect", () => {
    const onTimeout = vi.fn();
    const dog = new ConnectionWatchdog(onTimeout, 1000);
    dog.arm();
    vi.advanceTimersByTime(500);
    dog.connected();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
    dog.disconnected();
    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("does not restart the window on repeated disconnects", () => {
    const onTimeout = vi.fn();
    const dog = new ConnectionWatchdog(onTimeout, 1000);
    dog.disconnected();
    vi.advanceTimersByTime(600);
    dog.disconnected();
    vi.advanceTimersByTime(400);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("fires at most once and never after stop", () => {
    const onTimeout = vi.fn();
    const dog = new ConnectionWatchdog(onTimeout, 1000);
    dog.arm();
    vi.advanceTimersByTime(1000);
    dog.disconnected();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).toHaveBeenCalledOnce();

    const stopped = vi.fn();
    const other = new ConnectionWatchdog(stopped, 1000);
    other.arm();
    other.stop();
    other.disconnected();
    vi.advanceTimersByTime(5000);
    expect(stopped).not.toHaveBeenCalled();
  });
});
