// Regenerates openclaw.plugin.json from the runtime config schema so the
// cold-path manifest schema can never drift from what the plugin validates.
// Run via `npm run manifest:sync` (builds first). src/manifest.test.ts fails
// when the committed manifest is out of date.
import { writeFileSync } from "node:fs";
import { buildManifest } from "../dist/manifest.js";

const path = new URL("../openclaw.plugin.json", import.meta.url);
writeFileSync(path, `${JSON.stringify(buildManifest(), null, 2)}\n`);
console.log("wrote openclaw.plugin.json");
