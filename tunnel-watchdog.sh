#!/usr/bin/env bash
# tunnel-watchdog.sh — supervise the complete mobile path without killing
# unrelated cloudflared connectors.
#
# Recovery layers:
#   1. local pi-web (62809) must be healthy; this script never restarts Electron.
#   2. local MobileBridge (62810) is restarted only when it is the DEV-only
#      standalone-bff.mjs process (or when the port is free).
#   3. cloudflared is restarted only after repeated public API-health failures,
#      and only processes whose command line is `tunnel run pi-mobile` are killed.
#
# Boundary: direct Cloudflare edge TLS is interfered with on this host. If the
# proxy/router path blocks argotunnel.com, restart cannot restore service until
# a working proxy route/node is available.
set -u

ROOT="D:/PI-web-desktop"
CLOUDFLARED="$ROOT/resources/cloudflared/cloudflared.exe"
TUNNEL_NAME="pi-mobile"
PUBLIC_HEALTH="https://mobile.tt56677.top/mobile/api/v1/health"
LOCAL_BFF_HEALTH="http://127.0.0.1:62810/mobile/api/v1/health"
PIWEB_HEALTH="http://127.0.0.1:62809/api/home"
LOG="$ROOT/tunnel-watchdog.log"
STATUS="$ROOT/tunnel-watchdog-status.json"
LOCKDIR="$ROOT/.tunnel-watchdog.lock"
TUNNEL_PID_FILE="$ROOT/.pi-mobile-cloudflared.pid"
BFF_PID_FILE="$ROOT/.standalone-bff.pid"
CHECK_INTERVAL=180     # check every ~3 minutes (user preference)
FAIL_THRESHOLD=2       # restart tunnel after ~6 minutes; ignore one transient failure
RESTART_COOLDOWN=120   # minimum seconds between tunnel restarts

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
write_status() {
  printf '{"status":"%s","detail":"%s","time":"%s"}\n' "$1" "$2" "$(date '+%Y-%m-%dT%H:%M:%S%z')" > "$STATUS"
}

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

json_health_ok() {
  curl -fsS --max-time 12 "$1" 2>/dev/null | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
}
local_bff_ok() { json_health_ok "$LOCAL_BFF_HEALTH"; }
public_ok() { json_health_ok "$PUBLIC_HEALTH"; }
piweb_ok() { curl -fsS --max-time 8 "$PIWEB_HEALTH" >/dev/null 2>&1; }

port_pid() {
  netstat -ano 2>/dev/null | awk -v p=":$1" '$2 ~ p && $4 == "LISTENING" { print $5; exit }'
}
process_command_line() {
  powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"ProcessId=$1\").CommandLine" 2>/dev/null | tr -d '\r'
}
matching_tunnel_pids() {
  powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.Name -eq 'cloudflared.exe' -and \$_.CommandLine -match 'tunnel\\s+run\\s+$TUNNEL_NAME(?:\\s|$)' } | ForEach-Object { \$_.ProcessId }" 2>/dev/null | tr -d '\r'
}

recover_standalone_bff() {
  if ! piweb_ok; then
    log "pi-web 62809 is unhealthy; refusing to start/restart BFF (Electron owner action required)"
    write_status "piweb_down" "local pi-web health failed; Electron not restarted by watchdog"
    return 1
  fi

  local pid cmd
  pid=$(port_pid 62810 || true)
  if [ -n "$pid" ]; then
    cmd=$(process_command_line "$pid")
    if echo "$cmd" | grep -q 'standalone-bff\.mjs'; then
      log "standalone BFF unhealthy; stopping exact pid $pid"
      taskkill //F //PID "$pid" >/dev/null 2>&1 || true
      sleep 2
    else
      log "port 62810 is owned by a non-standalone process (pid $pid); refusing collateral kill"
      write_status "bff_unhealthy" "62810 unhealthy and owned by integrated/unknown process"
      return 1
    fi
  fi

  log "starting DEV-only standalone BFF"
  (cd "$ROOT" && nohup node standalone-bff.mjs > bff-standalone.log 2>&1 & echo $! > "$BFF_PID_FILE")
  sleep 3
  if local_bff_ok; then
    log "standalone BFF recovered"
    write_status "bff_recovered" "local BFF restarted and healthy"
    return 0
  fi
  log "standalone BFF restart did not become healthy"
  write_status "bff_restart_failed" "standalone BFF failed health check"
  return 1
}

restart_tunnel() {
  local pid found=0
  log "restarting only cloudflared connector(s) matching: tunnel run $TUNNEL_NAME"
  for pid in $(matching_tunnel_pids); do
    [ -n "$pid" ] || continue
    found=1
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  done
  [ "$found" -eq 1 ] && sleep 3

  nohup "$CLOUDFLARED" tunnel run "$TUNNEL_NAME" > "$ROOT/tunnel-run.log" 2>&1 &
  pid=$!
  echo "$pid" > "$TUNNEL_PID_FILE"
  log "pi-mobile cloudflared restarted (pid $pid)"
}

log "tunnel-watchdog started (interval=${CHECK_INTERVAL}s, threshold=${FAIL_THRESHOLD}, layered-health=true)"
FAILS=0
LAST_RESTART=0

while true; do
  if ! local_bff_ok; then
    FAILS=0
    log "local BFF health failed; attempting local-layer recovery before touching tunnel"
    recover_standalone_bff || true
  elif public_ok; then
    if [ "$FAILS" -gt 0 ]; then log "public mobile API healthy again after $FAILS failed check(s)"; fi
    FAILS=0
    write_status "ok" "local and public mobile API health true"
  else
    FAILS=$((FAILS + 1))
    log "public API health failed ($FAILS/$FAIL_THRESHOLD), local BFF remains healthy"
    write_status "degraded" "public API unhealthy, local BFF healthy, fail $FAILS/$FAIL_THRESHOLD"
    NOW=$(date +%s)
    if [ "$FAILS" -ge "$FAIL_THRESHOLD" ] && [ $((NOW - LAST_RESTART)) -ge "$RESTART_COOLDOWN" ]; then
      restart_tunnel
      LAST_RESTART=$NOW
      FAILS=0
      write_status "restarted" "pi-mobile cloudflared restarted after repeated public failures"
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
