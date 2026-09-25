// The Wire ChannelPlugin. Import-safe: discovery and setup evaluate this module,
// so it must not import the Wire SDK or start anything.
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createTopLevelChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import { createLazyRuntimeModule } from "openclaw/plugin-sdk/lazy-runtime";
import {
  buildProbeChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import {
  CHANNEL_ID,
  WireChannelConfigSchema,
  describeUnconfigured,
  inspectWireAccount,
  resolveWireAccount,
  type WireResolvedAccount,
} from "./config.js";
import { getConnectionState, getLiveApi, lookupDmConversation } from "./connection-state.js";
import { normalizeWireAllowEntry } from "./ingress-identity.js";
import { resolveWireOutboundTarget, sendWireMedia, sendWireText, WIRE_TEXT_CHUNK_LIMIT } from "./outbound.js";
import { normalizeWireTarget } from "./targets.js";
import { channelSecrets } from "./secret-contract.js";
import { parseQualifiedKey } from "./wire-api.js";

export const wireMeta = {
  id: CHANNEL_ID,
  label: "Wire",
  selectionLabel: "Wire (app)",
  detailLabel: "Wire",
  docsPath: "/channels/wire",
  docsLabel: "wire",
  blurb: "end-to-end encrypted Wire conversations via a Wire app, with DM pairing controls.",
} as const;

const configAdapter = createTopLevelChannelConfigAdapter<WireResolvedAccount>({
  sectionKey: CHANNEL_ID,
  resolveAccount: resolveWireAccount,
  inspectAccount: inspectWireAccount,
  resolveAllowFrom: (account) => account.allowFrom,
  formatAllowFrom: (allowFrom) => allowFrom.map((entry) => String(entry).trim().toLowerCase()),
});

// The gateway (and through it inbound handling and the SDK) loads only when an
// account starts, keeping discovery and setup imports light.
const loadGateway = createLazyRuntimeModule(() => import("./gateway.js"));

type WireProbe = { ok: boolean; running: boolean; connected: boolean; lastConnectedAt: number | null };

// Probes read the live in-process connection. They never open a second SDK
// instance, because Wire's local state is single-writer.
const statusAdapter = createComputedAccountStatusAdapter<WireResolvedAccount, WireProbe>({
  defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
  buildChannelSummary: ({ snapshot }) => buildProbeChannelStatusSummary(snapshot),
  probeAccount: async ({ account }) => {
    const state = getConnectionState(account.accountId);
    return {
      ok: Boolean(state?.connected),
      running: Boolean(state?.running),
      connected: Boolean(state?.connected),
      lastConnectedAt: state?.lastConnectedAt ?? null,
    };
  },
  resolveAccountSnapshot: ({ account }) => ({
    accountId: account.accountId,
    ...(account.name ? { name: account.name } : {}),
    enabled: account.enabled,
    configured: account.configured,
    extra: { dmPolicy: account.dmPolicy, groupPolicy: account.groupPolicy },
  }),
});

export const wirePlugin: ChannelPlugin<WireResolvedAccount, WireProbe> = createChatChannelPlugin<
  WireResolvedAccount,
  WireProbe
>({
  base: {
    id: CHANNEL_ID,
    meta: wireMeta,
    capabilities: {
      chatTypes: ["direct", "group"],
      reply: true,
      media: true,
    },
    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
    configSchema: WireChannelConfigSchema,
    secrets: channelSecrets,
    config: {
      ...configAdapter,
      isConfigured: (account) => account.configured,
      unconfiguredReason: (account) => describeUnconfigured(account),
    },
    messaging: {
      targetPrefixes: ["wire"],
      targetIdComparison: "lowercase",
      normalizeTarget: normalizeWireTarget,
    },
    status: statusAdapter,
    gateway: {
      startAccount: async (ctx) => {
        const { startWireAccount } = await loadGateway();
        await startWireAccount(ctx);
      },
    },
  },
  // Describes DM policy for doctor, audit and `pairing approve`. Enforcement
  // happens in inbound.ts through the ingress resolver, before dispatch.
  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: (account) => account.dmPolicy,
      resolveAllowFrom: (account) => account.allowFrom,
      defaultPolicy: "pairing",
      normalizeEntry: (raw) => normalizeWireAllowEntry(raw) ?? raw.trim().toLowerCase(),
    },
  },
  // Quoting every DM answer is noise; in groups, quote the first reply so it's
  // clear which message is being answered.
  threading: {
    resolveReplyToMode: ({ chatType }) => (chatType === "group" ? "first" : "off"),
  },
  outbound: {
    base: {
      deliveryMode: "direct",
      textChunkLimit: WIRE_TEXT_CHUNK_LIMIT,
      resolveTarget: resolveWireOutboundTarget,
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: sendWireText,
      sendMedia: (ctx) => sendWireMedia(ctx),
    },
  },
  pairing: {
    text: {
      idLabel: "Wire user id (<uuid>@<domain>)",
      message: "You're approved. Send me a message to get started.",
      normalizeAllowEntry: (entry) => normalizeWireAllowEntry(entry) ?? entry.trim().toLowerCase(),
      notify: async ({ id, accountId, meta, message }) => {
        const account = accountId ?? DEFAULT_ACCOUNT_ID;
        const conversationKey = meta?.conversation ?? lookupDmConversation(account, id.trim().toLowerCase());
        const conversation = conversationKey ? parseQualifiedKey(conversationKey) : null;
        const api = getLiveApi(account);
        if (!conversation || !api) {
          throw new Error("cannot deliver the Wire approval notice: no live connection or known DM conversation");
        }
        await api.sendText(conversation, message);
      },
    },
  },
});
