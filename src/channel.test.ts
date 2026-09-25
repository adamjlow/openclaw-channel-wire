import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { wirePlugin } from "./channel.js";

const cfg = (wire: unknown) => ({ channels: { wire } }) as unknown as OpenClawConfig;

describe("wirePlugin", () => {
  it("declares the wire channel with direct and group chats", () => {
    expect(wirePlugin.id).toBe("wire");
    expect(wirePlugin.meta.id).toBe("wire");
    expect(wirePlugin.capabilities.chatTypes).toEqual(["direct", "group"]);
  });

  it("lists the single default account", () => {
    expect(wirePlugin.config.listAccountIds(cfg({}))).toEqual(["default"]);
  });

  it("registers apiToken and cryptoKey as secret targets", () => {
    const paths = (wirePlugin.secrets?.secretTargetRegistryEntries ?? []).map((entry) => entry.pathPattern);
    expect(paths).toEqual(expect.arrayContaining(["channels.wire.apiToken", "channels.wire.cryptoKey"]));
  });

  it("exposes the config schema for cold-path validation", () => {
    expect(wirePlugin.configSchema?.schema).toMatchObject({ type: "object" });
  });
});
