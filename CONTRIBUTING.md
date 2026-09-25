# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you start

- Read [docs/architecture.md](docs/architecture.md). It explains the design and the OpenClaw and
  Wire SDK behaviour the code relies on.
- Both SDKs are young and change quickly. Check any OpenClaw or Wire SDK symbol against the installed
  typings (`node_modules/openclaw/dist/plugin-sdk/`, `node_modules/@wireapp/wire-apps-js-sdk/build/`)
  rather than memory or older examples. If you use an AI coding tool, the skills in
  `.claude/skills/` encode this discipline and ship validator scripts.

## Setup

Node 24 or newer, plus Docker for the smoke test and harness.

```bash
npm ci --legacy-peer-deps
npm run typecheck && npm run lint && npm test
npm run smoke
```

## Pull requests

- Keep changes focused and add tests. The SDK is faked behind `WireApi` and `WireSdkLike`, so most
  behaviour can be unit-tested without a Wire backend.
- If you change the config schema, run `npm run manifest:sync` and commit `openclaw.plugin.json`.
- Entry modules and `src/channel.ts` must stay import-safe: no SDK import or side effects at load
  (`src/import-safety.test.ts`).
- Never log message text, file names, tokens, keys, or raw user or conversation ids. Use
  `describeError` from `src/redact.ts` for errors.
- Update `CHANGELOG.md` for user-visible changes.

By contributing, you agree that your contributions are licensed under the [MIT licence](LICENSE).
