import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { describeUnconfigured, inspectWireAccount, resolveWireAccount } from "./config.js";

const cfg = (wire: unknown) => ({ channels: { wire } }) as unknown as OpenClawConfig;
const envRef = (id: string) => ({ source: "env", provider: "default", id });

const complete = {
  apiHost: "https://wire.example",
  apiToken: envRef("WIRE_SDK_API_TOKEN"),
  cryptoKey: envRef("WIRE_SDK_CRYPTO_KEY"),
};

describe("resolveWireAccount", () => {
  it("treats a missing section as unconfigured with safe defaults", () => {
    const account = resolveWireAccount({} as OpenClawConfig);
    expect(account).toMatchObject({
      accountId: "default",
      enabled: true,
      configured: false,
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      allowFrom: [],
    });
  });

  it("is configured when host, token and key are present as SecretRefs", () => {
    const account = resolveWireAccount(cfg(complete));
    expect(account.configured).toBe(true);
    expect(account.apiToken).toEqual(envRef("WIRE_SDK_API_TOKEN"));
  });

  it("accepts plain string secrets (e.g. after ${VAR} substitution)", () => {
    expect(resolveWireAccount(cfg({ ...complete, apiToken: "tok", cryptoKey: "a".repeat(64) })).configured).toBe(true);
  });

  it("reports missing fields without throwing", () => {
    const account = resolveWireAccount(cfg({ apiHost: complete.apiHost }));
    expect(account.configured).toBe(false);
    expect(describeUnconfigured(account)).toBe("channels.wire is missing: apiToken, cryptoKey");
  });

  it("never throws on an invalid section and reports issue paths only", () => {
    const account = resolveWireAccount(cfg({ ...complete, apiHost: "http://insecure", bogus: 1 }));
    expect(account.configured).toBe(false);
    expect(account.configIssues).toEqual(expect.arrayContaining(["apiHost"]));
    expect(describeUnconfigured(account)).not.toContain("insecure");
  });

  it("honours enabled: false", () => {
    expect(resolveWireAccount(cfg({ ...complete, enabled: false })).enabled).toBe(false);
  });

  it("requires qualified ids in allowlists", () => {
    expect(resolveWireAccount(cfg({ ...complete, allowFrom: ["abc@wire.com", "*"] })).configured).toBe(true);
    expect(resolveWireAccount(cfg({ ...complete, allowFrom: ["abc"] })).configIssues).toEqual(["allowFrom.0"]);
  });

  it('requires "*" in allowFrom when dmPolicy is open', () => {
    expect(resolveWireAccount(cfg({ ...complete, dmPolicy: "open" })).configured).toBe(false);
    expect(resolveWireAccount(cfg({ ...complete, dmPolicy: "open", allowFrom: ["*"] })).configured).toBe(true);
  });
});

describe("inspectWireAccount", () => {
  it("exposes presence flags but never secret values", () => {
    const result = inspectWireAccount(cfg({ ...complete, apiToken: "super-secret-token" }));
    expect(result).toMatchObject({ configured: true, apiTokenStatus: "configured", cryptoKeyStatus: "configured" });
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
    expect(JSON.stringify(result)).not.toContain("WIRE_SDK");
  });
});
