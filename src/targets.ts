// Wire outbound target grammar.
//   <uuid>@<domain>         a conversation (what inbound replies and sessions use)
//   user:<uuid>@<domain>    a person; resolved to their 1:1 conversation
// An optional leading "wire:" is accepted and stripped.
import { parseQualifiedKey, qualifiedKey, type QualifiedIdLike } from "./wire-api.js";

export type WireTarget = { kind: "conversation" | "user"; id: QualifiedIdLike };

export function parseWireTarget(raw: string | null | undefined): WireTarget | null {
  let value = (raw ?? "").trim();
  if (value.toLowerCase().startsWith("wire:")) value = value.slice("wire:".length);
  let kind: WireTarget["kind"] = "conversation";
  const prefix = /^(user|conversation):/i.exec(value);
  if (prefix?.[1]) {
    kind = prefix[1].toLowerCase() as WireTarget["kind"];
    value = value.slice(prefix[0].length);
  }
  const id = parseQualifiedKey(value);
  return id ? { kind, id } : null;
}

/** Canonical string form: bare key for conversations, `user:` prefix for people. */
export function formatWireTarget(target: WireTarget): string {
  const key = qualifiedKey(target.id);
  return target.kind === "user" ? `user:${key}` : key;
}

export function normalizeWireTarget(raw: string): string | undefined {
  const target = parseWireTarget(raw);
  return target ? formatWireTarget(target) : undefined;
}
