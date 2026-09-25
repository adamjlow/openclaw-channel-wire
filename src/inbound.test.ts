import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextMessage } from "@wireapp/wire-apps-js-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import { resolveWireAccount } from "./config.js";
import { clearConnectionStates, lookupDmConversation } from "./connection-state.js";
import {
  createInboundSink,
  handleInboundMessage,
  normalizeTextMessage,
  RecentIds,
  stripMentions,
  type InboundText,
} from "./inbound.js";
import type { WireApi } from "./wire-api.js";

const pairing = vi.hoisted(() => ({
  issueChallenge: vi.fn(),
  readAllowFromStore: vi.fn(async () => [] as string[]),
}));
vi.mock("openclaw/plugin-sdk/channel-pairing", () => ({
  createChannelPairingController: () => pairing,
}));
vi.mock("openclaw/plugin-sdk/media-local-roots", () => ({
  getAgentScopedMediaLocalRoots: () => ["/workspace"],
}));
vi.mock("openclaw/plugin-sdk/channel-inbound", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openclaw/plugin-sdk/channel-inbound")>()),
  resolveChannelInboundRouteEnvelope: () => ({
    route: { agentId: "main", sessionKey: "agent:main:wire:direct:x", accountId: "default", dmScope: "per-peer" },
    buildEnvelope: ({ body }: { body: string }) => `[Wire] ${body}`,
  }),
}));

const APP = { id: "app-uuid", domain: "wire.example" };
const ALICE = { id: "AAAA-1111", domain: "wire.example" };
const CONV = { id: "conv-1", domain: "wire.example" };
const config = {
  channels: { wire: { apiHost: "https://h.example", apiToken: "t", cryptoKey: "k", allowFrom: ["aaaa-1111@wire.example"] } },
} as unknown as OpenClawConfig;

function fakeApi(kind: "direct" | "group" | "unknown" = "direct"): WireApi & {
  sendText: ReturnType<typeof vi.fn>;
  downloadAsset: ReturnType<typeof vi.fn>;
  sendAsset: ReturnType<typeof vi.fn>;
} {
  return {
    appId: () => APP,
    sendText: vi.fn(async () => "sent-id"),
    getConversationKind: vi.fn(async () => kind),
    getUserName: vi.fn(async () => "Alice"),
    downloadAsset: vi.fn(async () => new Uint8Array([1, 2, 3])),
    sendAsset: vi.fn(async () => "asset-msg-id"),
    findDmConversation: vi.fn(async () => undefined),
    getConversationName: vi.fn(async () => "Project team"),
  };
}

function fakeCore(admission: string, opts: { patternMention?: boolean } = {}) {
  const message = vi.fn(async () => ({
    ingress: { admission },
    commandAccess: { authorized: true },
  }));
  const buildContext = vi.fn((input: unknown) => ({ built: input }));
  const dispatch = vi.fn(async () => undefined);
  const saveMediaBuffer = vi.fn(async () => ({ id: "media-1", path: "/state/media/inbound/media-1.pdf", size: 3, contentType: "application/pdf" }));
  const loadWebMedia = vi.fn(async () => ({ buffer: Buffer.from("PDF"), contentType: "application/pdf", fileName: "report.pdf", kind: "document" }));
  const core = {
    media: { loadWebMedia },
    channel: {
      media: { saveMediaBuffer },
      commands: { shouldHandleTextCommands: () => true },
      text: { hasControlCommand: () => false },
      mentions: {
        buildMentionRegexes: () => [],
        matchesMentionPatterns: () => Boolean(opts.patternMention),
      },
      inbound: { ingress: { createResolver: vi.fn(() => ({ message })) }, buildContext, dispatch },
    },
  } as unknown as PluginRuntime;
  return { core, message, buildContext, dispatch, saveMediaBuffer, loadWebMedia };
}

