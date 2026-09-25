import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendConnectionListener, WireApplicationManager } from "@wireapp/wire-apps-js-sdk";
import type { ChannelAccountSnapshot, ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { resolveWireAccount, type WireResolvedAccount } from "./config.js";
import type { CreateWireSdk, WireSdkLike } from "./connection.js";
import { clearConnectionStates, getConnectionState } from "./connection-state.js";
import { resolveStoragePath, startWireAccount } from "./gateway.js";

const HEX = "ab".repeat(32);
const config = {
  channels: {
    wire: {
      apiHost: "https://wire.example",
      apiToken: "token-value",
      cryptoKey: HEX,
    },
  },
} as unknown as OpenClawConfig;

class FakeSdk implements WireSdkLike {
  listener?: BackendConnectionListener;
  api = {
    appId: () => ({ id: "app-uuid", domain: "wire.example" }),
    sendText: vi.fn(async () => "msg-id"),
    getConversationKind: vi.fn(async () => "direct" as const),
    getUserName: vi.fn(async () => undefined),
    downloadAsset: vi.fn(async () => new Uint8Array([1, 2, 3])),
    sendAsset: vi.fn(async () => "asset-msg-id"),
    findDmConversation: vi.fn(async () => undefined),
    getConversationName: vi.fn(async () => undefined),
  };
  calls: string[] = [];
  startListeningImpl: () => Promise<void> = async () => undefined;

  async startListening() {
    this.calls.push("startListening");
    await this.startListeningImpl();
  }
  stopListening() {
    this.calls.push("stopListening");
  }
  async close() {
    this.calls.push("close");
  }
  setBackendConnectionListener(listener: BackendConnectionListener) {
    this.listener = listener;
  }
  getApplicationManager() {
    return {
      getApplicationQualifiedId: () => ({ id: "app-uuid", domain: "wire.example" }),
    } as unknown as WireApplicationManager;
  }
}

function makeCtx(overrides: Partial<ChannelGatewayContext<WireResolvedAccount>> = {}) {
  const controller = new AbortController();
  const statuses: ChannelAccountSnapshot[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    cfg: config,
    accountId: "default",
    account: resolveWireAccount(config),
    runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    abortSignal: controller.signal,
    log,
    getStatus: () => statuses.at(-1) ?? { accountId: "default" },
    setStatus: (next: ChannelAccountSnapshot) => statuses.push(next),
    ...overrides,
  } as ChannelGatewayContext<WireResolvedAccount>;
  return { ctx, controller, statuses, log };
}

const latest = (statuses: ChannelAccountSnapshot[]) => Object.assign({}, ...statuses) as ChannelAccountSnapshot;

describe("startWireAccount", () => {
  let sdk: FakeSdk;
  let createSdk: ReturnType<typeof vi.fn<CreateWireSdk>>;

  beforeEach(() => {
    sdk = new FakeSdk();
    createSdk = vi.fn<CreateWireSdk>(async () => sdk);
    clearConnectionStates();
  });
  afterEach(() => vi.useRealTimers());

  const deps = () => ({ createSdk, resolveStateDir: () => "/state", createSink: () => ({}) });

  it("fails closed when the account is not configured", async () => {
    const unconfigured = { channels: { wire: {} } } as unknown as OpenClawConfig;
    const { ctx } = makeCtx({ cfg: unconfigured, account: resolveWireAccount(unconfigured) });
    await expect(startWireAccount(ctx, deps())).rejects.toThrow(/missing: apiHost, apiToken, cryptoKey/);
    expect(createSdk).not.toHaveBeenCalled();
  });

  it("creates the SDK with decoded credentials and a per-account storage path", async () => {
    const { ctx, controller } = makeCtx();
    const run = startWireAccount(ctx, deps());
    await vi.waitFor(() => expect(sdk.calls).toContain("startListening"));
    const params = createSdk.mock.calls[0]![0];
    expect(params.storagePath).toBe("/state/wire/default");
    expect(params.credentials.apiToken).toBe("token-value");
    expect(params.credentials.cryptographyStorageKey.length).toBe(32);
    controller.abort();
    await run;
  });

  it("stays running until aborted, then stops listening and closes", async () => {
    const { ctx, controller, statuses } = makeCtx();
    const run = startWireAccount(ctx, deps());
    await vi.waitFor(() => expect(sdk.listener).toBeDefined());

    sdk.listener!.onConnected();
    expect(latest(statuses)).toMatchObject({ running: true, connected: true, lifecycle: "ready" });
    expect(getConnectionState("default")?.connected).toBe(true);

    controller.abort();
    await run;
    expect(sdk.calls).toEqual(["startListening", "stopListening", "close"]);
    expect(latest(statuses)).toMatchObject({ running: false, connected: false, lifecycle: "stopped" });
    expect(getConnectionState("default")).toMatchObject({ running: false, connected: false });
  });

  it("reports a disconnect as recovering without ending the run", async () => {
    const { ctx, controller, statuses } = makeCtx();
    const run = startWireAccount(ctx, deps());
    await vi.waitFor(() => expect(sdk.listener).toBeDefined());
    sdk.listener!.onConnected();
    sdk.listener!.onDisconnected();
    expect(latest(statuses)).toMatchObject({ connected: false, lifecycle: "recovering" });
    expect(sdk.calls).not.toContain("close");
    controller.abort();
    await run;
  });

  it("ends the run with an error when the connection never comes back", async () => {
    vi.useFakeTimers();
    const { ctx, statuses } = makeCtx();
    const run = startWireAccount(ctx, { ...deps(), reconnectTimeoutMs: 1000 });
    const settled = run.catch((err: unknown) => err);
    await vi.waitFor(() => expect(sdk.listener).toBeDefined());
    sdk.listener!.onConnected();
    sdk.listener!.onDisconnected();
    await vi.advanceTimersByTimeAsync(1000);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/unreachable/);
    expect(sdk.calls).toContain("close");
    expect(latest(statuses)).toMatchObject({ running: false, lastError: expect.stringMatching(/unreachable/) });
  });

  it("closes the SDK and rethrows when startListening fails", async () => {
    sdk.startListeningImpl = async () => {
      throw new Error("join failed");
    };
    const { ctx } = makeCtx();
    await expect(startWireAccount(ctx, deps())).rejects.toThrow("join failed");
    expect(sdk.calls).toEqual(["startListening", "stopListening", "close"]);
  });

  it("does nothing when already aborted", async () => {
    const { ctx, controller } = makeCtx();
    controller.abort();
    await startWireAccount(ctx, deps());
    expect(createSdk).not.toHaveBeenCalled();
  });

  it("never logs credential values", async () => {
    const { ctx, controller, log } = makeCtx();
    const run = startWireAccount(ctx, deps());
    await vi.waitFor(() => expect(sdk.listener).toBeDefined());
    controller.abort();
    await run;
    const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    expect(logged).not.toContain("token-value");
    expect(logged).not.toContain(HEX);
  });
});

describe("resolveStoragePath", () => {
  it("nests SDK storage under the OpenClaw state dir", () => {
    expect(resolveStoragePath("default", "/home/node/.openclaw")).toBe("/home/node/.openclaw/wire/default");
  });
});
