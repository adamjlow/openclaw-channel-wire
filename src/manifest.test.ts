import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.js";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

describe("openclaw.plugin.json", () => {
  it("matches the runtime config schema (run `npm run manifest:sync` if this fails)", () => {
    expect(read("openclaw.plugin.json")).toEqual(buildManifest());
  });

  it("agrees with package.json on the channel id", () => {
    const pkg = read("package.json");
    expect(pkg.openclaw.channel.id).toBe(read("openclaw.plugin.json").channels[0]);
  });
});
