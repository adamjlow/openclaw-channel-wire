import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearConnectionStates, setLiveApi } from "./connection-state.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import { resolveWireOutboundTarget, sendWireMedia, sendWireText } from "./outbound.js";
import type { WireApi } from "./wire-api.js";

const CONV = { id: "conv-1", domain: "wire.example" };

function fakeApi(overrides: Partial<WireApi> = {}): WireApi {
  return {
    appId: () => ({ id: "app", domain: "wire.example" }),
    sendText: vi.fn(async () => "wire-msg-id"),
    getConversationKind: vi.fn(async () => "direct" as const),
    getUserName: vi.fn(async () => undefined),
    downloadAsset: vi.fn(async () => new Uint8Array([1, 2, 3])),
    sendAsset: vi.fn(async () => "asset-msg-id"),
    findDmConversation: vi.fn(async () => CONV),
    getConversationName: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("sendWireText", () => {
  beforeEach(() => clearConnectionStates());

  it("sends to a conversation and returns the real Wire message id", async () => {
    const api = fakeApi();
    setLiveApi("default", api);
    const result = await sendWireText({ to: "conv-1@wire.example", text: "hello", replyToId: "orig-1" });
    expect(api.sendText).toHaveBeenCalledWith(CONV, "hello", { replyToId: "orig-1" });
    expect(result).toEqual({ messageId: "wire-msg-id", target: { kind: "conversation", id: "conv-1@wire.example" } });
  });

  it("resolves user: targets to their 1:1 conversation", async () => {
    const api = fakeApi();
    setLiveApi("default", api);
    await sendWireText({ to: "user:alice@wire.example", text: "reminder" });
    expect(api.findDmConversation).toHaveBeenCalledWith({ id: "alice", domain: "wire.example" });
    expect(api.sendText).toHaveBeenCalledWith(CONV, "reminder", { replyToId: null });
  });

  it("throws a not-dispatched error when there is no live connection", async () => {
    await expect(sendWireText({ to: "conv-1@wire.example", text: "x" })).rejects.toMatchObject({
      code: "OPENCLAW_PLATFORM_MESSAGE_NOT_DISPATCHED",
      retryable: true,
    });
  });

  it("throws when a user has no 1:1 conversation", async () => {
    setLiveApi("default", fakeApi({ findDmConversation: vi.fn(async () => undefined) }));
    await expect(sendWireText({ to: "user:bob@wire.example", text: "x" })).rejects.toMatchObject({ retryable: false });
  });

  it("propagates send failures instead of reporting success", async () => {
    setLiveApi("default", fakeApi({ sendText: vi.fn(async () => Promise.reject(new Error("mls failure"))) }));
    await expect(sendWireText({ to: "conv-1@wire.example", text: "x" })).rejects.toThrow("mls failure");
  });

  it("uses the requested account's connection", async () => {
    const other = fakeApi();
    setLiveApi("work", other);
    await sendWireText({ to: "conv-1@wire.example", text: "x", accountId: "work" });
    expect(other.sendText).toHaveBeenCalled();
  });
});

describe("resolveWireOutboundTarget", () => {
  it("canonicalises valid targets and rejects invalid ones", () => {
    expect(resolveWireOutboundTarget({ to: "wire:Conv@Wire.Example" })).toEqual({ ok: true, to: "conv@wire.example" });
    const bad = resolveWireOutboundTarget({ to: "nope" });
    expect(bad.ok).toBe(false);
  });
});

describe("sendWireMedia", () => {
  beforeEach(() => clearConnectionStates());
  const cfg = { channels: { wire: { assetPolicy: { maxBytes: 1234 } } } } as unknown as OpenClawConfig;

  it("uploads the file with the host loader and roots, then sends the caption", async () => {
    const api = fakeApi();
    setLiveApi("default", api);
    const loadWebMedia = vi.fn(async () => ({ buffer: Buffer.from("x"), contentType: "image/png", kind: "image" }));
    const core = { media: { loadWebMedia } } as unknown as PluginRuntime;
    const result = await sendWireMedia(
      { cfg, to: "conv-1@wire.example", text: "chart attached", mediaUrl: "/ws/chart.png", mediaLocalRoots: ["/ws"] },
      core,
    );
    expect(loadWebMedia).toHaveBeenCalledWith("/ws/chart.png", { maxBytes: 1234, localRoots: ["/ws"], optimizeImages: false });
    expect(api.sendAsset).toHaveBeenCalledWith(CONV, expect.objectContaining({ name: "chart.png", mimeType: "image/png" }));
    expect(api.sendText).toHaveBeenCalledWith(CONV, "chart attached");
    expect(result.messageId).toBe("asset-msg-id");
  });

  it("propagates loader refusals (e.g. a path outside the allowed roots)", async () => {
    setLiveApi("default", fakeApi());
    const core = { media: { loadWebMedia: vi.fn(async () => Promise.reject(new Error("path not allowed"))) } } as unknown as PluginRuntime;
    await expect(sendWireMedia({ cfg, to: "conv-1@wire.example", text: "", mediaUrl: "/etc/passwd", mediaLocalRoots: ["/ws"] }, core)).rejects.toThrow(
      "path not allowed",
    );
  });
});
