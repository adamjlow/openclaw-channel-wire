// Secret targets for `channels.wire`, so OpenClaw can scan, redact and resolve
// SecretRefs for this channel. Single account, fields live at the channel root.
import { createSimpleChannelSecretContract } from "openclaw/plugin-sdk/channel-secret-basic-runtime";
import { CHANNEL_ID } from "./config.js";

export const channelSecrets = createSimpleChannelSecretContract({
  channelKey: CHANNEL_ID,
  label: "Wire",
  accountFields: [],
  channelFields: ["apiToken", "cryptoKey"],
  mode: "channel-only",
});
