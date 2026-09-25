# openclaw-channel-wire

> [!CAUTION]
> **Read this before you connect anything.** Wire is built to keep conversations private: messages
> are end-to-end encrypted, so only the people in a conversation can read them. This plugin
> deliberately gives an AI assistant a seat in those conversations. Everything it can read (the
> messages it receives and the files people send it) is decrypted and passed to
> [OpenClaw](https://openclaw.ai), and from there to whichever AI model provider you configure. That
> provider is a third party outside Wire's encryption, with its own data handling, retention and
> jurisdiction.
>
> Connecting Wire to an AI agent therefore weakens the protection Wire gives you, and an agent with
> tools can act on what it reads. Use it only if you understand and accept that trade-off:
> - Keep access tight (`dmPolicy: "allowlist"` or pairing, and `requireMention` in groups).
> - Don't add the app to conversations that hold sensitive information.
> - Choose your model provider as carefully as you would choose who else can read these
>   messages.
> - Tell the people in a conversation when an assistant is present.

An example of what you can build on Wire's JavaScript SDK,
[`@wireapp/wire-apps-js-sdk`](https://github.com/wireapp/wire-apps-js-sdk): an
[OpenClaw](https://openclaw.ai) channel plugin that joins [Wire](https://wire.com) conversations as a
Wire app and connects them to an OpenClaw assistant. Use it as a working plugin, or as a reference for
building your own integrations with the SDK.

- 1:1 conversations, with DM pairing (default), allowlists or open access
- Group conversations, answering when @mentioned, with a sender allowlist
- Proactive sends to conversations or people (cron, the message tool)
- Quoted replies in groups
- Files in both directions, with a type and size policy
- SecretRef-based credentials; message content and ids are never logged

Design: [docs/architecture.md](docs/architecture.md). Operations and backups:
[docs/operations.md](docs/operations.md). Changes: [CHANGELOG.md](CHANGELOG.md).

## Requirements

- OpenClaw `>=2026.9.6`
- Node `>=24.16 <25` or `>=26.1` (OpenClaw's supported range)
- Linux x86_64 with glibc 2.38 or newer, for example Debian 13 (trixie). Wire's CoreCrypto native
  library doesn't run on Alpine/musl, on arm64, or on the official OpenClaw Docker image (Debian 12,
  glibc 2.36). [`test/docker/Dockerfile`](test/docker/Dockerfile) is a working base image.
- A Wire team where you are an admin, so you can register the app
- Persistent storage for OpenClaw's state directory. The app's crypto identity and its rotated
  token live there (see [operations](docs/operations.md)).

## Install

Download `openclaw-channel-wire-<version>.tgz` from the
[releases page](https://github.com/adamjlow/openclaw-channel-wire/releases), then:

```bash
openclaw plugins install npm-pack:./openclaw-channel-wire-1.0.0.tgz
openclaw plugins enable wire
```

Add `--force --accept-capabilities` to both commands for unattended installs.

## Register a Wire app

The plugin signs in as a Wire **app**, not a user account. A team admin registers it once with the
included script. It needs Node 18 or newer and no dependencies:

```bash
node scripts/register-app.mjs versions --host https://prod-nginz-https.wire.com
node scripts/register-app.mjs create --host https://prod-nginz-https.wire.com \
  --email <team-admin-email> --name "OpenClaw" --out wire-app.env
```

- `https://prod-nginz-https.wire.com` is Wire's cloud. Self-hosted backends use their own nginz
  URL.
- The admin password is prompted for without echo.
- If the admin account has 2FA, run `send-code` first and pass `--code`.
- The output file is written with mode 0600 and holds `WIRE_SDK_API_HOST`, `WIRE_SDK_APP_ID`,
  `WIRE_SDK_APP_DOMAIN`, `WIRE_SDK_API_TOKEN` and a freshly generated `WIRE_SDK_CRYPTO_KEY`.
- `refresh` issues a new token for an existing app, and `list` shows the team's apps.

Then add the app to the conversations it should take part in.

## Configure

Put the secrets where OpenClaw can resolve them (here, environment variables) and configure
`channels.wire`:

```json5
channels: {
  wire: {
    apiHost: "https://prod-nginz-https.wire.com",
    apiToken: { source: "env", provider: "default", id: "WIRE_SDK_API_TOKEN" },
    cryptoKey: { source: "env", provider: "default", id: "WIRE_SDK_CRYPTO_KEY" },
    dmPolicy: "pairing",
  },
}
```

| Key | Type | Notes |
|---|---|---|
| `apiHost` | `https://` URL | Wire backend |
| `apiToken` | SecretRef or string | App token from `register-app.mjs` |
| `cryptoKey` | SecretRef or string | 64 hex characters (32 bytes). Keep it with the state directory; losing either loses the app's identity. |
| `dmPolicy` | `pairing` (default), `allowlist`, `open`, `disabled` | `open` requires `"*"` in `allowFrom` |
| `allowFrom` | qualified ids | `<uuid>@<domain>`, or `"*"` |
| `groupPolicy` | `allowlist` (default), `open`, `disabled` | Who may address the assistant in groups |
| `groupAllowFrom` | qualified ids | Falls back to `allowFrom` when empty |
| `requireMention` | boolean, default `true` | Groups need an @mention of the app, or a match on OpenClaw's mention patterns |
| `assetPolicy.maxBytes` | integer, default 25 MiB | File size cap, both directions |
| `assetPolicy.mimeAllowlist` | MIME types | Accepted incoming files (default: PDF, text, CSV, JSON, Office documents, common images) |

With the default `pairing` policy, a new contact receives a code; approve it with
`openclaw pairing approve wire <code>`.

Outbound targets are `<conversation-uuid>@<domain>` or `user:<user-uuid>@<domain>`.

Run exactly one gateway per Wire app. The SDK state is single-writer, so replicas and overlapping
restarts are not supported.

## Development

Node 24 is required, because `openclaw`'s install script refuses older versions even as a dev
dependency.

```bash
npm ci --legacy-peer-deps --ignore-scripts   # like OpenClaw's own plugin installs
npm run typecheck
npm run lint
npm test
npm run build
npm run manifest:sync       # after changing the config schema; a test fails if you forget
npm pack                    # openclaw-channel-wire-<version>.tgz
npm run smoke               # Docker: install the pack into a real OpenClaw and run doctor
```

Until the `storagePath` and `registerExitHandlers` options are released upstream
(wireapp/wire-apps-js-sdk#348, #349), the SDK is built from that branch into `vendor/` and shipped
inside the package through `bundleDependencies`.

### Test harness

`test/docker/` runs a real OpenClaw gateway with the plugin installed the way users install it, on
Debian trixie with Node 24.

1. Register an app into `test/docker/.env`
   (`node scripts/register-app.mjs create … --out test/docker/.env`).
2. Add the remaining keys from [test/docker/.env.example](test/docker/.env.example): a gateway token,
   your Wire user id in `WIRE_ALLOW_FROM`, and a model provider (`OPENCLAW_AUTH_CHOICE` plus its
   key).
3. From the repo root:

```bash
npm run harness -- up        # pack, build image, start gateway (detached)
npm run harness -- logs      # follow logs
npm run harness -- status    # channel status with probe
npm run harness -- cli ...   # any openclaw command inside the container
npm run harness -- down      # stop; the state volume (Wire identity) is kept
npm run harness -- reset     # delete state: the app registers as a new device
```

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as
described in [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE) © openclaw-channel-wire contributors.

The Wire SDK this plugin uses, `@wireapp/wire-apps-js-sdk`, is licensed under **GPL-3.0**. Release
packages currently bundle it, so redistributing a package means complying with the GPL-3.0 for the
SDK part (its source is public at
[wireapp/wire-apps-js-sdk](https://github.com/wireapp/wire-apps-js-sdk)). OpenClaw is MIT-licensed.
