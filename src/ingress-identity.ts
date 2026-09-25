// How OpenClaw's ingress kernel matches Wire senders against allowlists and the
// pairing store. The subject is the sender's qualified id (`<uuid>@<domain>`),
// taken from the SDK's decrypted message (backed by the backend's qualified_from).
import { defineStableChannelIngressIdentity } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { parseQualifiedKey } from "./wire-api.js";

/** Normalise an allowlist or pairing-store entry; null when it isn't a qualified id. */
export function normalizeWireAllowEntry(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (value === "*") return value;
  return parseQualifiedKey(value) ? value : null;
}

export const wireIngressIdentity = defineStableChannelIngressIdentity({
  key: "wire-user",
  // The Wire backend authenticates the sending client and the SDK checks the
  // MLS sender against it. We still claim only "asserted": the SDK's handling
  // of a mismatch is not something we can bind to here.
  authentication: "asserted",
  sensitivity: "pii",
  normalizeEntry: normalizeWireAllowEntry,
  normalizeSubject: (value: string) => value.trim().toLowerCase(),
  isWildcardEntry: (entry: string) => entry.trim() === "*",
  entryIdPrefix: "wire-entry",
});
