# Changelog

## 1.0.0 (2026-09-25)

First release.

- Wire channel for OpenClaw `>=2026.9.6`, running as a Wire app on `@wireapp/wire-apps-js-sdk`
  (vendored build of 0.1.0 with `storagePath` and `registerExitHandlers`, pending upstream release)
- 1:1 conversations with pairing, allowlist or open DM policy
- Group conversations with @mention gating and a sender allowlist
- Outbound sends to conversations and to people (`user:<id>@<domain>`); quoted replies in groups
- Files in both directions with a MIME allowlist and size cap; inbound files go through OpenClaw's
  media store
- SecretRef credentials, SDK state under OpenClaw's state directory, reconnect give-up detection,
  status probe, redacted logging
- `scripts/register-app.mjs` to register the Wire app; Docker smoke test and live test harness
