import { describe, expect, it, vi } from "vitest";
import { createSdkLogger } from "./sdk-logger.js";

const sink = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("createSdkLogger", () => {
  it("drops SDK debug output (it contains raw event payloads)", () => {
    const s = sink();
    createSdkLogger(s).debug("Routing event:", { payload: "secret" });
    expect(Object.values(s).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("demotes info to debug", () => {
    const s = sink();
    createSdkLogger(s).info("Websocket Connected");
    expect(s.debug).toHaveBeenCalledWith("[wire-sdk] Websocket Connected");
    expect(s.info).not.toHaveBeenCalled();
  });

  it("keeps only Error messages from metadata", () => {
    const s = sink();
    createSdkLogger(s).error("Connection error:", new Error("ECONNREFUSED"), { userId: "raw-id" });
    expect(s.error).toHaveBeenCalledWith("[wire-sdk] Connection error: (ECONNREFUSED)");
    expect(JSON.stringify(s.error.mock.calls)).not.toContain("raw-id");
  });

  it("signals when the SDK gives up reconnecting", () => {
    const onGiveUp = vi.fn();
    const logger = createSdkLogger(sink(), onGiveUp);
    logger.error("Websocket Error:", new Error("boom"));
    expect(onGiveUp).not.toHaveBeenCalled();
    logger.error("WebSocket stopped after 10 failed reconnect attempts");
    expect(onGiveUp).toHaveBeenCalledOnce();
  });
});