const event = (overrides: Partial<InboundText> = {}): InboundText => ({
  messageId: "m-1",
  conversation: CONV,
  sender: ALICE,
  timestamp: 1_700_000_000_000,
  text: "  summarise my day  ",
  mentions: [],
  ...overrides,
});

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("handleInboundMessage", () => {
  beforeEach(() => {
    pairing.issueChallenge.mockReset();
    clearConnectionStates();
  });

  it("dispatches an admitted DM and replies in the same conversation", async () => {
    const { core, message, buildContext, dispatch } = fakeCore("dispatch");
    const api = fakeApi();
    await handleInboundMessage(event(), api, { core, cfg: config, account: resolveWireAccount(config) });

    expect(message).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: { stableId: "aaaa-1111@wire.example" },
        conversation: { kind: "direct", id: "conv-1@wire.example" },
        dmPolicy: "pairing",
        allowFrom: ["aaaa-1111@wire.example"],
      }),
    );
    expect(buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: { id: "aaaa-1111@wire.example", name: "Alice" },
        reply: { to: "conv-1@wire.example", originatingTo: "conv-1@wire.example" },
        message: expect.objectContaining({ bodyForAgent: "summarise my day" }),
      }),
    );
    const { delivery } = (dispatch.mock.calls[0] as unknown as [{ delivery: { deliver: (p: unknown) => Promise<void> } }])[0];
    await delivery.deliver({ text: "Here is your day." });
    expect(api.sendText).toHaveBeenCalledWith(CONV, "Here is your day.", { replyToId: null });
    expect(lookupDmConversation("default", "aaaa-1111@wire.example")).toBe("conv-1@wire.example");
  });

  it("issues a pairing challenge instead of dispatching an unknown sender", async () => {
    const { core, dispatch } = fakeCore("pairing-required");
    const api = fakeApi();
    await handleInboundMessage(event(), api, { core, cfg: config, account: resolveWireAccount(config) });

    expect(dispatch).not.toHaveBeenCalled();
    expect(pairing.issueChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: "aaaa-1111@wire.example", meta: { conversation: "conv-1@wire.example" } }),
    );
    const { sendPairingReply } = pairing.issueChallenge.mock.calls[0]![0] as { sendPairingReply: (t: string) => Promise<void> };
    await sendPairingReply("Your code is 1234");
    expect(api.sendText).toHaveBeenCalledWith(CONV, "Your code is 1234", { replyToId: null });
  });

  it.each(["block", "skip", "drop"])("drops a DM with admission %s", async (admission) => {
    const { core, dispatch } = fakeCore(admission);
    const api = fakeApi();
    await handleInboundMessage(event(), api, { core, cfg: config, account: resolveWireAccount(config) });
    expect(dispatch).not.toHaveBeenCalled();
    expect(pairing.issueChallenge).not.toHaveBeenCalled();
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("drops messages from unknown conversations before policy", async () => {
    const { core, message } = fakeCore("dispatch");
    await handleInboundMessage(event(), fakeApi("unknown"), { core, cfg: config, account: resolveWireAccount(config) });
    expect(message).not.toHaveBeenCalled();
  });

  it("routes a mentioned group message by conversation with mention facts and strips the tag", async () => {
    const { core, message, buildContext, dispatch } = fakeCore("dispatch");
    const text = "@Assistant summarise this thread";
    await handleInboundMessage(
      event({ text, mentions: [{ userKey: "app-uuid@wire.example", offset: 0, length: 10 }] }),
      fakeApi("group"),
      { core, cfg: config, account: resolveWireAccount(config) },
    );
    expect(message).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: { kind: "group", id: "conv-1@wire.example" },
        mentionFacts: { canDetectMention: true, wasMentioned: true, hasAnyMention: true },
        policy: expect.objectContaining({
          groupAllowFromFallbackToAllowFrom: true,
          activation: expect.objectContaining({ requireMention: true }),
        }),
      }),
    );
    expect(buildContext).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: { kind: "group", id: "conv-1@wire.example", label: "Project team" },
        message: expect.objectContaining({ bodyForAgent: "summarise this thread" }),
        access: expect.objectContaining({ mentions: { canDetectMention: true, wasMentioned: true } }),
      }),
    );
    expect(dispatch).toHaveBeenCalled();
  });

  it("reports an unmentioned group message and skips it when the resolver says so", async () => {
    const { core, message, dispatch } = fakeCore("skip");
    await handleInboundMessage(event(), fakeApi("group"), { core, cfg: config, account: resolveWireAccount(config) });
    expect(message).toHaveBeenCalledWith(
      expect.objectContaining({ mentionFacts: { canDetectMention: true, wasMentioned: false, hasAnyMention: false } }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("treats a mention of someone else as not mentioning the app", async () => {
    const { core, message } = fakeCore("skip");
    await handleInboundMessage(
      event({ text: "@Bob can you check", mentions: [{ userKey: "bob@wire.example", offset: 0, length: 4 }] }),
      fakeApi("group"),
      { core, cfg: config, account: resolveWireAccount(config) },
    );
    expect(message).toHaveBeenCalledWith(
      expect.objectContaining({ mentionFacts: { canDetectMention: true, wasMentioned: false, hasAnyMention: true } }),
    );
  });

  it("counts OpenClaw mention patterns as a mention", async () => {
    const { core, message } = fakeCore("dispatch", { patternMention: true });
    await handleInboundMessage(event({ text: "Molty, what's next?" }), fakeApi("group"), {
      core,
      cfg: config,
      account: resolveWireAccount(config),
    });
    expect(message).toHaveBeenCalledWith(expect.objectContaining({ mentionFacts: expect.objectContaining({ wasMentioned: true }) }));
  });

  it("passes requireMention: false through when configured", async () => {
    const cfg = { channels: { wire: { ...config.channels!.wire, requireMention: false } } } as unknown as OpenClawConfig;
    const { core, message } = fakeCore("dispatch");
    await handleInboundMessage(event(), fakeApi("group"), { core, cfg, account: resolveWireAccount(cfg) });
    expect(message).toHaveBeenCalledWith(
      expect.objectContaining({ policy: expect.objectContaining({ activation: expect.objectContaining({ requireMention: false }) }) }),
    );
  });

  it("ignores the app's own messages and empty text", async () => {
    const { core, message } = fakeCore("dispatch");
    const account = resolveWireAccount(config);
    await handleInboundMessage(event({ sender: APP }), fakeApi(), { core, cfg: config, account });
    await handleInboundMessage(event({ text: "   " }), fakeApi(), { core, cfg: config, account });
    expect(message).not.toHaveBeenCalled();
  });

  it("never logs message text or sender ids", async () => {
    const l = log();
    for (const admission of ["dispatch", "pairing-required", "block"]) {
      const { core } = fakeCore(admission);
      await handleInboundMessage(event(), fakeApi(), { core, cfg: config, account: resolveWireAccount(config), log: l });
    }
    const logged = JSON.stringify(Object.values(l).map((fn) => fn.mock.calls));
    expect(logged).not.toMatch(/summarise|aaaa-1111|conv-1/i);
  });
});

describe("inbound files", () => {
  const assetEvent = (asset: Partial<NonNullable<InboundText["asset"]>> = {}): InboundText =>
    event({
      text: "",
      asset: { name: "report.pdf", mimeType: "application/pdf", sizeInBytes: 3, remoteData: { assetId: "a" }, ...asset },
    });

  it("downloads an admitted file into the media store and passes it as media facts", async () => {
    const { core, buildContext, dispatch, saveMediaBuffer } = fakeCore("dispatch");
    const api = fakeApi();
    await handleInboundMessage(assetEvent(), api, { core, cfg: config, account: resolveWireAccount(config) });
    expect(api.downloadAsset).toHaveBeenCalledWith({ assetId: "a" });
    expect(saveMediaBuffer).toHaveBeenCalledWith(expect.any(Buffer), "application/pdf", "inbound", 25 * 1024 * 1024, "report.pdf");
    const ctx = (buildContext.mock.calls[0] as unknown as [{ media: Array<{ path: string }>; message: { bodyForAgent: string } }])[0];
    expect(ctx.media[0]).toMatchObject({ path: "/state/media/inbound/media-1.pdf" });
    expect(ctx.message.bodyForAgent).not.toBe("");
    expect(dispatch).toHaveBeenCalled();
  });

  it("never downloads a file from a sender that policy did not admit", async () => {
    const { core, saveMediaBuffer } = fakeCore("pairing-required");
    const api = fakeApi();
    await handleInboundMessage(assetEvent(), api, { core, cfg: config, account: resolveWireAccount(config) });
    expect(api.downloadAsset).not.toHaveBeenCalled();
    expect(saveMediaBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ["a disallowed type", { mimeType: "application/x-msdownload" }, /type of file/],
    ["an oversized declared size", { sizeInBytes: 26 * 1024 * 1024 }, /too large/],
    ["missing remote data", { remoteData: undefined }, /couldn't retrieve/],
  ])("replies with a notice and skips the agent for %s", async (_label, asset, notice) => {
    const { core, dispatch } = fakeCore("dispatch");
    const api = fakeApi();
    await handleInboundMessage(assetEvent(asset), api, { core, cfg: config, account: resolveWireAccount(config) });
    expect(api.downloadAsset).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(api.sendText).toHaveBeenCalledWith(CONV, expect.stringMatching(notice), { replyToId: null });
  });

  it("rejects a download larger than the limit even if the declared size lied", async () => {
    const small = { ...config.channels!.wire, assetPolicy: { maxBytes: 2 } };
    const cfg = { channels: { wire: small } } as unknown as OpenClawConfig;
    const { core, dispatch, saveMediaBuffer } = fakeCore("dispatch");
    const api = fakeApi();
    await handleInboundMessage(assetEvent({ sizeInBytes: 1 }), api, { core, cfg, account: resolveWireAccount(cfg) });
    expect(saveMediaBuffer).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(api.sendText).toHaveBeenCalledWith(CONV, "That file is too large.", { replyToId: null });
  });

  it("sends agent media replies as native Wire files with the caption as a follow-up", async () => {
    const { core, dispatch, loadWebMedia } = fakeCore("dispatch");
    const api = fakeApi();
    await handleInboundMessage(event(), api, { core, cfg: config, account: resolveWireAccount(config) });
    const { delivery } = (dispatch.mock.calls[0] as unknown as [{ delivery: { deliver: (p: unknown) => Promise<void> } }])[0];
    await delivery.deliver({ text: "Here it is", mediaUrl: "/workspace/out/report.pdf" });
    expect(loadWebMedia).toHaveBeenCalledWith("/workspace/out/report.pdf", expect.objectContaining({ localRoots: ["/workspace"] }));
    expect(api.sendAsset).toHaveBeenCalledWith(CONV, expect.objectContaining({ name: "report.pdf", mimeType: "application/pdf" }));
    expect(api.sendText).toHaveBeenCalledWith(CONV, "Here it is", { replyToId: null });
  });
});

describe("stripMentions", () => {
  it("removes only the app's mention spans, last first", () => {
    const text = "@Bob and @Assistant please check";
    const mentions = [
      { userKey: "bob@w", offset: 0, length: 4 },
      { userKey: "app@w", offset: 9, length: 10 },
    ];
    expect(stripMentions(text, mentions, "app@w")).toBe("@Bob and please check");
  });

  it("ignores out-of-range spans", () => {
    expect(stripMentions("hi", [{ userKey: "app@w", offset: 5, length: 3 }], "app@w")).toBe("hi");
  });
});

describe("normalizeTextMessage", () => {
  it("copies ids, text and mentions, and rejects unattributed messages", () => {
    const msg = {
      id: "m",
      conversationId: CONV,
      sender: ALICE,
      timestamp: new Date(5),
      text: "hi",
      mentions: [{ userId: { id: "App", domain: "wire.example" }, offset: 0, length: 3 }],
    } as unknown as TextMessage;
    expect(normalizeTextMessage(msg)).toEqual({
      messageId: "m",
      conversation: CONV,
      sender: ALICE,
      timestamp: 5,
      text: "hi",
      mentions: [{ userKey: "app@wire.example", offset: 0, length: 3 }],
    });
    expect(normalizeTextMessage({ ...msg, sender: undefined } as unknown as TextMessage)).toBeNull();
  });
});

describe("RecentIds", () => {
  it("reports first sightings and evicts the oldest past capacity", () => {
    const ids = new RecentIds(2);
    expect(ids.add("a")).toBe(true);
    expect(ids.add("a")).toBe(false);
    ids.add("b");
    ids.add("c");
    expect(ids.add("a")).toBe(true);
  });
});

describe("createInboundSink", () => {
  it("dedupes by message id and serialises per conversation", async () => {
    const { core, message } = fakeCore("block");
    const controller = new AbortController();
    const sink = createInboundSink({ core, cfg: config, account: resolveWireAccount(config), abortSignal: controller.signal });
    const msg = { id: "dup", conversationId: CONV, sender: ALICE, timestamp: new Date(), text: "hi" } as unknown as TextMessage;
    const api = fakeApi();
    sink.onTextMessage?.(msg, api);
    sink.onTextMessage?.(msg, api);
    await vi.waitFor(() => expect(message).toHaveBeenCalledTimes(1));
    controller.abort();
  });
});
