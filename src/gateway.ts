// Account lifecycle. One run = one SDK instance: start, stay alive until the
// host aborts or the connection is fatally lost, then close. Restarts (with
// backoff) belong to OpenClaw, which restarts the account whenever a run ends.
import os from "node:os";
import path from "node:path";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import { createAccountStatusSink, waitUntilAbort } from "openclaw/plugin-sdk/channel-outbound";
import { describeUnconfigured, type WireResolvedAccount } from "./config.js";
import { openWireConnection, type CreateWireSdk } from "./connection.js";
import { setLiveApi, updateConnectionState } from "./connection-state.js";
import { resolveWireCredentials } from "./credentials.js";
import { describeError } from "./redact.js";
import { createInboundSink } from "./inbound.js";
import { getWireRuntime } from "./runtime.js";
import type { WireEventSink } from "./sdk-runtime.js";

type StartContext = ChannelGatewayContext<WireResolvedAccount>;

export type GatewayDeps = {
  createSdk?: CreateWireSdk;
  resolveStateDir?: () => string;
  createSink?: (ctx: StartContext) => WireEventSink;
  reconnectTimeoutMs?: number;
  now?: () => number;
};

/** `<OpenClaw state dir>/wire/<accountId>`: the SDK's apps.db and CoreCrypto files. */
export function resolveStoragePath(accountId: string, stateDir?: string): string {
  const base = stateDir ?? getWireRuntime().state.resolveStateDir(process.env, os.homedir);
  return path.join(base, "wire", accountId);
}

export async function startWireAccount(ctx: StartContext, deps: GatewayDeps = {}): Promise<void> {
  const { account, accountId, log } = ctx;
  const now = deps.now ?? Date.now;
  const status = createAccountStatusSink({ accountId, setStatus: ctx.setStatus });

  if (!account.configured) {
    throw new Error(describeUnconfigured(account));
  }
  if (ctx.abortSignal.aborted) return;

  const credentials = await resolveWireCredentials(ctx.cfg, account);
  const storagePath = resolveStoragePath(accountId, deps.resolveStateDir?.());

  status({ running: true, connected: false, lifecycle: "starting", lastStartAt: now(), lastError: null });
  updateConnectionState(accountId, { running: true, connected: false });

  let rejectFatal!: (error: Error) => void;
  const fatal = new Promise<never>((_, reject) => {
    rejectFatal = reject;
  });
  // Avoid an unhandled rejection if the fatal fires after the run has ended.
  fatal.catch(() => undefined);

  log?.info(`[wire] [${accountId}] connecting`);
  let connection: Awaited<ReturnType<typeof openWireConnection>> | undefined;
  try {
    connection = await openWireConnection({
      credentials,
      storagePath,
      sink:
        deps.createSink?.(ctx) ??
        createInboundSink({
          core: getWireRuntime(),
          cfg: ctx.cfg,
          account,
          abortSignal: ctx.abortSignal,
          status,
          ...(log ? { log } : {}),
        }),
      ...(log ? { log } : {}),
      ...(deps.createSdk ? { createSdk: deps.createSdk } : {}),
      ...(deps.reconnectTimeoutMs !== undefined ? { reconnectTimeoutMs: deps.reconnectTimeoutMs } : {}),
      events: {
        onConnected: () => {
          const at = now();
          status({ connected: true, lifecycle: "ready", lastConnectedAt: at, lastError: null });
          updateConnectionState(accountId, { connected: true, lastConnectedAt: at });
          log?.info(`[wire] [${accountId}] connected`);
        },
        onDisconnected: () => {
          const at = now();
          status({ connected: false, lifecycle: "recovering", lastDisconnect: { at } });
          updateConnectionState(accountId, { connected: false, lastDisconnectAt: at });
          log?.warn(`[wire] [${accountId}] disconnected; SDK is reconnecting`);
        },
        onFatal: (error) => rejectFatal(error),
      },
    });

    setLiveApi(accountId, connection.api);
    log?.info(`[wire] [${accountId}] listening`);
    await Promise.race([waitUntilAbort(ctx.abortSignal), fatal]);
  } catch (err) {
    const message = describeError(err);
    status({ lastError: message });
    log?.error(`[wire] [${accountId}] run failed: ${message}`);
    throw err;
  } finally {
    setLiveApi(accountId, undefined);
    await connection?.close().catch((err: unknown) => {
      log?.warn(`[wire] [${accountId}] close failed: ${describeError(err)}`);
    });
    status({ running: false, connected: false, lifecycle: "stopped", lastStopAt: now() });
    updateConnectionState(accountId, { running: false, connected: false });
    log?.info(`[wire] [${accountId}] stopped`);
  }
}
