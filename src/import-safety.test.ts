import { describe, expect, it, vi } from "vitest";

// Discovery and setup evaluate the entry modules. They must never pull in the
// Wire SDK (native CoreCrypto, SQLite) or start anything.
vi.mock("@wireapp/wire-apps-js-sdk", () => {
  throw new Error("Wire SDK imported at module load");
});

describe("entry import safety", () => {
  it("setup entry imports without loading the Wire SDK", async () => {
    const mod = await import("./setup-entry.js");
    expect(mod.default.plugin.id).toBe("wire");
  });

  it("full entry imports without loading the Wire SDK", async () => {
    const mod = await import("./index.js");
    expect(mod.default).toBeTruthy();
  });
});
