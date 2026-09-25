// Lightweight setup entry: loaded for status, list and SecretRef scans when the
// channel is disabled or unconfigured. Must stay import-safe.
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { wirePlugin } from "./channel.js";

export default defineSetupPluginEntry(wirePlugin);
