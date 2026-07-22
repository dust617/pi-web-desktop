#!/bin/bash
# Auto-setup Cloudflare Tunnel for Pi Web Mobile
# Runs in background. Only user action needed: authorize in browser when prompted.

set -euo pipefail

CLOUDFLARED="D:/PI-web-desktop/resources/cloudflared/cloudflared.exe"
DOMAIN="tt56677.top"
SUBDOMAIN="mobile"
TUNNEL_NAME="pi-mobile"
LOG="D:/PI-web-desktop/tunnel-setup.log"
STATUS="D:/PI-web-desktop/tunnel-status.json"
CF_DIR="$HOME/.cloudflared"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }
status() { echo "$1" > "$STATUS"; log "STATUS: $1"; }

echo "" > "$LOG"
log "=== Tunnel auto-setup started ==="

# ── Step 1: tunnel login (opens browser for OAuth) ──
CERT="$CF_DIR/cert.pem"
if [ -f "$CERT" ]; then
  log "cert.pem already exists, skipping login"
else
  log "Running 'cloudflared tunnel login' — a browser tab will open."
  log ">>> PLEASE: select tt56677.top and click Authorize <<<"
  status '{"step":"login","status":"waiting_browser_auth"}'

  # Run login; it opens browser and exits after auth
  "$CLOUDFLARED" tunnel login 2>>"$LOG" || true

  # Wait for cert.pem up to 10 min
  for i in $(seq 1 120); do
    [ -f "$CERT" ] && break
    sleep 5
  done

  if [ ! -f "$CERT" ]; then
    log "ERROR: cert.pem not found after 10 min. Did you authorize in browser?"
    status '{"step":"login","status":"FAILED_no_cert"}'
    exit 1
  fi
  log "cert.pem obtained!"
fi
status '{"step":"login","status":"done"}'

# ── Step 2: Create tunnel ──
# Delete old tunnel if exists (ignore errors)
"$CLOUDFLARED" tunnel delete "$TUNNEL_NAME" 2>/dev/null || true
sleep 2

log "Creating tunnel: $TUNNEL_NAME"
"$CLOUDFLARED" tunnel create "$TUNNEL_NAME" 2>>"$LOG"

# Find the credentials file (named <tunnel-id>.json)
CRED_FILE=$(ls -t "$CF_DIR"/*.json 2>/dev/null | head -1)
if [ -z "$CRED_FILE" ]; then
  log "ERROR: no credentials file found"
  status '{"step":"create","status":"FAILED_no_cred"}'
  exit 1
fi
TUNNEL_ID=$(basename "$CRED_FILE" .json)
log "Tunnel created: ID=$TUNNEL_ID"
status "{\"step\":\"create\",\"status\":\"done\",\"tunnelId\":\"$TUNNEL_ID\"}"

# ── Step 3: Route DNS ──
log "Routing DNS: $SUBDOMAIN.$DOMAIN → tunnel"
"$CLOUDFLARED" tunnel route dns "$TUNNEL_NAME" "$SUBDOMAIN.$DOMAIN" 2>>"$LOG" || {
  log "DNS route failed (zone may still be pending). Will retry after NS propagation."
}
status '{"step":"dns","status":"done_or_pending"}'

# ── Step 4: Write config ──
CONFIG="$CF_DIR/config.yml"
cat > "$CONFIG" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CRED_FILE

ingress:
  - hostname: $SUBDOMAIN.$DOMAIN
    service: http://127.0.0.1:62810
    originRequest:
      noTLSVerify: true
  - service: http_status:404
EOF
log "Config written: $CONFIG"

# ── Step 5: Wait for NS propagation ──
log "Checking NS propagation..."
status '{"step":"ns_wait","status":"polling"}'

NS_OK=false
for i in $(seq 1 90); do  # up to 3 hours (120s * 90)
  NS_RESULT=$(nslookup -type=NS "$DOMAIN" 8.8.8.8 2>&1 || true)
  if echo "$NS_RESULT" | grep -qi "cloudflare"; then
    NS_OK=true
    log "NS propagation confirmed!"
    break
  fi
  log "NS not ready yet, retry in 120s... (attempt $i/90)"
  sleep 120
done

if [ "$NS_OK" = false ]; then
  log "NS propagation timeout. Tunnel config is ready; start manually when NS propagates."
  status '{"step":"ns_wait","status":"timeout","tunnelReady":true}'
  exit 0
fi

# Retry DNS route if it failed earlier
"$CLOUDFLARED" tunnel route dns "$TUNNEL_NAME" "$SUBDOMAIN.$DOMAIN" 2>>"$LOG" || true

# ── Step 6: Start tunnel ──
log "Starting tunnel..."
status '{"step":"starting","status":"launching"}'

# Kill any existing cloudflared tunnel process
tasklist 2>/dev/null | grep -i cloudflared | awk '{print $2}' | xargs -r taskkill /F /PID 2>/dev/null || true
sleep 2

nohup "$CLOUDFLARED" tunnel run "$TUNNEL_NAME" >>"$LOG" 2>&1 &
TUNNEL_PID=$!
sleep 8

if kill -0 "$TUNNEL_PID" 2>/dev/null; then
  log "Tunnel RUNNING! PID=$TUNNEL_PID"
  log "PWA URL: https://$SUBDOMAIN.$DOMAIN/mobile/"
  status "{\"step\":\"running\",\"status\":\"ok\",\"pid\":$TUNNEL_PID,\"url\":\"https://$SUBDOMAIN.$DOMAIN/mobile/\"}"
else
  log "ERROR: tunnel process died"
  status '{"step":"running","status":"FAILED"}'
  exit 1
fi

log "=== Setup complete ==="
