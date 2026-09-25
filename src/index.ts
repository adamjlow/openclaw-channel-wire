// Full plugin entry. Registration only: the Wire SDK is imported lazily by the
// gateway adapter when an account starts, never at module load.
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { wirePlugin } from "./channel.js";
import { setWireRuntime } from "./runtime.js";

export default defineChannelPluginEntry({
  id: "wire",
  name: "Wire",
  description: "Wire channel plugin (E2EE, MLS) built on @wireapp/wire-apps-js-sdk",
  plugin: wirePlugin,
  setRuntime: setWireRuntime,
});
