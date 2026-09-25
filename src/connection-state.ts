import type { WireApi } from "./wire-api.js";

// In-process view of each account's live connection, for status probes. A probe
// must never open its own SDK instance: Wire state is single-writer.
export type ConnectionState = {
  running: boolean;
  connected: boolean;
  lastConnectedAt: number | null;
  lastDisconnectAt: number | null;
};

const states = new Map<string, ConnectionState>();

export function updateConnectionState(accountId: string, patch: Partial<ConnectionState>): void {
  const current = states.get(accountId) ?? {
    running: false,
    connected: false,
    lastConnectedAt: null,
    lastDisconnectAt: null,
  };
  states.set(accountId, { ...current, ...patch });
}

export function getConnectionState(accountId: string): ConnectionState | undefined {
  return states.get(accountId);
}

export function clearConnectionStates(): void {
  states.clear();
  dmConversations.clear();
  liveApis.clear();
}


// The live WireApi per account while a run is connected-or-connecting, for
// outbound sends and pairing notices that originate outside an inbound turn.
const liveApis = new Map<string, WireApi>();

export function setLiveApi(accountId: string, api: WireApi | undefined): void {
  if (api) liveApis.set(accountId, api);
  else liveApis.delete(accountId);
}

export function getLiveApi(accountId: string): WireApi | undefined {
  return liveApis.get(accountId);
}

// The 1:1 conversation each paired or pairing user last wrote from, so pairing
// approvals and proactive sends can reach them. Keyed by account, then user key.
const dmConversations = new Map<string, Map<string, string>>();

export function rememberDmConversation(accountId: string, userKey: string, conversationKey: string): void {
  const byUser = dmConversations.get(accountId) ?? new Map<string, string>();
  byUser.set(userKey, conversationKey);
  dmConversations.set(accountId, byUser);
}

export function lookupDmConversation(accountId: string, userKey: string): string | undefined {
  return dmConversations.get(accountId)?.get(userKey);
}
