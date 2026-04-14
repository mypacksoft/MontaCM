#!/usr/bin/env bash
# =============================================================================
# YB Manager - Ubuntu 24.04 Management Machine Setup Script
# =============================================================================
# Run once on a fresh Ubuntu Server 24.04 installation as root or with sudo.
#
# Usage:
#   sudo bash setup-management.sh
#   sudo bash setup-management.sh --offline    # skip apt/pip downloads
#   sudo bash setup-management.sh --uninstall  # remove everything
#
# What this script does:
#   1. Installs system packages (PostgreSQL 16, Nginx, Python3, Ansible, Node.js)
#   2. Downloads and installs PostgREST binary
#   3. Creates PostgreSQL database, roles, and runs schema migration
#   4. Builds the React web app and deploys to /var/www/yb-manager
#   5. Configures PostgREST and Nginx
#   6. Sets up the Python automation daemon as a systemd service
#   7. Configures firewall (ufw)
#   8. Prints access credentials
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

OFFLINE=false
UNINSTALL=false

for arg in "$@"; do
    case $arg in
        --offline)   OFFLINE=true ;;
        --uninstall) UNINSTALL=true ;;
    esac
done

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DB_NAME="yb_manager"
DB_USER="yb_manager_role"
DB_PASS=$(openssl rand -base64 20 | tr -d '/+=')
POSTGREST_DB_PASS=$(openssl rand -base64 20 | tr -d '/+=')
JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=\n' | head -c 64)

INSTALL_DIR="/opt/yb-manager"
WEB_ROOT="/var/www/yb-manager"
ANSIBLE_DIR="$INSTALL_DIR/ansible"
KEYS_DIR="$INSTALL_DIR/keys"
DAEMON_DIR="$INSTALL_DIR/daemon"

