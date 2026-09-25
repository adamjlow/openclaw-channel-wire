// Log hygiene. Error messages from the SDK or OpenClaw can embed Wire user or
// conversation ids and, rarely, email addresses. Everything we log or put in
// status goes through here first.
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID = new RegExp(`\\b${UUID_SOURCE}\\b`, "gi");
const UUID_LOCAL_PART = new RegExp(`^${UUID_SOURCE}@`, "i");
const EMAIL = /\b[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}\b/gi;

/** Mask email addresses and ids (keeping a 4-char prefix for correlation). */
export function redact(text: string): string {
  return text
    // A uuid local part is a Wire qualified id, handled by the uuid pass.
    .replace(EMAIL, (match) => (UUID_LOCAL_PART.test(match) ? match : "<email>"))
    .replace(UUID, (id) => `${id.slice(0, 4)}…`);
}

/** Redacted, single-line description of an unknown error. */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return redact(message).replace(/\s+/g, " ").trim();
}
