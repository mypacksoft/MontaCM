#!/usr/bin/env bash
# =============================================================================
# YB Manager - Update Script
# =============================================================================
# Pulls latest code from GitHub, rebuilds the React app, redeploys static
# files, updates daemon and Ansible playbooks, and restarts services.
#
# Usage:
#   sudo bash update.sh
#   sudo bash update.sh --skip-npm   # skip npm install (faster if no new deps)
#   sudo bash update.sh --branch main
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

SKIP_NPM=false
BRANCH=""

for arg in "$@"; do
    case $arg in
        --skip-npm)       SKIP_NPM=true ;;
        --branch=*)       BRANCH="${arg#*=}" ;;
    esac
done

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INSTALL_DIR="/opt/yb-manager"
WEB_ROOT="/var/www/yb-manager"
ANSIBLE_DIR="$INSTALL_DIR/ansible"
DAEMON_DIR="$INSTALL_DIR/daemon"
DAEMON_SRC="$SCRIPT_DIR/daemon/daemon.py"
DAEMON_REQS="$SCRIPT_DIR/daemon/requirements.txt"

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
    error "This script must be run as root. Use: sudo bash update.sh"
fi

echo -e "\n${GREEN}============================================================${NC}"
echo -e "${GREEN} YB Manager - Update${NC}"
echo -e "${GREEN}============================================================${NC}"
echo "  Repo dir  : $REPO_DIR"
echo "  Web root  : $WEB_ROOT"
echo "  Started   : $(date)"

# ---------------------------------------------------------------------------
# 1. Git pull
# ---------------------------------------------------------------------------

step "Pulling latest code from GitHub"

cd "$REPO_DIR"

if [[ ! -d ".git" ]]; then
    error "Not a git repository: $REPO_DIR\nMake sure the management server was set up by cloning the repo."
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TARGET_BRANCH="${BRANCH:-$CURRENT_BRANCH}"

if [[ "$TARGET_BRANCH" != "$CURRENT_BRANCH" ]]; then
    git fetch origin
    git checkout "$TARGET_BRANCH"
    ok "Switched to branch: $TARGET_BRANCH"
else
    git fetch origin
fi

BEFORE=$(git rev-parse HEAD)
git reset --hard "origin/$TARGET_BRANCH"
AFTER=$(git rev-parse HEAD)

if [[ "$BEFORE" == "$AFTER" ]]; then
    warn "Already up to date ($AFTER)"
    CHANGED=false
else
    ok "Updated: ${BEFORE:0:8} -> ${AFTER:0:8}"
    CHANGED=true
fi

git log --oneline -5
echo ""

# ---------------------------------------------------------------------------
# 2. Detect what changed
# ---------------------------------------------------------------------------

DAEMON_CHANGED=false
ANSIBLE_CHANGED=false
WEB_CHANGED=false

if $CHANGED; then
    DIFF_FILES=$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null || echo "")

    echo "$DIFF_FILES" | grep -qE '^install/daemon/' && DAEMON_CHANGED=true || true
    echo "$DIFF_FILES" | grep -qE '^ansible/'        && ANSIBLE_CHANGED=true || true
    echo "$DIFF_FILES" | grep -qE '^src/|^public/|^index\.html|^package\.json|^vite\.config' \
        && WEB_CHANGED=true || true

    echo "  Changes detected:"
    $WEB_CHANGED    && echo "    - Frontend (src/)" || true
    $DAEMON_CHANGED && echo "    - Daemon (install/daemon/)" || true
    $ANSIBLE_CHANGED && echo "    - Ansible playbooks (ansible/)" || true
    ! $WEB_CHANGED && ! $DAEMON_CHANGED && ! $ANSIBLE_CHANGED \
        && echo "    - Other files (no rebuild needed)" || true
else
    warn "No new commits — forcing full redeploy anyway"
    WEB_CHANGED=true
    DAEMON_CHANGED=true
    ANSIBLE_CHANGED=true
