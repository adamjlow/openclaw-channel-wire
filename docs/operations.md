# Operating openclaw-channel-wire

For whoever runs the gateway. Development setup is in the README.

## The one rule: one gateway per Wire app

The Wire SDK keeps its state in SQLite plus CoreCrypto files, and both are single-writer. Run exactly
one OpenClaw gateway per registered Wire app. No replicas, no blue/green overlap, and no second
instance pointed at a copy of the same state. When replacing a host, stop the old gateway fully
before starting the new one.

## What the state is, and why it matters

SDK state lives at `<OPENCLAW_STATE_DIR>/wire/<accountId>/`, which is `~/.openclaw/wire/default/`
by default:

| Path | Contents |
|---|---|
| `apps.db` (+ `-wal`, `-shm`) | Conversations, members, device id, and the app's **current backend token** (encrypted) |
| `cryptography/<appUserId>` | MLS keys and device state (encrypted with `cryptoKey`) |

The backend rotates the app token after first use, and the current token is stored in `apps.db`.
Once the gateway has run, **that directory is the live credential**. The original token from
`register-app.mjs` may no longer work.

The directory and `channels.wire.cryptoKey` form one unit. Neither is useful without the other, and
losing either loses the app's identity.

## Backup

1. Stop the gateway. SQLite and CoreCrypto files aren't safe to copy while they're being written.
2. Copy the whole `wire/<accountId>/` directory, including the `-wal`/`-shm` files.
3. Store it with, or alongside, the `cryptoKey` secret, protected the same way: it's key material.
4. Start the gateway.

## Restore

1. Stop the gateway.
2. Put the directory back at the same path, owned by the gateway user.
3. Make sure `channels.wire.cryptoKey` resolves to the key the backup was made with.
4. Start the gateway, then check `openclaw channels status --channel wire --probe` shows it connected.

Restoring an old backup is safe for identity. Messages sent while the backup was out of use are
caught up by the SDK's missed-notification sync, as long as the backend still holds them.

## Lost state (new device)

If the state directory is lost, the app comes back as a new device:

1. Issue a fresh token: `node scripts/register-app.mjs refresh --host … --email <team-admin> --app-id <id>`.
   Keep the existing `cryptoKey`, or generate a new one if the old key was lost
   too.
2. Update the `apiToken` secret and start the gateway on an empty state directory.
3. Expect to re-add the app to conversations where it no longer receives messages.

Don't delete the state directory to "fix" errors. Treat deletion as an identity reset, not routine
cleanup.

## Health and restarts

- `openclaw channels status --channel wire --probe` shows `connected`, `lifecycle` and `lastError`.
  The probe reads the live connection and never opens a second SDK instance.
- If the backend is unreachable, the SDK retries with backoff. If it stops trying, or 5 minutes pass
  without a connection, the plugin ends the account run and OpenClaw restarts it (5s to 300s
  backoff, 10 attempts, then the health monitor takes over).
- Logs are metadata only. Message text, file names, tokens and keys are never logged, and ids in
  error messages are masked.

## Access control

- DMs default to `pairing`. Unknown senders get a code, and the operator approves with
  `openclaw pairing approve wire <code>`. For a closed deployment, set `dmPolicy: "allowlist"`
  with explicit `allowFrom` entries.
- Allowlist entries are qualified ids, `<uuid>@<domain>`. The domain is part of the identity, so
  federated users on other backends never match by uuid alone.
- In groups, the app answers only when @mentioned (`requireMention: true`) and only for senders in
  `groupAllowFrom`, or in `allowFrom` when `groupAllowFrom` is empty.
- `openclaw security audit` reports the effective Wire DM posture.
