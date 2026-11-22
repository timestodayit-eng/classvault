#!/usr/bin/env bash
# ClassVault one-command installer for a fresh Ubuntu 22.04/24.04 VPS (e.g. Hostinger KVM VPS).
# Usage (as root, from inside the unzipped project folder):
#   bash deploy/install.sh your-domain.com you@email.com
# Re-running it later updates the code and restarts the app; videos, database and settings are kept.
set -euo pipefail
DOMAIN="${1:?Usage: bash deploy/install.sh your-domain.com you@email.com}"
EMAIL="${2:?Give an email for the free SSL certificate}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/classvault/app
DATA=/var/lib/classvault
ENVF=/etc/classvault.env

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }
echo "==> Installing system packages (ffmpeg, nginx, certbot)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates ffmpeg nginx certbot python3-certbot-nginx ufw rsync openssl
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Installing Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Copying app to $APP…"
id classvault >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/classvault --shell /usr/sbin/nologin classvault
mkdir -p "$APP" "$DATA"
rsync -a --delete --exclude node_modules --exclude data --exclude samples --exclude .git "$SRC/" "$APP/"
cd "$APP" && npm ci --omit=dev --no-audit --no-fund
chown -R classvault:classvault /opt/classvault "$DATA"

if [ ! -f "$ENVF" ]; then
  ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)"
  cat > "$ENVF" <<ENV
PORT=3000
DATA_DIR=$DATA
ADMIN_PASSWORD=$ADMIN_PASSWORD
APP_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=1
NODE_ENV=production
ENV
  chmod 600 "$ENVF"
  NEW_PASSWORD=1
fi

echo "==> Creating service…"
cat > /etc/systemd/system/classvault.service <<UNIT
[Unit]
Description=ClassVault video platform
After=network.target

[Service]
EnvironmentFile=$ENVF
WorkingDirectory=$APP
ExecStart=/usr/bin/node --no-warnings server.js
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

echo "==> Configuring nginx for $DOMAIN…"
cat > /etc/nginx/sites-available/classvault <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 5G;           # large video uploads
    proxy_request_buffering off;        # stream uploads straight to the app
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/classvault /etc/nginx/sites-enabled/classvault
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall…"
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null

echo "==> Free SSL certificate (HTTPS)…"
if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  echo "!! SSL failed. Make sure the domain's A record points to this server's IP, then run:"
  echo "   certbot --nginx -d $DOMAIN --redirect"
fi

sleep 2
systemctl is-active --quiet classvault && echo "==> App is running." || { echo "!! App failed to start:"; journalctl -u classvault -n 30 --no-pager; exit 1; }
echo
echo "================ DONE ================"
echo " Student site : https://$DOMAIN"
echo " Admin panel  : https://$DOMAIN/admin"
[ "${NEW_PASSWORD:-}" = 1 ] && echo " Admin password: $(grep ^ADMIN_PASSWORD $ENVF | cut -d= -f2)   (saved in $ENVF)"
echo " Logs         : journalctl -u classvault -f"
echo "======================================"
