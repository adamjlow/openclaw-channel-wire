import { describe, expect, it } from "vitest";
import { normalizeWireTarget, parseWireTarget } from "./targets.js";

describe("Wire targets", () => {
  it("treats a bare qualified id as a conversation", () => {
    expect(parseWireTarget("Conv-1@Wire.Example")).toEqual({ kind: "conversation", id: { id: "Conv-1", domain: "Wire.Example" } });
    expect(normalizeWireTarget("Conv-1@Wire.Example")).toBe("conv-1@wire.example");
  });

  it("accepts wire: and user:/conversation: prefixes", () => {
    expect(normalizeWireTarget("wire:user:AAAA@wire.example")).toBe("user:aaaa@wire.example");
    expect(normalizeWireTarget("conversation:c@wire.example")).toBe("c@wire.example");
  });

  it("rejects malformed targets", () => {
    for (const bad of ["", "nodomain", "user:", "a@b@c", "wire:"]) expect(parseWireTarget(bad)).toBeNull();
  });
});
