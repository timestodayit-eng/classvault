#!/usr/bin/env bash
# ClassVault installer for an Ubuntu VPS — safe on a server that already hosts other sites.
#
# Usage (as root, from inside the cloned project folder, e.g. /opt/classvault):
#   bash deploy/install.sh class.example.com you@email.com
#
# What it does NOT touch: other nginx sites (incl. "default"), the system Node.js version,
# other apps' ports, firewall state, or other SSL certificates.
# What it adds: one nginx server block for your domain, one systemd service ("classvault"),
# a private Node 22 runtime if the system one is older, and the app copy in /srv/classvault.
# Re-running it later updates the code and restarts only this app; videos, database and settings are kept.
set -euo pipefail
DOMAIN="${1:?Usage: bash deploy/install.sh your-domain.com you@email.com}"
EMAIL="${2:?Give an email for the free SSL certificate}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/srv/classvault          # app code (copied from the clone)
DATA=/var/lib/classvault     # database + videos (kept across updates)
ENVF=/etc/classvault.env     # settings + admin password
NODE_DIR=/opt/classvault-node
SITE=/etc/nginx/sites-available/classvault
log() { echo -e "\n==> $*"; }
die() { echo -e "\n!! $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo -i)"
[ "$SRC" != "$APP" ] || die "Clone the repo somewhere other than $APP (e.g. /opt/classvault)"

# ---------- packages (only what's missing; nothing is upgraded or removed) ----------
log "Checking system packages…"
export DEBIAN_FRONTEND=noninteractive
NEED=()
command -v ffmpeg  >/dev/null || NEED+=(ffmpeg)
command -v rsync   >/dev/null || NEED+=(rsync)
command -v curl    >/dev/null || NEED+=(curl ca-certificates)
command -v openssl >/dev/null || NEED+=(openssl)
command -v xz      >/dev/null || NEED+=(xz-utils)
if ! command -v nginx >/dev/null; then
  if ss -ltnH '( sport = :80 )' | grep -q .; then
    die "Port 80 is used by something that isn't nginx (maybe Docker/Apache/Caddy). Tell Claude what runs on this server; the installer stopped without changing anything."
  fi
  NEED+=(nginx)
fi
command -v certbot >/dev/null || NEED+=(certbot python3-certbot-nginx)
if [ ${#NEED[@]} -gt 0 ]; then
  echo "Installing: ${NEED[*]}"
  apt-get update -y && apt-get install -y --no-upgrade "${NEED[@]}"
else
  echo "All present."
fi
# certbot's nginx plugin, if certbot exists but plugin doesn't
certbot plugins 2>/dev/null | grep -q nginx || apt-get install -y --no-upgrade python3-certbot-nginx || true

# ---------- Node.js 22 (private copy; the system Node used by other apps is left alone) ----------
NODE=""
if command -v node >/dev/null && node -e "require('node:sqlite')" >/dev/null 2>&1; then
  NODE="$(command -v node)"; NPM="$(command -v npm)"
else
  log "Installing a private Node.js 22 in $NODE_DIR (system Node is not changed)…"
  ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64;; aarch64) ARCH=arm64;; *) die "Unsupported CPU $ARCH";; esac
  VER=v22.20.0
  if [ ! -x "$NODE_DIR/bin/node" ] || ! "$NODE_DIR/bin/node" -e "require('node:sqlite')" >/dev/null 2>&1; then
    rm -rf "$NODE_DIR"
    mkdir -p "$NODE_DIR"
    curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-linux-$ARCH.tar.xz" | tar -xJ -C "$NODE_DIR" --strip-components=1
  fi
  NODE="$NODE_DIR/bin/node"; NPM="$NODE_DIR/bin/npm"
fi
echo "Using Node $("$NODE" -v) at $NODE"

# ---------- app user + code ----------
log "Copying app to $APP…"
id classvault >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin classvault
mkdir -p "$APP" "$DATA"
rsync -a --delete --exclude node_modules --exclude data --exclude samples --exclude .git "$SRC/" "$APP/"
cd "$APP" && PATH="$(dirname "$NODE"):$PATH" "$NPM" ci --omit=dev --no-audit --no-fund
chown -R classvault:classvault "$APP" "$DATA"

# ---------- settings (port is chosen once, from ports nobody else uses) ----------
if [ ! -f "$ENVF" ]; then
  PORT=""
  for p in $(seq 3107 3199); do
    ss -ltnH "( sport = :$p )" | grep -q . || { PORT=$p; break; }
  done
  [ -n "$PORT" ] || die "No free port found between 3107 and 3199"
  ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)"
  cat > "$ENVF" <<ENV
PORT=$PORT
HOST=127.0.0.1
DATA_DIR=$DATA
ADMIN_PASSWORD=$ADMIN_PASSWORD
APP_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=1
NODE_ENV=production
ENV
  chmod 600 "$ENVF"
  NEW_PASSWORD=1
fi
PORT="$(grep ^PORT= "$ENVF" | cut -d= -f2)"
echo "App port: $PORT (local only, reachable just through nginx)"

# ---------- systemd service (only "classvault" is created/restarted) ----------
log "Creating service…"
cat > /etc/systemd/system/classvault.service <<UNIT
[Unit]
Description=ClassVault video platform
After=network.target

[Service]
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=$NODE --no-warnings server.js
User=classvault
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable classvault >/dev/null
systemctl restart classvault

# ---------- nginx: add ONE server block for this domain ----------
log "Adding nginx site for $DOMAIN (other sites are not touched)…"
if grep -rlsE "server_name[^;]*\b${DOMAIN//./\\.}\b" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | grep -v "/classvault$" | grep -q .; then
  die "Another nginx config already uses $DOMAIN. Remove it first or use a different subdomain."
fi
NEW_SITE=0; [ -f "$SITE" ] || NEW_SITE=1
if [ "$NEW_SITE" = 1 ]; then
  cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    client_max_body_size 5G;           # large video uploads
    proxy_request_buffering off;        # stream uploads straight to the app
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
    }
}
NGINX
else
  # keep certbot's SSL lines; only refresh the upstream port
  sed -i -E "s#proxy_pass http://127\.0\.0\.1:[0-9]+;#proxy_pass http://127.0.0.1:$PORT;#" "$SITE"
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/classvault
if ! nginx -t 2>/tmp/classvault-nginx-test; then
  cat /tmp/classvault-nginx-test
  [ "$NEW_SITE" = 1 ] && { rm -f /etc/nginx/sites-enabled/classvault "$SITE"; echo "Removed the new config again; other sites are unaffected."; }
  die "nginx config test failed (see above). Nothing was reloaded."
fi
systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx

# ---------- firewall: only open web ports if ufw is already ON ----------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  echo "ufw active: made sure 80/443 are open (nothing else changed)."
fi

# ---------- SSL for this domain only ----------
log "Free SSL certificate for $DOMAIN…"
if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring; then
  echo "!! SSL failed. Make sure $DOMAIN points to this server's IP, then run:"
  echo "   certbot --nginx -d $DOMAIN --redirect"
fi

sleep 2
systemctl is-active --quiet classvault || { journalctl -u classvault -n 30 --no-pager; die "App failed to start (log above)."; }
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && echo "App answers on port $PORT."
echo
echo "================ DONE ================"
echo " Student site : https://$DOMAIN"
echo " Admin panel  : https://$DOMAIN/admin"
[ "${NEW_PASSWORD:-}" = 1 ] && echo " Admin password: $(grep ^ADMIN_PASSWORD "$ENVF" | cut -d= -f2)   (saved in $ENVF)"
echo " Logs         : journalctl -u classvault -f"
echo "======================================"
