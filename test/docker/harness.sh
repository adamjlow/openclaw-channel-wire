#!/usr/bin/env bash
# Test harness driver. Usage (from the repo root): npm run harness -- <command>
#   up       build + pack the plugin, build the image, start the gateway (detached)
#   logs     follow gateway logs
#   cli ...  run an openclaw command in the running gateway container
#   status   channel status from inside the container
#   down     stop the gateway, keep the state volume (identity survives)
#   reset    DELETE the state volume: the Wire app registers as a new device
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
compose=(docker compose -f "$here/compose.yaml")

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    [ -f "$here/.env" ] || { echo "missing test/docker/.env (copy .env.example)"; exit 1; }
    mkdir -p "$here/plugin"
    (cd "$root" && npm pack --silent --pack-destination "$here/plugin" | tail -1) \
      | xargs -I{} mv "$here/plugin/{}" "$here/plugin/openclaw-channel-wire.tgz"
    "${compose[@]}" up -d --build
    echo "gateway starting; follow with: npm run harness -- logs"
    ;;
  logs) "${compose[@]}" logs -f gateway ;;
  cli) "${compose[@]}" exec gateway openclaw "$@" ;;
  status) "${compose[@]}" exec gateway openclaw channels status --channel wire --probe ;;
  down) "${compose[@]}" down ;;
  reset)
    read -r -p "Delete the Wire app's crypto identity and all OpenClaw state? [y/N] " ok
    [ "$ok" = "y" ] && "${compose[@]}" down -v
    ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
