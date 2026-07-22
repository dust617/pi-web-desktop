#!/usr/bin/env bash
# tunnel-watchdog.sh — keep the Cloudflare tunnel alive across network drops.
#
# cloudflared already retries on its own, but its reconnect backoff grows to
# ~1 minute. This watchdog detects a dead tunnel (no public HTTPS) and restarts
# cloudflared to reset the backoff, so the tunnel recovers as soon as the
# network/proxy is back. It is single-instance and logs every action.
#
# Boundary: this can only recover from transient network/proxy drops. If the
# proxy node itself blocks argotunnel.com, restarting won't help until a
# different node is chosen.
set -u

ROOT="D:/PI-web-desktop"
CLOUDFLARED="$ROOT/resources/cloudflared/cloudflared.exe"
TUNNEL_NAME="pi-mobile"
PUBLIC_URL="https://mobile.tt56677.top/mobile/"
LOG="$ROOT/tunnel-watchdog.log"
STATUS="$ROOT/tunnel-watchdog-status.json"
LOCKDIR="$ROOT/.tunnel-watchdog.lock"
CHECK_INTERVAL=180     # seconds between health checks (~3 min; less churn than 30s)
FAIL_THRESHOLD=3       # consecutive failures before a restart (~9 min of downtime)
RESTART_COOLDOWN=120   # min seconds between restarts

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# ── single-instance lock ──────────────────────────────────────────────
if mkdir "$LOCKDIR" 2>/dev/null; then
  echo "$$" > "$LOCKDIR/pid"
else
  OLDPID=$(cat "$LOCKDIR/pid" 2>/dev/null || echo "")
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    echo "tunnel-watchdog already running (pid $OLDPID)"; exit 0
  fi
  log "stale lock (pid $OLDPID not alive), taking over"
  rm -rf "$LOCKDIR"; mkdir "$LOCKDIR"; echo "$$" > "$LOCKDIR/pid"
fi
trap 'rm -rf "$LOCKDIR"' EXIT

write_status() { # $1=status $2=detail
  printf '{"status":"%s","detail":"%s","time":"%s"}\n' "$1" "$2" "$(date '+%Y-%m-%dT%H:%M:%S%z')" > "$STATUS"
}

public_ok() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 12 "$PUBLIC_URL" 2>/dev/null)
  [ "$code" = "200" ]
}

restart_tunnel() {
  log "restarting cloudflared to reset reconnect backoff"
  taskkill //F //IM cloudflared.exe >/dev/null 2>&1
  sleep 3
  nohup "$CLOUDFLARED" tunnel run "$TUNNEL_NAME" > "$ROOT/tunnel-run.log" 2>&1 &
  log "cloudflared restarted (pid $!)"
}

log "tunnel-watchdog started (interval=${CHECK_INTERVAL}s, threshold=${FAIL_THRESHOLD})"
FAILS=0
LAST_RESTART=0

while true; do
  if public_ok; then
    if [ "$FAILS" -gt 0 ]; then log "tunnel healthy again after $FAILS failed check(s)"; fi
    FAILS=0
    write_status "ok" "public https 200"
  else
    FAILS=$((FAILS + 1))
    log "public check failed ($FAILS/$FAIL_THRESHOLD)"
    write_status "degraded" "public not 200, fail $FAILS/$FAIL_THRESHOLD"
    NOW=$(date +%s)
    if [ "$FAILS" -ge "$FAIL_THRESHOLD" ] && [ $((NOW - LAST_RESTART)) -ge "$RESTART_COOLDOWN" ]; then
      restart_tunnel
      LAST_RESTART=$NOW
      FAILS=0
      write_status "restarted" "cloudflared restarted after repeated failures"
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
