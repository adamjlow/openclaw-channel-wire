// Config contract for `channels.wire`: schema, account resolution and
// secret-safe inspection. Import-safe: no SDK or runtime work at module load.
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import {
  DmPolicySchema,
  GroupPolicySchema,
  buildChannelConfigSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import {
  buildSecretInputSchema,
  hasConfiguredSecretInput,
  registerSensitiveConfigSchema,
} from "openclaw/plugin-sdk/secret-input";
import { z } from "zod";

export const CHANNEL_ID = "wire";

// Allowlist entries are qualified Wire user ids (`<uuid>@<domain>`), or "*"
// to allow everyone. The domain is part of the identity so a federated user
// on another backend can never match a local entry by accident.
const QUALIFIED_ID_ENTRY = /^[^@\s]+@[^@\s]+$/;
const AllowEntrySchema = z
  .string()
  .trim()
  .refine((value) => value === "*" || QUALIFIED_ID_ENTRY.test(value), {
    message: 'expected a qualified Wire user id "<id>@<domain>" or "*"',
  });

const SecretInputSchema = buildSecretInputSchema();

export const DEFAULT_ASSET_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_ASSET_MIME_ALLOWLIST = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

const AssetPolicySchema = z
  .object({
    maxBytes: z.number().int().positive().optional(),
    mimeAllowlist: z.array(z.string().trim().toLowerCase()).optional(),
  })
  .strict();

export const WireConfigSchema = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    apiHost: z
      .string()
      .trim()
      .regex(/^https:\/\/\S+$/, "apiHost must be an https:// URL")
      .optional(),
    apiToken: registerSensitiveConfigSchema(SecretInputSchema.optional()),
    cryptoKey: registerSensitiveConfigSchema(SecretInputSchema.optional()),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    allowFrom: z.array(AllowEntrySchema).optional(),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    groupAllowFrom: z.array(AllowEntrySchema).optional(),
    requireMention: z.boolean().optional().default(true),
    assetPolicy: AssetPolicySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message: 'channels.wire.dmPolicy="open" requires channels.wire.allowFrom to include "*"',
    });
  });

export type WireConfig = z.infer<typeof WireConfigSchema>;
type DmPolicy = z.infer<typeof DmPolicySchema>;
type GroupPolicy = z.infer<typeof GroupPolicySchema>;
type SecretInput = z.infer<typeof SecretInputSchema>;

export const WireChannelConfigSchema = buildChannelConfigSchema(WireConfigSchema, {
  uiHints: {
    apiHost: { label: "Wire API host", placeholder: "https://prod-nginz-https.wire.com" },
    apiToken: { label: "Wire app token", sensitive: true },
    cryptoKey: { label: "Crypto storage key (64 hex chars)", sensitive: true },
    dmPolicy: { label: "DM policy" },
    allowFrom: { label: "Allowed users (<id>@<domain>)" },
    groupPolicy: { label: "Group policy" },
    groupAllowFrom: { label: "Allowed group senders (<id>@<domain>); falls back to allowFrom" },
    requireMention: { label: "Require an @mention in groups" },
    assetPolicy: { label: "File policy" },
    "assetPolicy.maxBytes": { label: "Max file size (bytes, both directions)" },
    "assetPolicy.mimeAllowlist": { label: "Accepted incoming file types (MIME)" },
  },
});

export type WireResolvedAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  /** Every required field is present (secrets may still fail to resolve at start). */
  configured: boolean;
  /** Parse issues, when the section does not match the schema. Paths only, never values. */
  configIssues: string[];
  apiHost?: string;
  apiToken?: SecretInput;
  cryptoKey?: SecretInput;
  dmPolicy: DmPolicy;
  allowFrom: string[];
  groupPolicy: GroupPolicy;
  groupAllowFrom: string[];
  requireMention: boolean;
  assetPolicy: { maxBytes: number; mimeAllowlist: string[] };
};

const defaultAssetPolicy = () => ({
  maxBytes: DEFAULT_ASSET_MAX_BYTES,
  mimeAllowlist: [...DEFAULT_ASSET_MIME_ALLOWLIST],
});

function readSection(cfg: OpenClawConfig): unknown {
  return (cfg.channels as Record<string, unknown> | undefined)?.[CHANNEL_ID];
}

/**
 * Resolve the single Wire account. Never throws: status, doctor and the UI
 * must load even when the section is invalid. Gateway start fails closed on
 * `configured: false`.
 */
export function resolveWireAccount(cfg: OpenClawConfig): WireResolvedAccount {
  const raw = readSection(cfg);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const parsed = WireConfigSchema.safeParse(record);

  if (!parsed.success) {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      enabled: record.enabled !== false,
      configured: false,
      configIssues: parsed.error.issues.map((issue) => issue.path.join(".") || "(root)"),
      dmPolicy: "pairing",
      allowFrom: [],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
      requireMention: true,
      assetPolicy: defaultAssetPolicy(),
    };
  }

  const section = parsed.data;
  const configured = Boolean(
    section.apiHost &&
      hasConfiguredSecretInput(section.apiToken) &&
      hasConfiguredSecretInput(section.cryptoKey),
  );

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    ...(section.name ? { name: section.name } : {}),
    enabled: section.enabled !== false,
    configured,
    configIssues: [],
    ...(section.apiHost ? { apiHost: section.apiHost } : {}),
    ...(section.apiToken !== undefined ? { apiToken: section.apiToken } : {}),
    ...(section.cryptoKey !== undefined ? { cryptoKey: section.cryptoKey } : {}),
    dmPolicy: section.dmPolicy,
    allowFrom: section.allowFrom ?? [],
    groupPolicy: section.groupPolicy,
    groupAllowFrom: section.groupAllowFrom ?? [],
    requireMention: section.requireMention,
    assetPolicy: {
      maxBytes: section.assetPolicy?.maxBytes ?? DEFAULT_ASSET_MAX_BYTES,
      mimeAllowlist: section.assetPolicy?.mimeAllowlist ?? [...DEFAULT_ASSET_MIME_ALLOWLIST],
    },
  };
}

/** Status-safe inspection: presence flags only, never secret values or ids. */
export function inspectWireAccount(cfg: OpenClawConfig) {
  const account = resolveWireAccount(cfg);
  return {
    accountId: account.accountId,
    enabled: account.enabled,
    configured: account.configured,
    apiHostStatus: account.apiHost ? "available" : "missing",
    apiTokenStatus: hasConfiguredSecretInput(account.apiToken) ? "configured" : "missing",
    cryptoKeyStatus: hasConfiguredSecretInput(account.cryptoKey) ? "configured" : "missing",
    dmPolicy: account.dmPolicy,
    groupPolicy: account.groupPolicy,
    ...(account.configIssues.length ? { configIssues: account.configIssues } : {}),
  };
}

export function describeUnconfigured(account: WireResolvedAccount): string {
  if (account.configIssues.length) {
    return `channels.wire is invalid at: ${account.configIssues.join(", ")}`;
  }
  const missing = [
    !account.apiHost && "apiHost",
    !hasConfiguredSecretInput(account.apiToken) && "apiToken",
    !hasConfiguredSecretInput(account.cryptoKey) && "cryptoKey",
  ].filter(Boolean);
  return `channels.wire is missing: ${missing.join(", ")}`;
}
