#!/usr/bin/env bash
# =============================================================================
# YB Manager - Remove & Reinstall Script
# =============================================================================
# Completely removes all YB Manager components and reinstalls from scratch.
#
# Usage:
#   sudo bash reinstall.sh              # full remove + reinstall
#   sudo bash reinstall.sh --remove     # remove only (no reinstall)
#   sudo bash reinstall.sh --offline    # reinstall without downloading packages
#   sudo bash reinstall.sh --keep-db    # keep PostgreSQL data during reinstall
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

REMOVE_ONLY=false
OFFLINE=false
KEEP_DB=false

for arg in "$@"; do
    case $arg in
        --remove)   REMOVE_ONLY=true ;;
        --offline)  OFFLINE=true ;;
        --keep-db)  KEEP_DB=true ;;
    esac
done

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INSTALL_DIR="/opt/yb-manager"
WEB_ROOT="/var/www/yb-manager"
DB_NAME="yb_manager"

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
# Root check
# ---------------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root. Use: sudo bash reinstall.sh"
fi

# ---------------------------------------------------------------------------
# REMOVE
# ---------------------------------------------------------------------------

step "Stopping and disabling services"

for svc in yb-manager-daemon postgrest; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl stop "$svc"
        ok "Stopped $svc"
    fi
    if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
        systemctl disable "$svc"
        ok "Disabled $svc"
    fi
done

step "Removing systemd service files"
rm -f /etc/systemd/system/yb-manager-daemon.service
rm -f /etc/systemd/system/postgrest.service
systemctl daemon-reload
ok "Service files removed"

step "Removing Nginx config"
rm -f /etc/nginx/sites-enabled/yb-manager
rm -f /etc/nginx/sites-available/yb-manager
if [[ -f /etc/nginx/sites-available/default ]]; then
    ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default 2>/dev/null || true
fi
nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || true
ok "Nginx config removed"

step "Removing PostgREST config"
rm -f /etc/postgrest.conf
ok "PostgREST config removed"

step "Removing PostgREST binary"
rm -f /usr/local/bin/postgrest
ok "PostgREST binary removed"

step "Removing install directory and web root"
rm -rf "$INSTALL_DIR"
rm -rf "$WEB_ROOT"
ok "Removed $INSTALL_DIR and $WEB_ROOT"

step "Removing system user yb-manager"
if id -u yb-manager &>/dev/null; then
    userdel yb-manager 2>/dev/null || true
    ok "User yb-manager removed"
else
    warn "User yb-manager not found, skipping"
fi

if ! $KEEP_DB; then
    step "Dropping PostgreSQL database and roles"
    sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1 && \
        sudo -u postgres psql -c "DROP DATABASE $DB_NAME;" && ok "Database $DB_NAME dropped" || warn "Database not found"

    for role in yb_manager_role authenticator anon; do
        sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$role'" 2>/dev/null | grep -q 1 && \
            sudo -u postgres psql -c "DROP ROLE $role;" && ok "Role $role dropped" || true
    done
else
    warn "Skipping database removal (--keep-db)"
fi

step "Removing UFW rules for port 3000"
ufw delete deny 3000/tcp 2>/dev/null && ok "UFW rule for 3000 removed" || warn "UFW rule not found"

step "Removing .env.production from repo"
rm -f "$REPO_DIR/.env.production"
ok "Removed .env.production"

step "Removing npm build artifacts"
rm -rf "$REPO_DIR/dist"
rm -rf "$REPO_DIR/node_modules"
ok "Removed dist/ and node_modules/"

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN} YB Manager removed successfully!${NC}"
echo -e "${GREEN}============================================================${NC}"

if $REMOVE_ONLY; then
    echo ""
    echo "  To reinstall, run:"
    echo "    sudo bash $SCRIPT_DIR/setup-management.sh"
    echo ""
    exit 0
fi

# ---------------------------------------------------------------------------
# REINSTALL
# ---------------------------------------------------------------------------

echo ""
echo -e "${CYAN}Starting reinstall...${NC}"
echo ""

SETUP_ARGS=""
$OFFLINE && SETUP_ARGS="$SETUP_ARGS --offline"

bash "$SCRIPT_DIR/setup-management.sh" $SETUP_ARGS
