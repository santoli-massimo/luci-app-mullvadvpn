#!/bin/bash

# ============================================================================
# INSTALLER for luci-app-mullvadvpn
# ============================================================================
#
# Usage:
#   ./install.sh <ip-router>           # Install on the router
#   ./install.sh <ip-router> --remove  # Uninstall
#
# Example:
#   ./install.sh 192.168.1.1
#   ./install.sh router.local
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Utility functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check arguments
if [ -z "$1" ]; then
    echo "Usage: $0 <ip-router> [--remove]"
    echo ""
    echo "Examples:"
    echo "  $0 192.168.1.1         # Install"
    echo "  $0 192.168.1.1 --remove # Uninstall"
    exit 1
fi

ROUTER="$1"
REMOVE_MODE=false

if [ "$2" = "--remove" ] || [ "$2" = "-r" ]; then
    REMOVE_MODE=true
fi

# Test SSH connection
log_info "Checking connection to $ROUTER..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "root@$ROUTER" "echo ok" >/dev/null 2>&1; then
    log_error "Unable to connect to root@$ROUTER"
    log_warn "Make sure that:"
    echo "  1. The router is reachable: ping $ROUTER"
    echo "  2. SSH is enabled on the router"
    echo "  3. The SSH key is configured: ssh-copy-id root@$ROUTER"
    exit 1
fi
log_info "Connection OK"

# === UNINSTALL ===
if [ "$REMOVE_MODE" = true ]; then
    log_info "Uninstalling..."

    ssh "root@$ROUTER" << 'ENDSSH'
        # Remove files
        rm -f /usr/libexec/rpcd/luci.mullvadvpn
        rm -f /usr/share/rpcd/acl.d/luci-app-mullvadvpn.json
        rm -f /usr/share/luci/menu.d/luci-app-mullvadvpn.json
        rm -rf /www/luci-static/resources/view/mullvadvpn
        rm -f /etc/uci-defaults/luci-app-mullvadvpn

        # Optional: remove configuration (ask for confirmation)
        # rm -f /etc/config/mullvadvpn
        # rm -rf /etc/mullvadvpn

        # Remove generated PBR policies
        if [ -f /etc/config/pbr ]; then
            # Find and remove policies with the mvpn_ prefix
            for section in $(uci show pbr 2>/dev/null | grep "\.name='mvpn_" | cut -d. -f2 | cut -d= -f1); do
                uci delete pbr.$section 2>/dev/null || true
            done
            uci commit pbr 2>/dev/null || true
        fi

        # Clean cache and restart services
        rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
        service rpcd restart

        echo "Uninstall completed!"
ENDSSH

    log_info "Uninstall completed!"
    log_warn "The configuration /etc/config/mullvadvpn has been preserved."
    log_warn "To remove it: ssh root@$ROUTER 'rm -rf /etc/config/mullvadvpn /etc/mullvadvpn'"
    exit 0
fi

# === INSTALL ===
log_info "Installing on $ROUTER..."

# Check dependencies on the router
log_info "Checking dependencies..."
MISSING_DEPS=""
for dep in jsonfilter pbr; do
    if ! ssh "root@$ROUTER" "command -v $dep" >/dev/null 2>&1; then
        MISSING_DEPS="$MISSING_DEPS $dep"
    fi
done

# Check WireGuard
if ! ssh "root@$ROUTER" "command -v wg" >/dev/null 2>&1; then
    MISSING_DEPS="$MISSING_DEPS wireguard-tools"
fi

if [ -n "$MISSING_DEPS" ]; then
    log_warn "Missing dependencies:$MISSING_DEPS"
    log_info "Installing dependencies..."
    ssh "root@$ROUTER" "opkg update && opkg install $MISSING_DEPS" || {
        log_error "Unable to install dependencies. Install them manually:"
        echo "  ssh root@$ROUTER 'opkg update && opkg install$MISSING_DEPS'"
        exit 1
    }
fi

# Create directories on the router
log_info "Creating directories..."
ssh "root@$ROUTER" << 'ENDSSH'
    mkdir -p /usr/libexec/rpcd
    mkdir -p /usr/share/rpcd/acl.d
    mkdir -p /usr/share/luci/menu.d
    mkdir -p /www/luci-static/resources/view/mullvadvpn
    mkdir -p /etc/mullvadvpn
    mkdir -p /etc/uci-defaults
ENDSSH

# Copy files
log_info "Copying files..."

# Backend RPC
scp -q "$SCRIPT_DIR/root/usr/libexec/rpcd/luci.mullvadvpn" \
    "root@$ROUTER:/usr/libexec/rpcd/luci.mullvadvpn"

# ACL
scp -q "$SCRIPT_DIR/root/usr/share/rpcd/acl.d/luci-app-mullvadvpn.json" \
    "root@$ROUTER:/usr/share/rpcd/acl.d/luci-app-mullvadvpn.json"

# Menu
scp -q "$SCRIPT_DIR/root/usr/share/luci/menu.d/luci-app-mullvadvpn.json" \
    "root@$ROUTER:/usr/share/luci/menu.d/luci-app-mullvadvpn.json"

# Views JavaScript
scp -q "$SCRIPT_DIR/htdocs/luci-static/resources/view/mullvadvpn/"*.js \
    "root@$ROUTER:/www/luci-static/resources/view/mullvadvpn/"

# UCI defaults
scp -q "$SCRIPT_DIR/root/etc/uci-defaults/luci-app-mullvadvpn" \
    "root@$ROUTER:/etc/uci-defaults/luci-app-mullvadvpn"

# Config (only if it does not exist)
ssh "root@$ROUTER" << 'ENDSSH'
    if [ ! -f /etc/config/mullvadvpn ]; then
        cat > /etc/config/mullvadvpn << 'EOF'
config mullvadvpn 'globals'
	option enabled '1'
	option servers_cache_path '/etc/mullvadvpn/servers.json'
	option last_server_refresh '0'
EOF
    fi
ENDSSH

# Set permissions and restart services
log_info "Setting permissions and restarting services..."
ssh "root@$ROUTER" << 'ENDSSH'
    # Make the RPC script executable
    chmod +x /usr/libexec/rpcd/luci.mullvadvpn

    # Run uci-defaults if present
    if [ -f /etc/uci-defaults/luci-app-mullvadvpn ]; then
        sh /etc/uci-defaults/luci-app-mullvadvpn
    fi

    # Clean LuCI cache
    rm -rf /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*

    # Restart rpcd to load the new ACL
    service rpcd restart

    echo "Configuration completed!"
ENDSSH

log_info "=========================================="
log_info "Installation completed successfully!"
log_info "=========================================="
echo ""
echo "Next steps:"
echo "  1. Open LuCI: http://$ROUTER"
echo "  2. Go to: VPN → Mullvad"
echo "  3. Follow the wizard to configure the first tunnel"
echo ""
log_warn "Make sure you have already configured a WireGuard interface with Mullvad"
echo "  (Network → Interfaces → Add new interface → WireGuard)"
