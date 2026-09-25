# Agent Operating Guide

## Repository overview
`openclaw-channel-wire`: an OpenClaw channel plugin (channel id `wire`) for Wire, running as a Wire
app on the public `@wireapp/wire-apps-js-sdk`. [docs/architecture.md](docs/architecture.md) holds the
design and the verified SDK behaviour; read it before starting work. Outstanding work is in the
README's Status section.

## Skills
Load both repo skills before touching plugin code, and follow their rules:
- `.claude/skills/openclaw-channel-plugin-development`
- `.claude/skills/wire-apps-js-sdk-development`

Don't write an OpenClaw or Wire SDK identifier until you have seen it in the installed `.d.ts`
(`node_modules/openclaw/dist/plugin-sdk/`, `node_modules/@wireapp/wire-apps-js-sdk/build/`).

## Layout
| Path | Purpose |
|---|---|
| `src/index.ts`, `src/setup-entry.ts` | Entries (`defineChannelPluginEntry` with `setRuntime`; setup). Import-safe. |
| `src/channel.ts` | `ChannelPlugin` via `createChatChannelPlugin`: config, status, security, pairing, threading, outbound; lazy-loads the gateway |
| `src/config.ts` | `channels.wire` schema, account resolution, secret-safe inspection |
| `src/secret-contract.ts` | SecretRef targets (`apiToken`, `cryptoKey`) |
| `src/gateway.ts` | Account run: credentials, storage path, connection, abort vs fatal |
| `src/connection.ts`, `src/watchdog.ts`, `src/connection-state.ts` | SDK lifecycle, reconnect give-up detection, live connection registry |
| `src/sdk-runtime.ts` | **The only runtime SDK import** (lazy): `WireAppSdk.create`, events handler, `createWireApi` |
| `src/wire-api.ts` | Plugin-owned `WireApi` interface and qualified-id helpers |
| `src/inbound.ts`, `src/ingress-identity.ts` | Inbound queue, policy via the ingress resolver, dispatch, replies |
| `src/outbound.ts`, `src/targets.ts` | Outbound adapter and target grammar |
| `src/media.ts` | File policy, ingest via host media store, outbound uploads |
| `src/credentials.ts`, `src/sdk-logger.ts`, `src/redact.ts` | Secret resolution, SDK log filtering, log redaction |
| `src/manifest.ts` | Source for `openclaw.plugin.json` (`npm run manifest:sync`) |
| `vendor/` | SDK tgz from PR #349, bundled via `bundleDependencies` until released |
| `test/docker/` | Loader smoke test and live test harness |
| `scripts/register-app.mjs` | Registers the Wire app and emits its credentials |
| `docs/operations.md` | Deployment, backup/restore and recovery runbook |

## Commands (Node 24 required)
```bash
npm ci --legacy-peer-deps
npm run typecheck && npm run lint && npm test
npm run build && npm run manifest:sync
npm run smoke                 # credential-free loader test in Docker
npm run harness -- up|logs|status|cli|down|reset
```

## Rules
- Entry modules and `src/channel.ts` must not import the Wire SDK or start anything at load. The
  SDK is imported lazily in the gateway adapter; `src/import-safety.test.ts` enforces this.
- Never log message text, asset names, tokens, keys, or raw user or conversation ids.
- Treat the OpenClaw state volume as the app's credential: it holds SDK storage (`apps.db`,
  CoreCrypto) and the rotated token. One gateway per app identity.
- Never commit `.env` files or Wire credentials.
- Don't alter SDK crypto behaviour.
