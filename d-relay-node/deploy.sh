#!/usr/bin/env bash
# Запуск: bash deploy.sh

set -euo pipefail

VM_HOST="185.41.162.49"
VM_USER="root"
APP_DIR="/opt/d-relay-node"
SERVICE="d-relay"

SSH_CMD="ssh -o StrictHostKeyChecking=no ${VM_USER}@${VM_HOST}"

echo "==> Deploying d-relay-node to ${VM_USER}@${VM_HOST}…"

# Копируем исходники на VM
${SSH_CMD} "mkdir -p ${APP_DIR}"

# Исключаем лишние файлы
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='*.sqlite' \
  --exclude='*.sqlite-shm' \
  --exclude='*.sqlite-wal' \
  --exclude='sqlite3.exe' \
  --exclude='.git' \
  "$(dirname "$0")/" \
  "${VM_USER}@${VM_HOST}:${APP_DIR}/"

# Установка Node и зависимостей на VM
${SSH_CMD} bash <<'REMOTE'
set -euo pipefail

if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  echo "[node] Installing Node.js 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "[node] $(node --version)"

cd /opt/d-relay-node

npm install --omit=dev --no-fund --no-audit 2>&1 | tail -5
echo "[npm] dependencies installed"
REMOTE

# Создание systemd-сервиса
${SSH_CMD} bash <<REMOTE
set -euo pipefail

export APP_DIR="${APP_DIR}"
export SERVICE="${SERVICE}"

cat > /etc/systemd/system/\${SERVICE}.service <<'UNIT'
[Unit]
Description=DM Relay Node
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/index.js
Restart=always
RestartSec=5
Environment=PORT=8081
Environment=TTL_DAYS=14
Environment=POW_DIFFICULTY=16
Environment=RELAY_PUBLIC_IP=185.41.162.49
MemoryMax=256M
MemoryAccounting=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable \${SERVICE}
systemctl restart \${SERVICE}

sleep 2
systemctl is-active \${SERVICE} && echo "[systemd] \${SERVICE} is running" || echo "[systemd] ERROR: \${SERVICE} failed"
REMOTE

# Настройка firewall (UFW)
${SSH_CMD} bash <<'REMOTE'
set -euo pipefail

if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   comment 'SSH'    2>/dev/null || true
  ufw allow 8081//tcp comment 'D-Relay WS' 2>/dev/null || true
  ufw status | grep -q "Status: active" || echo "y" | ufw enable
  ufw status | grep -E "8081|22"
else
  echo "[firewall] UFW not found, skipping"
fi
REMOTE

echo ""
echo "Deploy complete!"
echo "Relay WS: ws://${VM_HOST}:8081"
echo "Logs: ${SSH_CMD} journalctl -fu ${SERVICE}"
