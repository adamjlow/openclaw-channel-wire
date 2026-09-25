// Plugin-owned view of the Wire operations inbound/outbound code needs. The
// real implementation lives in sdk-runtime.ts (lazy); tests use fakes.
export type QualifiedIdLike = { id: string; domain: string };
export type ConversationKind = "direct" | "group" | "unknown";

export type WireApi = {
  /** The Wire app's own qualified id. */
  appId(): QualifiedIdLike;
  /**
   * Send a text message; resolves to the Wire message id. With `replyToId`, the
   * message quotes the original when it is still cached and replyable, and is
   * sent unquoted otherwise.
   */
  sendText(conversationId: QualifiedIdLike, text: string, options?: { replyToId?: string | null }): Promise<string>;
  /** Download and decrypt an inbound asset (the opaque remote data from the message). */
  downloadAsset(remoteData: unknown): Promise<Uint8Array>;
  /** Upload and send a file; resolves to the Wire message id. */
  sendAsset(conversationId: QualifiedIdLike, asset: { data: Uint8Array; name: string; mimeType: string }): Promise<string>;
  /** The 1:1 conversation with a user, from the SDK's local store. */
  findDmConversation(userId: QualifiedIdLike): Promise<QualifiedIdLike | undefined>;
  /** From the SDK's local store; "unknown" for self or unseen conversations. */
  getConversationKind(conversationId: QualifiedIdLike): Promise<ConversationKind>;
  /** Group name from the SDK's local store, when it has one. */
  getConversationName(conversationId: QualifiedIdLike): Promise<string | undefined>;
  /** Display name via the backend, cached; undefined when unavailable. */
  getUserName(userId: QualifiedIdLike): Promise<string | undefined>;
};

/** `id@domain`, the same format as the SDK's QualifiedId.toKey. */
export function qualifiedKey(value: QualifiedIdLike): string {
  return `${value.id}@${value.domain}`.toLowerCase();
}

const KEY = /^([^@\s]+)@([^@\s]+)$/;

/** Parse `id@domain`; null when malformed. */
export function parseQualifiedKey(key: string): QualifiedIdLike | null {
  const [, id, domain] = KEY.exec(key.trim()) ?? [];
  return id && domain ? { id, domain } : null;
}
