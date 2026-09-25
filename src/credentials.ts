// Resolve the Wire app credentials at account start. Secrets are resolved here,
// never at config load, and their values never appear in errors or logs.
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";
import type { WireResolvedAccount } from "./config.js";

export type WireCredentials = {
  apiHost: string;
  apiToken: string;
  cryptographyStorageKey: Uint8Array;
};

const HEX_KEY = /^[0-9a-fA-F]{64}$/;

/**
 * Decode the 64-hex-char crypto storage key into the 32 bytes the SDK needs.
 * Checked with a regex first because Buffer.from(…, "hex") silently drops
 * invalid characters and would yield a shorter or different key.
 */
export function decodeCryptoKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (!HEX_KEY.test(trimmed)) {
    throw new Error("channels.wire.cryptoKey must be exactly 64 hex characters (32 bytes)");
  }
  return new Uint8Array(Buffer.from(trimmed, "hex"));
}

async function resolveSecret(cfg: OpenClawConfig, value: unknown, field: string, env: NodeJS.ProcessEnv) {
  const path = `channels.wire.${field}`;
  const result = await resolveConfiguredSecretInputString({ config: cfg, env, value, path });
  if (result.unresolvedRefReason) throw new Error(`${path}: ${result.unresolvedRefReason}`);
  const resolved = result.value?.trim();
  if (!resolved) throw new Error(`${path} resolved to an empty value`);
  return resolved;
}

export async function resolveWireCredentials(
  cfg: OpenClawConfig,
  account: WireResolvedAccount,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WireCredentials> {
  if (!account.apiHost) throw new Error("channels.wire.apiHost is not set");
  const apiToken = await resolveSecret(cfg, account.apiToken, "apiToken", env);
  const cryptoKey = await resolveSecret(cfg, account.cryptoKey, "cryptoKey", env);
  return { apiHost: account.apiHost, apiToken, cryptographyStorageKey: decodeCryptoKey(cryptoKey) };
}
