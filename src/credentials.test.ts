import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { resolveWireAccount } from "./config.js";
import { decodeCryptoKey, resolveWireCredentials } from "./credentials.js";

const HEX = "0123456789abcdef".repeat(4);
const envRef = (id: string) => ({ source: "env", provider: "default", id });
const cfg = (wire: unknown) => ({ channels: { wire } }) as unknown as OpenClawConfig;

describe("decodeCryptoKey", () => {
  it("decodes 64 hex chars to 32 bytes", () => {
    const key = decodeCryptoKey(`  ${HEX.toUpperCase()}\n`);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
    expect(key[1]).toBe(0x23);
  });

  it.each([["short", HEX.slice(2)], ["long", `${HEX}00`], ["non-hex", `${HEX.slice(1)}z`], ["base64", "a".repeat(44)]])(
    "rejects a %s key without echoing it",
    (_label, value) => {
      expect(() => decodeCryptoKey(value)).toThrowError(/64 hex characters/);
      try {
        decodeCryptoKey(value);
      } catch (err) {
        expect((err as Error).message).not.toContain(value);
      }
    },
  );
});

describe("resolveWireCredentials", () => {
  const section = {
    apiHost: "https://wire.example",
    apiToken: envRef("WIRE_SDK_API_TOKEN"),
    cryptoKey: envRef("WIRE_SDK_CRYPTO_KEY"),
  };

  it("resolves env SecretRefs and decodes the key", async () => {
    const config = cfg(section);
    const creds = await resolveWireCredentials(config, resolveWireAccount(config), {
      WIRE_SDK_API_TOKEN: " tok ",
      WIRE_SDK_CRYPTO_KEY: HEX,
    });
    expect(creds.apiHost).toBe(section.apiHost);
    expect(creds.apiToken).toBe("tok");
    expect(creds.cryptographyStorageKey.length).toBe(32);
  });

  it("fails with the config path when a ref cannot be resolved", async () => {
    const config = cfg(section);
    await expect(resolveWireCredentials(config, resolveWireAccount(config), { WIRE_SDK_CRYPTO_KEY: HEX })).rejects.toThrow(
      /channels\.wire\.apiToken/,
    );
  });

  it("rejects a malformed key from the environment without leaking it", async () => {
    const config = cfg(section);
    const promise = resolveWireCredentials(config, resolveWireAccount(config), {
      WIRE_SDK_API_TOKEN: "tok",
      WIRE_SDK_CRYPTO_KEY: "not-a-key-value",
    });
    await expect(promise).rejects.toThrow(/64 hex characters/);
    await expect(promise).rejects.not.toThrow(/not-a-key-value/);
  });
});