POSTGREST_VERSION="12.2.0"
POSTGREST_BINARY_URL="https://github.com/PostgREST/postgrest/releases/download/v${POSTGREST_VERSION}/postgrest-v${POSTGREST_VERSION}-linux-static-x64.tar.xz"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}==> $1${NC}"; }
ok()    { echo -e "    ${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "    ${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "    ${RED}[ERROR]${NC} $1"; exit 1; }

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

if $UNINSTALL; then
    step "Uninstalling YB Manager"
    systemctl stop yb-manager-daemon postgrest nginx 2>/dev/null || true
    systemctl disable yb-manager-daemon postgrest 2>/dev/null || true
    rm -f /etc/systemd/system/yb-manager-daemon.service
    rm -f /etc/systemd/system/postgrest.service
    rm -f /etc/nginx/sites-enabled/yb-manager
    rm -f /etc/nginx/sites-available/yb-manager
    rm -f /etc/postgrest.conf
    rm -f /usr/local/bin/postgrest
    rm -rf "$INSTALL_DIR"
    rm -rf "$WEB_ROOT"
    systemctl daemon-reload
    nginx -s reload 2>/dev/null || true
    echo -e "${GREEN}Uninstall complete. PostgreSQL database and user preserved.${NC}"
    echo "To drop the database: sudo -u postgres psql -c \"DROP DATABASE $DB_NAME;\""
    exit 0
fi

# ---------------------------------------------------------------------------
# Root check
# ---------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root. Use: sudo bash setup-management.sh"
fi

step "YB Manager Setup - Ubuntu 24.04"
echo "  Install dir : $INSTALL_DIR"
echo "  Web root    : $WEB_ROOT"
echo "  Ansible dir : $ANSIBLE_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1. System packages
# ---------------------------------------------------------------------------

step "Installing system packages"

if ! $OFFLINE; then
    apt-get update -qq

    apt-get install -y \
        postgresql-16 \
        nginx \
        python3-pip \
        python3-venv \
        python3-dev \
        ansible \
        genisoimage \
        xorriso \
        curl \
        wget \
        jq \
        openssl \
        openssh-client \
        ufw \
        build-essential \
        libpq-dev \
        > /dev/null
    ok "System packages installed"

    step "Installing Node.js 20"
    if ! command -v node &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y nodejs > /dev/null
    fi
    ok "Node.js $(node --version) installed"
else
    ok "Skipping package download (--offline mode)"
fi

# ---------------------------------------------------------------------------
# 2. PostgREST
# ---------------------------------------------------------------------------

step "Installing PostgREST"

if ! command -v postgrest &>/dev/null; then
    if ! $OFFLINE; then
        cd /tmp
        wget -q "$POSTGREST_BINARY_URL" -O postgrest.tar.xz
        tar xf postgrest.tar.xz
        mv postgrest /usr/local/bin/postgrest
        chmod +x /usr/local/bin/postgrest
        rm postgrest.tar.xz
        ok "PostgREST $(postgrest --version 2>&1 | head -1) installed"
    else
        OFFLINE_POSTGREST="$SCRIPT_DIR/offline/postgrest"
        if [[ -f "$OFFLINE_POSTGREST" ]]; then
            cp "$OFFLINE_POSTGREST" /usr/local/bin/postgrest
            chmod +x /usr/local/bin/postgrest
            ok "PostgREST installed from offline bundle"
        else
            error "PostgREST binary not found. In --offline mode, place the postgrest binary at: $OFFLINE_POSTGREST"
        fi
    fi
else
    ok "PostgREST already installed"
fi

# ---------------------------------------------------------------------------
# 3. Create directories
# ---------------------------------------------------------------------------

step "Creating install directories"

mkdir -p "$INSTALL_DIR" "$DAEMON_DIR" "$ANSIBLE_DIR" "$KEYS_DIR" "$WEB_ROOT"
mkdir -p "$ANSIBLE_DIR/playbooks" "$ANSIBLE_DIR/templates" "$ANSIBLE_DIR/inventory"

if ! id -u yb-manager &>/dev/null; then
    useradd -r -s /bin/false -d "$INSTALL_DIR" yb-manager
fi

chown -R yb-manager:yb-manager "$INSTALL_DIR"
ok "Directories created"

# ---------------------------------------------------------------------------
# 4. PostgreSQL setup
# ---------------------------------------------------------------------------

step "Configuring PostgreSQL"

systemctl enable --now postgresql > /dev/null

if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';"
else
    sudo -u postgres psql -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';"
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

if sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='authenticator'" | grep -q 1; then
    sudo -u postgres psql -c "ALTER ROLE authenticator WITH PASSWORD '$POSTGREST_DB_PASS';"
else
    sudo -u postgres psql -c "CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '$POSTGREST_DB_PASS';"
fi

ok "PostgreSQL roles and database created"

step "Running schema migrations"
sudo -u postgres psql -d "$DB_NAME" -f "$SCRIPT_DIR/migrations/001_schema.sql" > /dev/null
ok "001_schema.sql applied"

for mig_file in "$SCRIPT_DIR"/migrations/[0-9][0-9][0-9]_*.sql; do
    [[ "$mig_file" == */001_schema.sql ]] && continue
    [[ -f "$mig_file" ]] || continue
    mig_name=$(basename "$mig_file")
    sudo -u postgres psql -d "$DB_NAME" -f "$mig_file" > /dev/null
    ok "$mig_name applied"
done

step "Updating PostgREST authenticator password in schema"
sudo -u postgres psql -d "$DB_NAME" -c \
    "ALTER ROLE authenticator WITH PASSWORD '$POSTGREST_DB_PASS';" > /dev/null
ok "Authenticator password set"

# ---------------------------------------------------------------------------
# 5. PostgREST config
# ---------------------------------------------------------------------------

step "Configuring PostgREST"

cat > /etc/postgrest.conf <<EOF
db-uri = "postgresql://authenticator:${POSTGREST_DB_PASS}@localhost:5432/${DB_NAME}"
db-schema = "public"
db-anon-role = "anon"
db-pool = 10
db-pool-acquisition-timeout = 10

server-host = "127.0.0.1"
server-port = 3000

jwt-secret = "${JWT_SECRET}"
jwt-secret-is-base64 = false

log-level = "warn"
EOF

cp "$SCRIPT_DIR/config/postgrest.service" /etc/systemd/system/postgrest.service
systemctl daemon-reload
systemctl enable --now postgrest
sleep 2
systemctl is-active --quiet postgrest && ok "PostgREST running" || warn "PostgREST may have failed to start, check: journalctl -u postgrest"

# ---------------------------------------------------------------------------
# 6. Build React web app
# ---------------------------------------------------------------------------

step "Building React web app"

WEB_SRC_DIR="$REPO_DIR"
APP_ENV_FILE="$WEB_SRC_DIR/.env.production"

cat > "$APP_ENV_FILE" <<EOF
VITE_API_URL=/api
EOF

cd "$WEB_SRC_DIR"

if ! $OFFLINE; then
    npm install --silent
fi

npm run build

cp -r "$WEB_SRC_DIR/dist/." "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"
ok "React app built and deployed to $WEB_ROOT"

# ---------------------------------------------------------------------------
# 7. Nginx
# ---------------------------------------------------------------------------

step "Configuring Nginx"

cp "$SCRIPT_DIR/config/nginx.conf" /etc/nginx/sites-available/yb-manager
ln -sf /etc/nginx/sites-available/yb-manager /etc/nginx/sites-enabled/yb-manager
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl enable --now nginx
nginx -s reload
ok "Nginx configured and reloaded"

# ---------------------------------------------------------------------------
# 8. Python daemon
# ---------------------------------------------------------------------------

step "Setting up Python automation daemon"

python3 -m venv "$DAEMON_DIR/venv" > /dev/null

if ! $OFFLINE; then
    "$DAEMON_DIR/venv/bin/pip" install -q -r "$SCRIPT_DIR/daemon/requirements.txt"
else
    WHEELS_DIR="$SCRIPT_DIR/offline/wheels"
    if [[ -d "$WHEELS_DIR" ]]; then
        "$DAEMON_DIR/venv/bin/pip" install -q --no-index --find-links "$WHEELS_DIR" \
            psycopg2-binary paramiko requests
    else
        error "In --offline mode, place pip wheel files at: $WHEELS_DIR"
    fi
fi

cp "$SCRIPT_DIR/daemon/daemon.py" "$DAEMON_DIR/daemon.py"

cat > "$DAEMON_DIR/.env" <<EOF
YB_DB_DSN=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
YB_LOG_LEVEL=INFO
YB_ANSIBLE_DIR=${ANSIBLE_DIR}
EOF

chmod 600 "$DAEMON_DIR/.env"
chown -R yb-manager:yb-manager "$DAEMON_DIR"

cp "$SCRIPT_DIR/config/yb-manager.service" /etc/systemd/system/yb-manager-daemon.service
systemctl daemon-reload
systemctl enable --now yb-manager-daemon
sleep 2
systemctl is-active --quiet yb-manager-daemon && ok "Automation daemon running" || warn "Daemon may not be running, check: journalctl -u yb-manager-daemon"

# ---------------------------------------------------------------------------
# 9. Copy Ansible playbooks
# ---------------------------------------------------------------------------

step "Installing Ansible playbooks"
cp -r "$REPO_DIR/ansible/playbooks/." "$ANSIBLE_DIR/playbooks/"
cp -r "$REPO_DIR/ansible/templates/." "$ANSIBLE_DIR/templates/"
chown -R yb-manager:yb-manager "$ANSIBLE_DIR"
ok "Ansible playbooks installed"

# ---------------------------------------------------------------------------
# 10. Generate SSH keypair for Ansible
# ---------------------------------------------------------------------------

step "Generating Ansible SSH keypair"
if [[ ! -f "$KEYS_DIR/id_rsa" ]]; then
    ssh-keygen -t rsa -b 4096 -f "$KEYS_DIR/id_rsa" -N "" -C "yb-manager@$(hostname)" > /dev/null
    chmod 600 "$KEYS_DIR/id_rsa"
    chmod 644 "$KEYS_DIR/id_rsa.pub"
    chown yb-manager:yb-manager "$KEYS_DIR/id_rsa" "$KEYS_DIR/id_rsa.pub"
    ok "SSH keypair generated"
else
    ok "SSH keypair already exists"
fi

sudo -u postgres psql -d "$DB_NAME" -c \
    "UPDATE system_config SET value='$(cat $KEYS_DIR/id_rsa.pub)' WHERE key='default_ssh_public_key';" > /dev/null
sudo -u postgres psql -d "$DB_NAME" -c \
    "UPDATE system_config SET value='$KEYS_DIR/id_rsa' WHERE key='ansible_ssh_private_key_path';" > /dev/null
ok "SSH public key saved to system_config"

# ---------------------------------------------------------------------------
# 11. Firewall
# ---------------------------------------------------------------------------

step "Configuring UFW firewall"
ufw --force enable > /dev/null
ufw allow 22/tcp  > /dev/null
ufw allow 80/tcp  > /dev/null
ufw deny  3000/tcp > /dev/null
ok "Firewall configured (ports 22 and 80 open, PostgREST 3000 blocked from outside)"

# ---------------------------------------------------------------------------
# 12. Save credentials
# ---------------------------------------------------------------------------

CREDS_FILE="$INSTALL_DIR/credentials.txt"
cat > "$CREDS_FILE" <<EOF
YB Manager - Installation Credentials
Generated: $(date)

Web UI URL      : http://$(hostname -I | awk '{print $1}')
                 (or http://$(hostname))

PostgreSQL:
  Database      : $DB_NAME
  App user      : $DB_USER
  App password  : $DB_PASS
  PostgREST user: authenticator
  PostgREST pw  : $POSTGREST_DB_PASS

PostgREST JWT secret (keep this private):
  $JWT_SECRET

Ansible SSH public key (paste into Settings > default_ssh_public_key):
$(cat $KEYS_DIR/id_rsa.pub)

Service status:
  systemctl status postgresql
  systemctl status postgrest
  systemctl status nginx
  systemctl status yb-manager-daemon

Logs:
  journalctl -u yb-manager-daemon -f
  journalctl -u postgrest -f
  tail -f /var/log/nginx/error.log
EOF

chmod 600 "$CREDS_FILE"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN} YB Manager setup complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  Web UI  : ${CYAN}http://$(hostname -I | awk '{print $1}')${NC}"
echo ""
echo -e "  Credentials saved to: ${YELLOW}$CREDS_FILE${NC}"
echo ""
echo -e "  Next steps:"
echo "  1. Open the web UI in your browser"
echo "  2. Go to Physical Hosts > Add Host"
echo "  3. Run install-agent.ps1 on each Hyper-V host"
echo "  4. Enter the host IP, port 8765, and the API key from the installer"
echo "  5. Check Settings and update YugabyteDB download URL"
echo ""
echo -e "  Service commands:"
echo "    systemctl status yb-manager-daemon"
echo "    journalctl -u yb-manager-daemon -f"
echo ""
