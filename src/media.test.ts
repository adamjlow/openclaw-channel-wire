import { describe, expect, it } from "vitest";
import { rejectInboundAsset, toByteCount } from "./media.js";

const policy = { maxBytes: 100, mimeAllowlist: ["application/pdf", "image/png"] };

describe("rejectInboundAsset", () => {
  const ok = { mimeType: "application/pdf", sizeInBytes: 10, remoteData: {} };

  it("accepts allowed types within the limit, ignoring MIME parameters and case", () => {
    expect(rejectInboundAsset(ok, policy)).toBeNull();
    expect(rejectInboundAsset({ ...ok, mimeType: "Image/PNG; charset=binary" }, policy)).toBeNull();
  });

  it("rejects other types, oversize files and missing remote data", () => {
    expect(rejectInboundAsset({ ...ok, mimeType: "text/html" }, policy)).toMatch(/type of file/);
    expect(rejectInboundAsset({ ...ok, sizeInBytes: 101 }, policy)).toMatch(/too large/);
    expect(rejectInboundAsset({ mimeType: "application/pdf", sizeInBytes: 1 }, policy)).toMatch(/couldn't retrieve/);
  });
});

describe("toByteCount", () => {
  it("handles numbers and Long-like values", () => {
    expect(toByteCount(42)).toBe(42);
    expect(toByteCount({ toNumber: () => 7 })).toBe(7);
    expect(toByteCount(undefined)).toBe(0);
  });
});