fi

# ---------------------------------------------------------------------------
# 3. npm install (if package.json changed or forced)
# ---------------------------------------------------------------------------

if $WEB_CHANGED; then
    step "Installing npm dependencies"
    if $SKIP_NPM; then
        warn "Skipping npm install (--skip-npm)"
    else
        PKG_CHANGED=false
        if $CHANGED; then
            echo "$DIFF_FILES" | grep -q '^package.json' && PKG_CHANGED=true || true
        else
            PKG_CHANGED=true
        fi

        if $PKG_CHANGED; then
            npm install --silent
            ok "npm install done"
        else
            ok "package.json unchanged — skipping npm install"
        fi
    fi

    # -------------------------------------------------------------------------
    # 4. Build React app
    # -------------------------------------------------------------------------

    step "Building React app"
    npm run build
    ok "Build complete: $(du -sh dist | cut -f1) total"

    # -------------------------------------------------------------------------
    # 5. Deploy to web root
    # -------------------------------------------------------------------------

    step "Deploying to $WEB_ROOT"
    rm -rf "${WEB_ROOT:?}"/*
    cp -r dist/. "$WEB_ROOT/"
    chown -R www-data:www-data "$WEB_ROOT"
    ok "Static files deployed"
fi

# ---------------------------------------------------------------------------
# 6. Update daemon
# ---------------------------------------------------------------------------

if $DAEMON_CHANGED; then
    step "Updating automation daemon"

    cp "$DAEMON_SRC" "$DAEMON_DIR/daemon.py"
    chown yb-manager:yb-manager "$DAEMON_DIR/daemon.py"
    ok "daemon.py updated"

    REQS_CHANGED=false
    if $CHANGED; then
        echo "$DIFF_FILES" | grep -q '^install/daemon/requirements.txt' && REQS_CHANGED=true || true
    else
        REQS_CHANGED=true
    fi

    if $REQS_CHANGED; then
        step "Updating Python dependencies"
        "$DAEMON_DIR/venv/bin/pip" install -q -r "$DAEMON_REQS"
        ok "Python deps updated"
    fi

    step "Restarting daemon service"
    systemctl restart yb-manager-daemon
    sleep 2
    systemctl is-active --quiet yb-manager-daemon \
        && ok "yb-manager-daemon restarted and running" \
        || warn "yb-manager-daemon may have failed — check: journalctl -u yb-manager-daemon -n 30"
fi

# ---------------------------------------------------------------------------
# 7. Update Ansible playbooks
# ---------------------------------------------------------------------------

if $ANSIBLE_CHANGED; then
    step "Updating Ansible playbooks and templates"
    cp -r "$REPO_DIR/ansible/playbooks/." "$ANSIBLE_DIR/playbooks/"
    cp -r "$REPO_DIR/ansible/templates/." "$ANSIBLE_DIR/templates/"
    chown -R yb-manager:yb-manager "$ANSIBLE_DIR"
    ok "Ansible playbooks updated"
fi

# ---------------------------------------------------------------------------
# 8. Reload nginx (in case nginx.conf changed)
# ---------------------------------------------------------------------------

NGINX_CHANGED=false
if $CHANGED; then
    echo "$DIFF_FILES" | grep -q '^install/config/nginx.conf' && NGINX_CHANGED=true || true
fi

if $NGINX_CHANGED; then
    step "Updating Nginx config"
    cp "$SCRIPT_DIR/config/nginx.conf" /etc/nginx/sites-available/yb-manager
    nginx -t
    nginx -s reload
    ok "Nginx reloaded"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN} Update complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  Commit : ${CYAN}$(git rev-parse HEAD | head -c 12)${NC}  $(git log -1 --pretty=format:'%s')"
echo -e "  Time   : $(date)"
echo ""
echo "  Service status:"
echo "    systemctl status yb-manager-daemon --no-pager -l"
echo "    systemctl status nginx --no-pager"
echo ""
