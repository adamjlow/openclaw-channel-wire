// Inbound pipeline: SDK event -> normalised message -> per-conversation queue ->
// policy (DM pairing/allowlist) -> OpenClaw dispatch -> reply over Wire.
//
// The SDK runs live events concurrently and drops a failed handler's message
// for good, so the sink only normalises, dedupes and enqueues; all real work
// happens on the queue, one conversation at a time.
import type { AssetMessage, TextMessage } from "@wireapp/wire-apps-js-sdk";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import {
  formatMediaPlaceholderText,
  resolveChannelInboundRouteEnvelope,
  toInboundMediaFacts,
} from "openclaw/plugin-sdk/channel-inbound";
import { createChannelRunQueue } from "openclaw/plugin-sdk/channel-outbound";
import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import { getAgentScopedMediaLocalRoots } from "openclaw/plugin-sdk/media-local-roots";
import { deliverTextOrMediaReply } from "openclaw/plugin-sdk/reply-payload";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import { CHANNEL_ID, type WireResolvedAccount } from "./config.js";
import { rememberDmConversation } from "./connection-state.js";
import { wireIngressIdentity } from "./ingress-identity.js";
import { describeError } from "./redact.js";
import { AssetTooLargeError, ingestInboundAsset, rejectInboundAsset, sendMediaUrl, toByteCount, type InboundAsset } from "./media.js";
import type { WireEventSink } from "./sdk-runtime.js";
import { qualifiedKey, type QualifiedIdLike, type WireApi } from "./wire-api.js";

export type InboundMention = { userKey: string; offset: number; length: number };

export type InboundText = {
  messageId: string;
  conversation: QualifiedIdLike;
  sender: QualifiedIdLike;
  timestamp: number;
  text: string;
  mentions: InboundMention[];
  asset?: InboundAsset;
};

/** Plain-data copy of an SDK TextMessage; null when it can't be attributed. */
export function normalizeTextMessage(message: TextMessage): InboundText | null {
  if (!message.sender || !message.conversationId || !message.id) return null;
  return {
    messageId: message.id,
    conversation: { id: message.conversationId.id, domain: message.conversationId.domain },
    sender: { id: message.sender.id, domain: message.sender.domain },
    timestamp: message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now(),
    text: message.text ?? "",
    mentions: (message.mentions ?? []).map((mention) => ({
      userKey: qualifiedKey(mention.userId),
      offset: mention.offset,
      length: mention.length,
    })),
  };
}

/** Plain-data copy of an SDK AssetMessage (a file with no caption). */
export function normalizeAssetMessage(message: AssetMessage): InboundText | null {
  if (!message.sender || !message.conversationId || !message.id) return null;
  return {
    messageId: message.id,
    conversation: { id: message.conversationId.id, domain: message.conversationId.domain },
    sender: { id: message.sender.id, domain: message.sender.domain },
    timestamp: message.timestamp instanceof Date ? message.timestamp.getTime() : Date.now(),
    text: "",
    mentions: [],
    asset: {
      ...(message.name?.trim() ? { name: message.name.trim() } : {}),
      mimeType: message.mimeType || "application/octet-stream",
      sizeInBytes: toByteCount(message.sizeInBytes),
      ...(message.remoteData ? { remoteData: message.remoteData } : {}),
    },
  };
}

/**
 * Remove the app's own @mention spans so the agent sees the request, not its
 * handle. Offsets are string indices, as Wire clients produce them.
 */
