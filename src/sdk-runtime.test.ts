import { beforeEach, describe, expect, it, vi } from "vitest";

// A light stand-in for the SDK's value exports: the real package loads
// CoreCrypto's native library, which needs glibc >= 2.38.
vi.mock("@wireapp/wire-apps-js-sdk", () => {
  class QualifiedId {
    constructor(
      readonly id: string,
      readonly domain: string,
    ) {}
  }
  const TextMessage = {
    create: vi.fn((p: { conversationId: unknown; text: string }) => ({ kind: "plain", ...p })),
    createReply: vi.fn((p: { text: string; originalMessage: { conversationId: unknown; ephemeral?: boolean } }) => {
      if (p.originalMessage.ephemeral) throw new Error("ephemeral");
      return { kind: "reply", conversationId: p.originalMessage.conversationId, text: p.text };
    }),
  };
  return {
    QualifiedId,
    TextMessage,
    ConversationType: { GROUP: 0, SELF: 1, ONE_TO_ONE: 2 },
    WireAppSdk: {},
    WireEventsHandler: function WireEventsHandler() {},
  };
});

const { createWireApi } = await import("./sdk-runtime.js");

const CONV = { id: "conv-1", domain: "wire.example" };

function fakeManager() {
  return {
    sendMessage: vi.fn(async () => "sent-id"),
    getAllConversations: vi.fn(async () => [
      { id: "conv-1", domain: "wire.example", type: 2 },
      { id: "grp-1", domain: "wire.example", type: 0 },
    ]),
    getMembersInConversation: vi.fn(async (id: { id: string }) =>
      id.id === "conv-1" ? [{ userId: { id: "alice", domain: "wire.example" } }, { userId: { id: "app", domain: "wire.example" } }] : [],
    ),
    getUsers: vi.fn(async () => [{ name: "Alice" }]),
    getApplicationQualifiedId: () => ({ id: "app", domain: "wire.example" }),
  };
}

describe("createWireApi", () => {
  let manager: ReturnType<typeof fakeManager>;
  let api: ReturnType<typeof createWireApi>;
  beforeEach(() => {
    manager = fakeManager();
    api = createWireApi(() => manager as never);
  });

  it("quotes a cached original when replying in the same conversation", async () => {
    api.rememberMessage({ id: "orig", conversationId: CONV } as never);
    await api.sendText(CONV, "answer", { replyToId: "orig" });
    expect(manager.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "reply", text: "answer" }));
  });

  it("falls back to a plain message for unknown, foreign or unreplyable originals", async () => {
    api.rememberMessage({ id: "other-conv", conversationId: { id: "x", domain: "wire.example" } } as never);
    api.rememberMessage({ id: "ephemeral", conversationId: CONV, ephemeral: true } as never);
    for (const replyToId of ["missing", "other-conv", "ephemeral", null]) {
      await api.sendText(CONV, "answer", { replyToId });
    }
    const kinds = manager.sendMessage.mock.calls.map((call) => (call as unknown as [{ kind: string }])[0].kind);
    expect(kinds).toEqual(["plain", "plain", "plain", "plain"]);
  });

  it("classifies conversations from the local store, caching the scan", async () => {
    expect(await api.getConversationKind(CONV)).toBe("direct");
    expect(await api.getConversationKind({ id: "grp-1", domain: "wire.example" })).toBe("group");
    expect(manager.getAllConversations).toHaveBeenCalledTimes(1);
    expect(await api.getConversationKind({ id: "nope", domain: "wire.example" })).toBe("unknown");
  });

  it("finds a user's 1:1 conversation and caches it", async () => {
    expect(await api.findDmConversation({ id: "alice", domain: "wire.example" })).toEqual(CONV);
    await api.findDmConversation({ id: "alice", domain: "wire.example" });
    expect(manager.getMembersInConversation).toHaveBeenCalledTimes(1);
    expect(await api.findDmConversation({ id: "bob", domain: "wire.example" })).toBeUndefined();
  });

  it("caches display names and tolerates lookup failures", async () => {
    expect(await api.getUserName({ id: "alice", domain: "wire.example" })).toBe("Alice");
    await api.getUserName({ id: "alice", domain: "wire.example" });
    expect(manager.getUsers).toHaveBeenCalledTimes(1);
    manager.getUsers.mockRejectedValueOnce(new Error("offline"));
    expect(await api.getUserName({ id: "bob", domain: "wire.example" })).toBeUndefined();
  });
});
