// One live Wire connection per account run: creates the SDK, tracks backend
// connectivity, and reports a fatal error when the SDK has stopped trying.
import type { BackendConnectionListener, WireApplicationManager } from "@wireapp/wire-apps-js-sdk";
import type { WireCredentials } from "./credentials.js";
import { createSdkLogger, type LogSink } from "./sdk-logger.js";
import type { WireEventSink } from "./sdk-runtime.js";
import type { WireApi } from "./wire-api.js";
import { ConnectionWatchdog, DEFAULT_RECONNECT_TIMEOUT_MS, type Timers } from "./watchdog.js";

/** The subset of WireAppSdk the plugin relies on (faked in tests). */
export type WireSdkLike = {
  startListening(): Promise<void>;
  stopListening(): void;
  close(): Promise<void>;
  setBackendConnectionListener(listener: BackendConnectionListener): void;
  getApplicationManager(): WireApplicationManager;
  /** Plugin operations bound to this SDK instance. */
  readonly api: WireApi;
};

export type CreateWireSdk = (params: {
  credentials: WireCredentials;
  storagePath: string;
  sink: WireEventSink;
  logger: ReturnType<typeof createSdkLogger>;
}) => Promise<WireSdkLike>;

const loadRealSdk: CreateWireSdk = async (params) => {
  const { createWireSdk } = await import("./sdk-runtime.js");
  return await createWireSdk(params);
};

export type ConnectionEvents = {
  onConnected: () => void;
  onDisconnected: () => void;
  /** The connection will not recover by itself; end the run so the host restarts it. */
  onFatal: (error: Error) => void;
};

export type WireConnection = {
  readonly manager: WireApplicationManager;
  readonly api: WireApi;
  /** `id@domain` of the Wire app itself. */
  readonly appKey: string;
  close(): Promise<void>;
};

export async function openWireConnection(params: {
  credentials: WireCredentials;
  storagePath: string;
  sink: WireEventSink;
  log?: LogSink;
  events: ConnectionEvents;
  createSdk?: CreateWireSdk;
  reconnectTimeoutMs?: number;
  timers?: Timers;
}): Promise<WireConnection> {
  const { events, log } = params;
  let fatalRaised = false;
  const raiseFatal = (message: string) => {
    if (fatalRaised) return;
    fatalRaised = true;
    events.onFatal(new Error(message));
  };

  const watchdog = new ConnectionWatchdog(
    () => raiseFatal("Wire backend unreachable: no connection within the reconnect window"),
    params.reconnectTimeoutMs ?? DEFAULT_RECONNECT_TIMEOUT_MS,
    params.timers,
  );
  const logger = createSdkLogger(log, () => raiseFatal("Wire SDK stopped reconnecting"));

  const sdk = await (params.createSdk ?? loadRealSdk)({
    credentials: params.credentials,
    storagePath: params.storagePath,
    sink: params.sink,
    logger,
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    watchdog.stop();
    try {
      sdk.stopListening();
    } finally {
      // close() clears the SDK's process-global container: the manager and
      // this SDK instance must not be used afterwards.
      await sdk.close();
    }
  };

  try {
    const manager = sdk.getApplicationManager();
    const appId = manager.getApplicationQualifiedId();
    sdk.setBackendConnectionListener({
      onConnected: () => {
        watchdog.connected();
        events.onConnected();
      },
      onDisconnected: () => {
        watchdog.disconnected();
        events.onDisconnected();
      },
    });
    watchdog.arm();
    // Resolves once conversations are joined; the websocket connects in the
    // background and reports through the listener above.
    await sdk.startListening();
    return { manager, api: sdk.api, appKey: `${appId.id}@${appId.domain}`, close };
  } catch (err) {
    await close().catch(() => undefined);
    throw err;
  }
}
