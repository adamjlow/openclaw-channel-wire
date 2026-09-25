#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-.}"; errors=0; warnings=0
bad(){ echo "ERROR: $*"; errors=$((errors+1)); }
warn(){ echo "WARN:  $*"; warnings=$((warnings+1)); }
ok(){ echo "OK:    $*"; }
[ -d "$ROOT" ] || { echo "ERROR: path not found: $ROOT"; exit 2; }
PKG="$ROOT/package.json"; MAN="$ROOT/openclaw.plugin.json"
[ -f "$PKG" ] && ok "package.json present" || bad "package.json missing"
[ -f "$MAN" ] && ok "openclaw.plugin.json present" || bad "openclaw.plugin.json missing"

if command -v node >/dev/null; then
  [ ! -f "$PKG" ] || node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$PKG" >/dev/null 2>&1 || bad "package.json invalid JSON"
  [ ! -f "$MAN" ] || node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$MAN" >/dev/null 2>&1 || bad "manifest invalid JSON"
  if [ -f "$PKG" ]; then
    node - "$PKG" <<'NODE' || errors=$((errors+1))
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8")),o=p.openclaw;
if(!o){console.error("ERROR: package.json lacks openclaw metadata");process.exit(1)}
if(!Array.isArray(o.extensions)||!o.extensions.length){console.error("ERROR: openclaw.extensions missing");process.exit(1)}
if(!o.channel?.id) console.error("WARN:  openclaw.channel.id missing; verify channel metadata");
console.log("OK:    OpenClaw package metadata detected");
NODE
  fi
  if [ -f "$MAN" ]; then
    node - "$MAN" <<'NODE' || errors=$((errors+1))
const fs=require("fs"),m=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));let b=false;
if(!m.id){console.error("ERROR: manifest id missing");b=true}
if(!Array.isArray(m.channels)||!m.channels.length){console.error("ERROR: manifest channels missing/empty");b=true}
if(!m.configSchema){console.error("ERROR: manifest configSchema missing");b=true}
if(b)process.exit(1); console.log("OK:    channel manifest baseline present");
NODE
  fi
fi

search(){ if command -v rg >/dev/null; then rg -n --glob '!node_modules/**' --glob '!.git/**' "$1" "$ROOT" 2>/dev/null || true; else grep -R -n -E --exclude-dir=node_modules --exclude-dir=.git "$1" "$ROOT" 2>/dev/null || true; fi; }
m="$(search 'from ["'\'']openclaw/plugin-sdk["'\'']')"; [ -z "$m" ] || { warn "broad plugin-sdk import found; verify narrow subpath"; echo "$m"; }
m="$(search 'openclaw/plugin-sdk/(testing|test-utils)')"; [ -z "$m" ] || { warn "legacy/removed test barrel found"; echo "$m"; }
m="$(search 'openclaw/plugin-sdk/(slack|discord|signal|whatsapp)')"; [ -z "$m" ] || { warn "provider-branded convenience seam found; verify target-version support"; echo "$m"; }


m="$(search 'openclaw/plugin-sdk/(config-runtime|infra-runtime|channel-lifecycle)')"
[ -z "$m" ] || { warn "deprecated compatibility subpath found; current docs record removal after 2026-10-01 for these seams, so verify target-version migration"; echo "$m"; }

m="$(search 'openclaw/plugin-sdk/(discord|telegram-account)')"
[ -z "$m" ] || { warn "deprecated/provider-specific compatibility facade found; do not copy into new third-party plugins"; echo "$m"; }

echo
echo "Preflight: $errors error(s), $warnings warning(s)."
echo "Now verify exact APIs against the target OpenClaw version and run repo tests/typecheck/lint/build."
[ "$errors" -eq 0 ]
