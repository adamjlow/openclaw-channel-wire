import { describe, expect, it } from "vitest";
import { describeError, redact } from "./redact.js";

describe("redact", () => {
  it("masks uuids and emails", () => {
    const text = "Conversation 3f2a9c1e-1111-2222-3333-444455556666@wire.com not found for adam@example.com";
    const out = redact(text);
    expect(out).not.toContain("3f2a9c1e-1111");
    expect(out).toContain("3f2a…");
    expect(out).not.toContain("adam@example.com");
  });

  it("describes errors on one line", () => {
    expect(describeError(new Error("line one\nline two"))).toBe("line one line two");
    expect(describeError("plain")).toBe("plain");
  });
});
