#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-.}"; errors=0; warnings=0
bad(){ echo "ERROR: $*"; errors=$((errors+1)); }
warn(){ echo "WARN:  $*"; warnings=$((warnings+1)); }
ok(){ echo "OK:    $*"; }
[ -d "$ROOT" ] || { echo "ERROR: path not found: $ROOT"; exit 2; }
PKG="$ROOT/package.json"
[ -f "$PKG" ] && ok "package.json present" || bad "package.json missing"

if command -v node >/dev/null && [ -f "$PKG" ]; then
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$PKG" >/dev/null 2>&1 || bad "package.json invalid JSON"
  node - "$PKG" <<'NODE' || errors=$((errors+1))
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const v=p.dependencies?.["@wireapp/wire-apps-js-sdk"]||p.devDependencies?.["@wireapp/wire-apps-js-sdk"];
if(!v){console.error("ERROR: @wireapp/wire-apps-js-sdk not declared");process.exit(1)}
console.log("OK:    declared @wireapp/wire-apps-js-sdk:",v);
if(p.type!=="module") console.error('WARN:  package.json type is not "module"; current Wire SDK is ESM');
NODE
fi

INST="$ROOT/node_modules/@wireapp/wire-apps-js-sdk/package.json"
if [ -f "$INST" ] && command -v node >/dev/null; then
  node - "$INST" <<'NODE'
const fs=require("fs"),p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
console.log("OK:    installed Wire SDK version:",p.version);
if(p.engines) console.log("INFO:  SDK engines:",JSON.stringify(p.engines));
NODE
else
  warn "installed SDK package metadata not found; exact local API verification may be unavailable"
fi

major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$major" -ge 22 ] 2>/dev/null; then ok "Node runtime is >=22 ($major)"; else warn "Node runtime is <22 or unavailable; current Wire docs target Node 22"; fi

search(){ if command -v rg >/dev/null; then rg -n --glob '!node_modules/**' --glob '!.git/**' "$1" "$ROOT" 2>/dev/null || true; else grep -R -n -E --exclude-dir=node_modules --exclude-dir=.git "$1" "$ROOT" 2>/dev/null || true; fi; }

m="$(search 'new Uint8Array\\(32\\)(\\.fill\\([^)]*\\))?')"
[ -z "$m" ] || { warn "32-byte placeholder/static key construction found; never use a zero/filled key as production cryptographyStorageKey"; echo "$m"; }

m="$(search 'cryptographyStorageKey.*(console|log)|console\\.(log|debug|info).*cryptographyStorageKey')"
[ -z "$m" ] || { bad "possible cryptography storage key logging"; echo "$m"; }

m="$(search '@wireapp/wire-apps-js-sdk')"
[ -n "$m" ] && ok "Wire SDK usage found" || warn "no Wire SDK imports/usages found outside node_modules"

m="$(search 'startListening\\(')"
[ -n "$m" ] && ok "listening lifecycle usage found" || warn "no startListening() usage found; fine for non-listening utilities, otherwise verify lifecycle"

m="$(search 'stopListening\\(')"
[ -n "$m" ] && ok "stopListening() usage found" || warn "no stopListening() usage found; verify graceful shutdown for long-running apps"


# Packaging/deployment hazards
m="$(search 'webpack|esbuild|rollup')"
if [ -n "$m" ]; then
  warn "bundler detected/referenced; verify @wireapp/wire-apps-js-sdk build/db/migrations/** is preserved beside DatabaseService.js"
fi

m="$(search '(replicas:|replicaCount:|instances:)[[:space:]]*[2-9]')"
if [ -n "$m" ]; then
  warn "possible multi-replica deployment found; current Wire SDK requires one active instance per credentials/storage"
  echo "$m"
fi

m="$(search 'storage/apps\\.db|storage/cryptography')"
[ -n "$m" ] && ok "explicit SDK storage handling/reference found" || warn "no explicit SDK storage path reference found; verify ./storage is persistent in deployment"

m="$(search '(conversationId|sender).*split\\(')"
if [ -n "$m" ]; then
  warn "possible ad-hoc Wire identifier parsing found; conversation/sender identities may be QualifiedId in federated environments"
  echo "$m"
fi

echo
echo "Preflight: $errors error(s), $warnings warning(s)."
echo "Now verify exact exports/signatures in the installed SDK declarations and run repo tests/typecheck/lint/build."
[ "$errors" -eq 0 ]
