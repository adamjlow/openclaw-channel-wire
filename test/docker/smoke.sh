#!/usr/bin/env bash
# Loader smoke test: install the packed plugin into a real OpenClaw and check
# it registers, passes doctor and reports as unconfigured. No Wire credentials.
# Usage: test/docker/smoke.sh   (run from the repo root)
set -euo pipefail

IMAGE="openclaw-channel-wire-test:local"
root="$(cd "$(dirname "$0")/../.." && pwd)"

docker build -q -t "$IMAGE" "$root/test/docker" >/dev/null
tgz="$(cd "$root" && npm pack --silent | tail -1)"
trap 'rm -f "$root/$tgz"' EXIT

docker run --rm --entrypoint bash -v "$root/$tgz:/tmp/plugin.tgz:ro" "$IMAGE" -euo pipefail -c '
  step() { printf "\n=== %s\n" "$*"; }
  step "install"
  openclaw plugins install npm-pack:/tmp/plugin.tgz --force --accept-capabilities
  step "enable"
  openclaw plugins enable wire --accept-capabilities
  step "inspect"
  openclaw plugins inspect wire --runtime --json
  step "doctor"
  openclaw plugins doctor
  step "channels status"
  openclaw channels status --json || openclaw channels status
'
