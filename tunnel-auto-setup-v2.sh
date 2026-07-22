#!/bin/bash
# Auto-setup Cloudflare Tunnel v2
# Waits for NS propagation FIRST, then runs login + create + route + run.
set -euo pipefail

CLOUDFLARED="D:/PI-web-desktop/resources/cloudflared/cloudflared.exe"
DOMAIN="tt56677.top"
SUBDOMAIN="mobile"
TUNNEL_NAME="pi-mobile"
LOG="D:/PI-web-desktop/tunnel-v2.log"
STATUS="D:/PI-web-desktop/tunnel-v2-status.json"
CF_DIR="$HOME/.cloudflared"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }
status() { echo "$1" > "$STATUS"; log "STATUS: $1"; }

echo "" > "$LOG"
log "=== Tunnel auto-setup v2 started ==="

# ── Phase 1: Wait for NS propagation ──
log "Phase 1: Waiting for NS propagation..."
status '{"phase":"ns_wait","status":"polling"}'

NS_OK=false
for i in $(seq 1 180); do  # up to 6 hours (120s * 180)
  NS_RESULT=$(nslookup -type=NS "$DOMAIN" 8.8.8.8 2>&1 || true)
  if echo "$NS_RESULT" | grep -qi "cloudflare"; then
    NS_OK=true
    log "NS propagation confirmed! (attempt $i)"
    break
  fi
  # Also try 1.1.1.1
  NS_RESULT2=$(nslookup -type=NS "$DOMAIN" 1.1.1.1 2>&1 || true)
  if echo "$NS_RESULT2" | grep -qi "cloudflare"; then
    NS_OK=true
    log "NS propagation confirmed via 1.1.1.1! (attempt $i)"
    break
  fi
  log "NS not ready yet (attempt $i/180), retry in 120s..."
  sleep 120
done

if [ "$NS_OK" = false ]; then
  log "ERROR: NS propagation timeout after 6 hours"
  status '{"phase":"ns_wait","status":"TIMEOUT"}'
  exit 1
fi

# Wait extra 60s for Cloudflare to fully activate the zone
log "NS propagated. Waiting 60s for Cloudflare zone activation..."
sleep 60
status '{"phase":"ns_wait","status":"done"}'

# ── Phase 2: Tunnel login ──
CERT="$CF_DIR/cert.pem"
if [ -f "$CERT" ]; then
  log "cert.pem already exists, skipping login"
else
  log "Phase 2: Running 'cloudflared tunnel login'"
  log ">>> A browser tab will open. Select tt56677.top and click Authorize <<<"
  status '{"phase":"login","status":"waiting_browser_auth"}'

  "$CLOUDFLARED" tunnel login 2>>"$LOG" || true

  # Wait for cert.pem up to 15 min
  for i in $(seq 1 180); do
    [ -f "$CERT" ] && break
    sleep 5
  done

  if [ ! -f "$CERT" ]; then
    log "ERROR: cert.pem not found after 15 min"
    status '{"phase":"login","status":"FAILED_no_cert"}'
    exit 1
  fi
  log "cert.pem obtained!"
fi
status '{"phase":"login","status":"done"}'

# ── Phase 3: Create tunnel ──
log "Phase 3: Creating tunnel..."
"$CLOUDFLARED" tunnel delete "$TUNNEL_NAME" 2>/dev/null || true
sleep 2

"$CLOUDFLARED" tunnel create "$TUNNEL_NAME" 2>>"$LOG"

CRED_FILE=$(ls -t "$CF_DIR"/*.json 2>/dev/null | head -1)
if [ -z "$CRED_FILE" ]; then
  log "ERROR: no credentials file found"
  status '{"phase":"create","status":"FAILED_no_cred"}'
  exit 1
fi
TUNNEL_ID=$(basename "$CRED_FILE" .json)
log "Tunnel created: ID=$TUNNEL_ID"
status "{\"phase\":\"create\",\"status\":\"done\",\"tunnelId\":\"$TUNNEL_ID\"}"

# ── Phase 4: Route DNS ──
log "Phase 4: Routing DNS..."
"$CLOUDFLARED" tunnel route dns "$TUNNEL_NAME" "$SUBDOMAIN.$DOMAIN" 2>>"$LOG"
status '{"phase":"dns","status":"done"}'

# ── Phase 5: Write config ──
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

# ── Phase 6: Start tunnel ──
log "Phase 6: Starting tunnel..."
tasklist 2>/dev/null | grep -i cloudflared | awk '{print $2}' | xargs -r taskkill /F /PID 2>/dev/null || true
sleep 2

nohup "$CLOUDFLARED" tunnel run "$TUNNEL_NAME" >>"$LOG" 2>&1 &
TUNNEL_PID=$!
sleep 10

if kill -0 "$TUNNEL_PID" 2>/dev/null; then
  log "Tunnel RUNNING! PID=$TUNNEL_PID"
  log "=== PWA URL: https://$SUBDOMAIN.$DOMAIN/mobile/ ==="
  status "{\"phase\":\"running\",\"status\":\"ok\",\"pid\":$TUNNEL_PID,\"url\":\"https://$SUBDOMAIN.$DOMAIN/mobile/\"}"
else
  log "ERROR: tunnel process died"
  status '{"phase":"running","status":"FAILED"}'
  exit 1
fi

log "=== Setup complete ==="
