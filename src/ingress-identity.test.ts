import { describe, expect, it } from "vitest";
import { normalizeWireAllowEntry } from "./ingress-identity.js";

describe("normalizeWireAllowEntry", () => {
  it("lowercases qualified ids and keeps the wildcard", () => {
    expect(normalizeWireAllowEntry(" AAAA-1111@Wire.Example ")).toBe("aaaa-1111@wire.example");
    expect(normalizeWireAllowEntry("*")).toBe("*");
  });

  it("rejects entries without a domain so federated users can't match by uuid alone", () => {
    expect(normalizeWireAllowEntry("aaaa-1111")).toBeNull();
    expect(normalizeWireAllowEntry("a@b@c")).toBeNull();
    expect(normalizeWireAllowEntry("")).toBeNull();
  });
});
