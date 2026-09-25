#!/usr/bin/env bash
# Harness entrypoint. `gateway` (default): onboard on first run, (re)install the
# packed plugin, write channels.wire from env, then run the gateway. Any other
# arguments run as an openclaw command, e.g. `docker compose run gateway plugins list`.
set -euo pipefail

if [ "${1:-gateway}" != "gateway" ]; then
  exec openclaw "$@"
fi

: "${OPENCLAW_GATEWAY_TOKEN:?set OPENCLAW_GATEWAY_TOKEN in test/docker/.env}"
: "${WIRE_SDK_API_HOST:?set WIRE_SDK_API_HOST in test/docker/.env (from register-app.mjs)}"
: "${WIRE_SDK_API_TOKEN:?set WIRE_SDK_API_TOKEN in test/docker/.env (from register-app.mjs)}"
: "${WIRE_SDK_CRYPTO_KEY:?set WIRE_SDK_CRYPTO_KEY in test/docker/.env (from register-app.mjs)}"

step() { printf '[harness] %s\n' "$*"; }

if [ ! -f "${OPENCLAW_STATE_DIR}/openclaw.json" ]; then
  step "first run: onboarding (auth choice: ${OPENCLAW_AUTH_CHOICE:-skip})"
  openclaw onboard --non-interactive --accept-risk --skip-health --mode local \
    --auth-choice "${OPENCLAW_AUTH_CHOICE:-skip}" \
    --secret-input-mode ref \
    --gateway-auth token --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN \
    --skip-channels --skip-skills --no-install-daemon
fi

plugin=/plugin/openclaw-channel-wire.tgz
marker="${OPENCLAW_STATE_DIR}/.harness-plugin.sha256"
if [ -f "$plugin" ]; then
  sum="$(sha256sum "$plugin" | cut -d' ' -f1)"
  if [ "$(cat "$marker" 2>/dev/null)" != "$sum" ]; then
    step "installing plugin ${sum:0:12}"
    openclaw plugins install "npm-pack:$plugin" --force --accept-capabilities
    openclaw plugins enable wire --accept-capabilities
    echo "$sum" > "$marker"
  else
    step "plugin unchanged (${sum:0:12})"
  fi
else
  step "no plugin at $plugin; run the harness via 'npm run harness -- up'"
  exit 1
fi

step "writing gateway and channels.wire config"
openclaw config set --batch-json "$(node -e '
  const env = (id) => ({ source: "env", provider: "default", id });
  const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ops = [
    { path: "gateway.mode", value: "local" },
    { path: "gateway.bind", value: "lan" },
    { path: "gateway.controlUi.allowedOrigins", value: ["http://localhost:18789", "http://127.0.0.1:18789"] },
    { path: "channels.wire.apiHost", value: process.env.WIRE_SDK_API_HOST },
    { path: "channels.wire.apiToken", value: env("WIRE_SDK_API_TOKEN") },
    { path: "channels.wire.cryptoKey", value: env("WIRE_SDK_CRYPTO_KEY") },
    { path: "channels.wire.dmPolicy", value: process.env.WIRE_DM_POLICY || "pairing" },
    { path: "channels.wire.allowFrom", value: list(process.env.WIRE_ALLOW_FROM) },
    { path: "channels.wire.groupPolicy", value: process.env.WIRE_GROUP_POLICY || "allowlist" },
    { path: "channels.wire.groupAllowFrom", value: list(process.env.WIRE_GROUP_ALLOW_FROM) },
    { path: "channels.wire.requireMention", value: process.env.WIRE_REQUIRE_MENTION !== "false" },
  ];
  process.stdout.write(JSON.stringify(ops));
')"

step "starting gateway"
exec openclaw gateway --port 18789
