#!/bin/bash
# Watchdog v4: single-instance (mkdir lock) NS-propagation auto-finish.
# Detect NS flip -> route DNS (idempotent) -> restart tunnel (single instance)
# -> poll HTTPS until 200 (covers recursive-DNS cache lag).
set -u
LOG="D:/PI-web-desktop/ns-watchdog.log"
STATUS="D:/PI-web-desktop/ns-watchdog-status.json"
DOMAIN="tt56677.top"
SUBDOMAIN="mobile"
URL="https://$SUBDOMAIN.$DOMAIN/mobile/"
CLOUDFLARED="D:/PI-web-desktop/resources/cloudflared/cloudflared.exe"
TUNNEL_NAME="pi-mobile"
LOCKDIR="D:/PI-web-desktop/.ns-watchdog.lock"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

# ── Single-instance lock (atomic mkdir; stale-lock recovery via kill -0) ──
acquire_lock() {
  if mkdir "$LOCKDIR" 2>/dev/null; then
    echo $$ > "$LOCKDIR/pid" 2>/dev/null
    return 0
  fi
  local oldpid; oldpid=$(cat "$LOCKDIR/pid" 2>/dev/null || true)
  if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
    return 1  # another live watchdog holds the lock
  fi
  rm -rf "$LOCKDIR" 2>/dev/null           # stale lock from a crashed run
  mkdir "$LOCKDIR" 2>/dev/null || return 1
  echo $$ > "$LOCKDIR/pid" 2>/dev/null
  return 0
}
acquire_lock || { echo "[$(date '+%H:%M:%S')] another watchdog is running; exit" >> "$LOG"; exit 0; }
trap 'rm -rf "$LOCKDIR"' EXIT

echo "" > "$LOG"
log "=== NS Watchdog v4 started (pid $$) ==="

ns_cloudflare() {
  nslookup -type=NS "$DOMAIN" "$1" 2>&1 | grep -qi "cloudflare"
}

# ── Phase 1: wait for NS delegation to flip to cloudflare ──
NS_DETECTED=false
for i in $(seq 1 360); do
  if ns_cloudflare 8.8.8.8 || ns_cloudflare 1.1.1.1 || ns_cloudflare a.nic.top; then
    log "NS propagation detected! (attempt $i)"
    echo "{\"status\":\"ns_detected\",\"attempt\":$i}" > "$STATUS"
    NS_DETECTED=true
    break
  fi
  log "NS not ready (attempt $i/360)"
  echo "{\"status\":\"waiting\",\"attempt\":$i}" > "$STATUS"
  sleep 120
done

if [ "$NS_DETECTED" != true ]; then
  log "ERROR: NS propagation timeout after 360 attempts (~12h); exit without touching tunnel"
  echo "{\"status\":\"ns_timeout\"}" > "$STATUS"
  exit 1
fi

# ── Phase 2: route DNS (idempotent) + single-instance tunnel restart ──
log "Phase 2: route DNS + restart tunnel"
for r in $(seq 1 5); do
  OUT=$("$CLOUDFLARED" tunnel route dns "$TUNNEL_NAME" "$SUBDOMAIN.$DOMAIN" 2>&1)
  echo "$OUT" | tee -a "$LOG"
  if echo "$OUT" | grep -qiE "Added CNAME|already exists"; then
    log "DNS route OK"; break
  fi
  log "route attempt $r failed, retry 30s"; sleep 30
done

# Kill ALL cloudflared instances, then start exactly one (single-instance).
tasklist 2>/dev/null | grep -i cloudflared | awk '{print $2}' | while read pid; do taskkill /F /PID "$pid" 2>/dev/null; done
sleep 3
nohup "$CLOUDFLARED" tunnel run "$TUNNEL_NAME" >> D:/PI-web-desktop/tunnel-run.log 2>&1 &
sleep 15

# ── Phase 3: poll HTTPS until truly 200 ──
log "Phase 3: polling HTTPS $URL"
for j in $(seq 1 40); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$URL" 2>/dev/null || echo "000")
  log "HTTPS check $j: $CODE"
  if [ "$CODE" = "200" ]; then
    log "HTTPS WORKING! Full chain green."
    echo "{\"status\":\"ok\",\"httpCode\":200,\"url\":\"$URL\"}" > "$STATUS"
    exit 0
  fi
  echo "{\"status\":\"https_pending\",\"httpCode\":\"$CODE\",\"check\":$j}" > "$STATUS"
  sleep 60
done

log "HTTPS not 200 after 40 min of polling; tunnel+route configured, manual check advised"
echo "{\"status\":\"https_pending_timeout\"}" > "$STATUS"
