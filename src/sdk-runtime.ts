// The only module that imports the Wire SDK at runtime. Loaded lazily by the
// connection when an account starts, so discovery and setup never load
// CoreCrypto or SQLite.
import {
  ConversationType,
  QualifiedId,
  TextMessage,
  WireAppSdk,
  WireEventsHandler,
  type AssetMessage,
  type Logger,
  type WireApplicationManager,
  type WireMessage,
} from "@wireapp/wire-apps-js-sdk";
import type { WireCredentials } from "./credentials.js";
import { qualifiedKey, type ConversationKind, type QualifiedIdLike, type WireApi } from "./wire-api.js";

/** Plugin-side receiver for SDK events. Implementations must not throw. */
export type WireEventSink = {
  onTextMessage?: (message: TextMessage, api: WireApi) => void;
  onAssetMessage?: (message: AssetMessage, api: WireApi) => void;
};

const toQualifiedId = (value: QualifiedIdLike) => new QualifiedId(value.id, value.domain);

const MESSAGE_CACHE_SIZE = 500;

export type WireApiWithCache = WireApi & {
  /** Keep an inbound message so replies can quote it (TextMessage.createReply needs the original). */
  rememberMessage(message: WireMessage): void;
};

/**
 * The operations inbound and outbound code needs, backed by the real SDK.
 * Keeps every SDK value import (message classes, enums) in this module.
 */
export function createWireApi(getManager: () => WireApplicationManager): WireApiWithCache {
  const kinds = new Map<string, ConversationKind>();
  const conversationNames = new Map<string, string>();
  const names = new Map<string, string>();
  const dms = new Map<string, QualifiedIdLike>();
  const messages = new Map<string, WireMessage>();

  const refreshKinds = async () => {
    for (const conversation of await getManager().getAllConversations()) {
      const kind: ConversationKind =
        conversation.type === ConversationType.ONE_TO_ONE
          ? "direct"
          : conversation.type === ConversationType.GROUP
            ? "group"
            : "unknown";
      kinds.set(qualifiedKey(conversation), kind);
      if (conversation.name) conversationNames.set(qualifiedKey(conversation), conversation.name);
    }
  };

  return {
    appId: () => {
      const id = getManager().getApplicationQualifiedId();
      return { id: id.id, domain: id.domain };
    },
    rememberMessage: (message) => {
      messages.set(message.id, message);
      if (messages.size > MESSAGE_CACHE_SIZE) {
        const oldest = messages.keys().next().value;
        if (oldest !== undefined) messages.delete(oldest);
      }
    },
    sendText: async (conversationId, text, options) => {
      const target = toQualifiedId(conversationId);
      const original = options?.replyToId ? messages.get(options.replyToId) : undefined;
      let message: TextMessage | undefined;
      if (original && qualifiedKey(original.conversationId) === qualifiedKey(target)) {
        try {
          // Throws for non-replyable (not text/asset/location) or ephemeral originals.
          message = TextMessage.createReply({ text, originalMessage: original });
        } catch {
          message = undefined;
        }
      }
      return await getManager().sendMessage(message ?? TextMessage.create({ conversationId: target, text }));
    },
    downloadAsset: async (remoteData) => await getManager().downloadAsset(remoteData as never),
    sendAsset: async (conversationId, asset) => await getManager().sendAsset(toQualifiedId(conversationId), asset),
    findDmConversation: async (userId) => {
      const userKey = qualifiedKey(userId);
      const cached = dms.get(userKey);
      if (cached) return cached;
      const manager = getManager();
      for (const conversation of await manager.getAllConversations()) {
        if (conversation.type !== ConversationType.ONE_TO_ONE) continue;
        const id = new QualifiedId(conversation.id, conversation.domain);
        const members = await manager.getMembersInConversation(id);
        if (members.some((member) => qualifiedKey(member.userId) === userKey)) {
          const found = { id: conversation.id, domain: conversation.domain };
          dms.set(userKey, found);
          return found;
        }
      }
      return undefined;
    },
    getConversationKind: async (conversationId) => {
      const key = qualifiedKey(conversationId);
      if (!kinds.has(key)) await refreshKinds();
      return kinds.get(key) ?? "unknown";
    },
    getConversationName: async (conversationId) => {
      const key = qualifiedKey(conversationId);
      if (!kinds.has(key)) await refreshKinds();
      return conversationNames.get(key);
    },
    getUserName: async (userId) => {
      const key = qualifiedKey(userId);
      const cached = names.get(key);
      if (cached !== undefined) return cached || undefined;
      try {
        const [user] = await getManager().getUsers([toQualifiedId(userId)]);
        names.set(key, user?.name ?? "");
        return user?.name || undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Forwards SDK callbacks to the sink and returns immediately. The SDK awaits
 * these handlers, runs live events concurrently, and swallows handler errors
 * with no redelivery, so real work is queued by the sink, never done inline.
 */
class SinkEventsHandler extends WireEventsHandler {
  readonly api: WireApiWithCache = createWireApi(() => this.manager);

  constructor(
    private readonly sink: WireEventSink,
    private readonly sdkLog: Logger,
  ) {
    super();
  }

  override async onTextMessageReceived(message: TextMessage): Promise<void> {
    this.api.rememberMessage(message);
    this.forward(() => this.sink.onTextMessage?.(message, this.api), "text");
  }

  override async onAssetMessageReceived(message: AssetMessage): Promise<void> {
    this.api.rememberMessage(message);
    this.forward(() => this.sink.onAssetMessage?.(message, this.api), "asset");
  }

  private forward(fn: () => void, kind: string): void {
    try {
      fn();
    } catch (err) {
      this.sdkLog.error(`inbound ${kind} handler failed`, err);
    }
  }
}

export async function createWireSdk(params: {
  credentials: WireCredentials;
  storagePath: string;
  sink: WireEventSink;
  logger: Logger;
}) {
  const { apiToken, apiHost, cryptographyStorageKey } = params.credentials;
  const handler = new SinkEventsHandler(params.sink, params.logger);
  const sdk = await WireAppSdk.create(
    apiToken,
    apiHost,
    cryptographyStorageKey,
    handler,
    params.logger,
    // The gateway owns the process: never let the SDK exit it or hook signals.
    { storagePath: params.storagePath, registerExitHandlers: false },
  );
  return Object.assign(sdk, { api: handler.api });
}
