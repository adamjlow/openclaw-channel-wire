// Process-wide slot for the host PluginRuntime, filled by the channel entry's
// setRuntime callback. Gateway code reads it for state-dir resolution.
import { createPluginRuntimeStore, type PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const store = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "wire",
  errorMessage: "Wire plugin runtime is not initialised",
});

export const setWireRuntime = store.setRuntime;
export const getWireRuntime = store.getRuntime;
export const tryGetWireRuntime = store.tryGetRuntime;
