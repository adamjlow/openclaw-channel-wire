// Outbound sends initiated by OpenClaw (message tool, cron, announcements).
// Replies to inbound turns go through inbound.ts, which already knows the
// conversation; both end up in WireApi.sendText.
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { PlatformMessageNotDispatchedError } from "openclaw/plugin-sdk/error-runtime";
import { getAgentScopedMediaLocalRoots } from "openclaw/plugin-sdk/media-local-roots";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import { resolveWireAccount } from "./config.js";
import { getLiveApi } from "./connection-state.js";
import { sendMediaUrl } from "./media.js";
import { getWireRuntime } from "./runtime.js";
import { formatWireTarget, parseWireTarget } from "./targets.js";
import { qualifiedKey, type QualifiedIdLike, type WireApi } from "./wire-api.js";

/** Wire clients cap outgoing text at 8000 characters (wire-webapp Config.MAXIMUM_MESSAGE_LENGTH). */
export const WIRE_TEXT_CHUNK_LIMIT = 8000;

const TARGET_HINT = 'expected "<conversation-uuid>@<domain>" or "user:<user-uuid>@<domain>"';

export function resolveWireOutboundTarget(params: { to?: string }) {
  const target = parseWireTarget(params.to);
  return target
    ? { ok: true as const, to: formatWireTarget(target) }
    : { ok: false as const, error: new Error(`invalid Wire target: ${TARGET_HINT}`) };
}

async function resolveDestination(to: string, accountId: string | null | undefined): Promise<{ api: WireApi; conversation: QualifiedIdLike }> {
  const target = parseWireTarget(to);
  if (!target) throw new Error(`invalid Wire target: ${TARGET_HINT}`);

  const account = accountId ?? DEFAULT_ACCOUNT_ID;
  const api = getLiveApi(account);
  if (!api) {
    throw new PlatformMessageNotDispatchedError("Wire channel is not connected", {
      cause: new Error(`no live Wire connection for account ${account}`),
      retryable: true,
    });
  }

  const conversation = target.kind === "user" ? await api.findDmConversation(target.id) : target.id;
  if (!conversation) {
    throw new PlatformMessageNotDispatchedError("no 1:1 Wire conversation with that user", {
      cause: new Error("the user has no 1:1 conversation with the app yet"),
      retryable: false,
    });
  }
  return { api, conversation };
}

const resultFor = (messageId: string, conversation: QualifiedIdLike) => ({
  messageId,
  target: { kind: "conversation" as const, id: qualifiedKey(conversation) },
});

export async function sendWireText(ctx: {
  to: string;
  text: string;
  accountId?: string | null;
  replyToId?: string | null;
}) {
  const { api, conversation } = await resolveDestination(ctx.to, ctx.accountId);
  const messageId = await api.sendText(conversation, ctx.text, { replyToId: ctx.replyToId ?? null });
  return resultFor(messageId, conversation);
}

/** Send a file (plus its caption as a follow-up text, since Wire files carry none). */
export async function sendWireMedia(
  ctx: {
    cfg: OpenClawConfig;
    to: string;
    text: string;
    mediaUrl?: string;
    mediaLocalRoots?: readonly string[];
    accountId?: string | null;
  },
  core: PluginRuntime = getWireRuntime(),
) {
  if (!ctx.mediaUrl) return await sendWireText(ctx);
  const { api, conversation } = await resolveDestination(ctx.to, ctx.accountId);
  const messageId = await sendMediaUrl({
    mediaUrl: ctx.mediaUrl,
    conversation,
    api,
    core,
    maxBytes: resolveWireAccount(ctx.cfg).assetPolicy.maxBytes,
    localRoots: ctx.mediaLocalRoots ?? getAgentScopedMediaLocalRoots(ctx.cfg),
  });
  if (ctx.text.trim()) await api.sendText(conversation, ctx.text);
  return resultFor(messageId, conversation);
}