export function stripMentions(text: string, mentions: InboundMention[], userKey: string): string {
  const spans = mentions
    .filter((mention) => mention.userKey === userKey && mention.offset >= 0 && mention.length > 0)
    .sort((a, b) => b.offset - a.offset);
  let result = text;
  for (const { offset, length } of spans) {
    if (offset + length > result.length) continue;
    result = result.slice(0, offset) + result.slice(offset + length);
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

/** Small bounded set for message-id dedupe (the SDK does not guarantee exactly-once). */
export class RecentIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 1000) {}

  /** True the first time an id is seen. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}

type Log = ChannelGatewayContext<WireResolvedAccount>["log"];
type StatusPatch = (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;

export type InboundDeps = {
  core: PluginRuntime;
  cfg: ChannelGatewayContext<WireResolvedAccount>["cfg"];
  account: WireResolvedAccount;
  log?: Log;
  status?: StatusPatch;
};

export async function handleInboundMessage(event: InboundText, api: WireApi, deps: InboundDeps): Promise<void> {
  const { core, cfg, account, log, status } = deps;
  if (!event.text.trim() && !event.asset) return;

  const appKey = qualifiedKey(api.appId());
  const senderKey = qualifiedKey(event.sender);
  const conversationKey = qualifiedKey(event.conversation);
  if (senderKey === appKey) return;

  status?.({ lastInboundAt: event.timestamp });

  const kind = await api.getConversationKind(event.conversation);
  if (kind === "unknown") {
    log?.debug?.("[wire] drop message from an unknown conversation");
    return;
  }
  const isGroup = kind === "group";

  // Mentions: a Wire @mention of the app, or OpenClaw's configured mention patterns.
  const mentionedByTag = event.mentions.some((mention) => mention.userKey === appKey);
  const mentionedByPattern = core.channel.mentions.matchesMentionPatterns(
    event.text,
    core.channel.mentions.buildMentionRegexes(cfg),
  );
  const wasMentioned = mentionedByTag || mentionedByPattern;
  const text = stripMentions(event.text, event.mentions, appKey);
  if (!text && !event.asset) return;

  // DMs are keyed by person (bindings and sessions follow the sender); groups by conversation.
  const peerId = isGroup ? conversationKey : senderKey;
  const pairing = createChannelPairingController({ core, channel: CHANNEL_ID, accountId: account.accountId });
  const { route, buildEnvelope } = resolveChannelInboundRouteEnvelope({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: isGroup ? "group" : "direct", id: peerId },
  });

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({ cfg, surface: CHANNEL_ID });
  const hasControlCommand = core.channel.text.hasControlCommand(text, cfg);

  const access = await core.channel.inbound.ingress
    .createResolver({
      channelId: CHANNEL_ID,
      accountId: account.accountId,
      identity: wireIngressIdentity,
      cfg,
      readStoreAllowFrom: async () => await pairing.readAllowFromStore(),
    })
    .message({
      subject: { stableId: senderKey },
      conversation: { kind: isGroup ? "group" : "direct", id: conversationKey },
      contextBinding: {
        agentId: route.agentId,
        sessionKey: route.sessionKey,
        messageId: event.messageId,
        inboundEventKind: "user_request",
      },
      ...(isGroup ? { mentionFacts: { canDetectMention: true, wasMentioned, hasAnyMention: event.mentions.length > 0 || wasMentioned } } : {}),
      dmPolicy: account.dmPolicy,
      groupPolicy: account.groupPolicy,
      policy: {
        // People allowed to DM the assistant may also use it in groups.
        groupAllowFromFallbackToAllowFrom: true,
        mutableIdentifierMatching: "disabled",
        activation: { requireMention: isGroup && account.requireMention, allowTextCommands },
      },
      allowFrom: account.allowFrom,
      groupAllowFrom: account.groupAllowFrom,
      command: { allowTextCommands, hasControlCommand },
    });

  const reply = async (body: string, replyToId?: string) => {
    await api.sendText(event.conversation, body, { replyToId: replyToId ?? null });
    status?.({ lastOutboundAt: Date.now() });
  };

  if (access.ingress.admission === "pairing-required") {
    rememberDmConversation(account.accountId, senderKey, conversationKey);
    await pairing.issueChallenge({
      senderId: senderKey,
      senderIdLine: `Your Wire id: ${senderKey}`,
      meta: { conversation: conversationKey },
      sendPairingReply: reply,
      onReplyError: (err: unknown) => log?.warn(`[wire] pairing reply failed: ${describeError(err)}`),
    });
    log?.info(`[wire] DM from unpaired sender: pairing challenge issued (dmPolicy=${account.dmPolicy})`);
    return;
  }
  if (access.ingress.admission === "skip") {
    log?.debug?.("[wire] group message without mention: skipped");
    return;
  }
  if (access.ingress.admission !== "dispatch") {
    log?.info(
      `[wire] drop ${isGroup ? "group message" : "DM"} (admission=${access.ingress.admission}, ` +
        `${isGroup ? `groupPolicy=${account.groupPolicy}` : `dmPolicy=${account.dmPolicy}`})`,
    );
    return;
  }

  if (!isGroup) rememberDmConversation(account.accountId, senderKey, conversationKey);

  // Files are fetched only now, after sender policy admitted the message.
  let media: ReturnType<typeof toInboundMediaFacts> | undefined;
  if (event.asset) {
    const notice = rejectInboundAsset(event.asset, account.assetPolicy);
    if (notice) {
      log?.info(`[wire] file rejected by asset policy (mime=${event.asset.mimeType})`);
      await reply(notice);
      return;
    }
    try {
      const saved = await ingestInboundAsset({ asset: event.asset, api, core, maxBytes: account.assetPolicy.maxBytes });
      media = toInboundMediaFacts([{ ...saved, messageId: event.messageId }]);
    } catch (err) {
      log?.warn(`[wire] file ingest failed: ${describeError(err)}`);
      await reply(err instanceof AssetTooLargeError ? "That file is too large." : "I couldn't retrieve that file.");
      return;
    }
  }
  const agentText = text || (media ? formatMediaPlaceholderText(media) : "");

  const [senderName, groupName] = await Promise.all([
    api.getUserName(event.sender),
    isGroup ? api.getConversationName(event.conversation) : Promise.resolve(undefined),
  ]);
  const senderLabel = senderName ?? senderKey;
  const conversationLabel = isGroup ? (groupName ?? conversationKey) : senderLabel;
  const body = buildEnvelope({
    channel: "Wire",
    from: isGroup ? `${senderLabel} in ${conversationLabel}` : senderLabel,
    timestamp: event.timestamp,
    body: agentText,
  });

  const ctxPayload = core.channel.inbound.buildContext({
    channelIngress: access,
    channel: CHANNEL_ID,
    accountId: route.accountId,
    messageId: event.messageId,
    timestamp: event.timestamp,
    from: isGroup ? `wire:group:${conversationKey}` : `wire:${senderKey}`,
    sender: { id: senderKey, ...(senderName ? { name: senderName } : {}) },
    conversation: { kind: isGroup ? "group" : "direct", id: peerId, label: conversationLabel },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
    },
    reply: { to: conversationKey, originatingTo: conversationKey },
    message: { body, bodyForAgent: agentText, rawBody: event.text || agentText, commandBody: text },
    ...(media ? { media } : {}),
    access: {
      commands: { authorized: access.commandAccess.authorized },
      mentions: { canDetectMention: isGroup, wasMentioned },
    },
    ...(isGroup ? { extra: { GroupSubject: conversationLabel } } : {}),
  });

  await core.channel.inbound.dispatch({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    route: { agentId: route.agentId, sessionKey: route.sessionKey },
    ctxPayload,
    delivery: {
      deliver: async (payload) => {
        const localRoots = getAgentScopedMediaLocalRoots(cfg, route.agentId);
        let replyToId = payload.replyToId ?? undefined;
        await deliverTextOrMediaReply({
          payload,
          text: payload.text ?? "",
          // Quote on the first physical message only.
          sendText: async (chunk) => {
            await reply(chunk, replyToId);
            replyToId = undefined;
          },
          sendMedia: async ({ mediaUrl, caption }) => {
            await sendMediaUrl({
              mediaUrl,
              conversation: event.conversation,
              api,
              core,
              maxBytes: account.assetPolicy.maxBytes,
              localRoots,
            });
            status?.({ lastOutboundAt: Date.now() });
            // Wire files carry no caption; send it as a follow-up message.
            if (caption?.trim()) await reply(caption);
          },
          onMediaError: ({ error }) => {
            log?.warn(`[wire] file reply failed: ${describeError(error)}`);
          },
        });
      },
      onError: (err, info) => log?.warn(`[wire] ${info.kind} reply failed: ${describeError(err)}`),
    },
    replyPipeline: {},
    record: {
      onRecordError: (err) => log?.warn(`[wire] session record failed: ${describeError(err)}`),
    },
  });
}

/** Build the SDK event sink for one account run. */
export function createInboundSink(
  deps: InboundDeps & { abortSignal: AbortSignal; setStatus?: ChannelGatewayContext<WireResolvedAccount>["setStatus"] },
): WireEventSink {
  const seen = new RecentIds();
  const queue = createChannelRunQueue({
    abortSignal: deps.abortSignal,
    onError: (err) => deps.log?.error(`[wire] inbound handling failed: ${describeError(err)}`),
  });
  deps.abortSignal.addEventListener("abort", () => queue.deactivate(), { once: true });

  return {
    onTextMessage: (message, api) => {
      const event = normalizeTextMessage(message);
      if (!event || !seen.add(event.messageId)) return;
      queue.enqueue(qualifiedKey(event.conversation), async () => await handleInboundMessage(event, api, deps));
    },
    onAssetMessage: (message, api) => {
      const event = normalizeAssetMessage(message);
      if (!event || !seen.add(event.messageId)) return;
      queue.enqueue(qualifiedKey(event.conversation), async () => await handleInboundMessage(event, api, deps));
    },
  };
}
