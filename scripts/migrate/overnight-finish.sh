#!/usr/bin/env bash
# Overnight autopilot: retry the Firestore export every 30 min until Blaze/quota
# unblocks, then run the whole remaining migration: import → verify → storage → R2.
# Idempotent; safe to re-run. Logs to migration-data/overnight.log.
set -uo pipefail
ROOT="C:/eh-cost-center"
FS="$ROOT/migration-data/firestore"
ST="$ROOT/migration-data/storage"
LOG="$ROOT/migration-data/overnight.log"
export FIREBASE_SA_PATH="/c/secret/eh-cost-center-firebase-adminsdk-fbsvc-2323d0af43.json"
export FIREBASE_PROJECT_ID="eh-cost-center"
export R2_PUBLIC_BASE="https://pub-8b567bb009a944559af2ba5cbee244a3.r2.dev"
# NEON_DATABASE_URL is passed in by the launcher's environment.

log(){ echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

MAX=20   # 20 * 30min = up to 10h
for i in $(seq 1 $MAX); do
  node "$ROOT/scripts/migrate/export-firestore.js" >>"$LOG" 2>&1
  if [ -f "$FS/customers.json" ] || [ -f "$FS/products.json" ] || [ -f "$FS/staff.json" ]; then
    log "EXPORT SUCCEEDED on attempt $i"
    break
  fi
  log "attempt $i: Firestore still quota-blocked; sleeping 30m"
  [ "$i" -lt "$MAX" ] && sleep 1800
done

if [ ! -f "$FS/customers.json" ] && [ ! -f "$FS/products.json" ] && [ ! -f "$FS/staff.json" ]; then
  log "GAVE UP after $MAX attempts — Firestore never unblocked. Re-run this script when quota clears."
  exit 1
fi

log "Importing into Neon…"
node "$ROOT/scripts/migrate/import-neon.js" >>"$LOG" 2>&1 && log "import OK" || log "import FAILED (see log)"

log "Verifying parity…"
node "$ROOT/scripts/migrate/verify-parity.js" >>"$LOG" 2>&1 && log "PARITY OK" || log "parity mismatch (see log)"

log "Exporting Storage (independent of Firestore quota)…"
node "$ROOT/scripts/migrate/export-storage.js" >>"$LOG" 2>&1 && log "storage export OK" || log "storage export FAILED"

if [ -f "$ST/manifest.json" ]; then
  log "Uploading media to R2 via wrangler…"
  # Upload every downloaded object, preserving its key.
  while IFS= read -r key; do
    ct=$(node -e "const m=require('$ST/manifest.json');const o=m.find(x=>x.key===process.argv[1]);process.stdout.write(o?o.contentType:'application/octet-stream')" "$key")
    npx --yes wrangler@latest r2 object put "eh-media/$key" --file="$ST/$key" --content-type="$ct" >>"$LOG" 2>&1 \
      && log "  ↑ $key" || log "  ! upload failed: $key"
  done < <(node -e "require('$ST/manifest.json').forEach(o=>console.log(o.key))")
  log "Rewriting media URLs in Neon…"
  node "$ROOT/scripts/migrate/rewrite-media-urls.js" >>"$LOG" 2>&1 && log "URL rewrite OK" || log "URL rewrite FAILED"
fi

log "DONE — data + storage migration complete."
