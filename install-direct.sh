#!/bin/bash

# ============================================================================
# DIRECT INSTALL (without .ipk)
# ============================================================================
#
# Usage: ./install-direct.sh <ip-router>
#
# ============================================================================

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <ip-router>"
    echo "Example: $0 192.168.1.1"
    exit 1
fi

ROUTER="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing on $ROUTER..."

# Check connection
ssh -o ConnectTimeout=5 "root@$ROUTER" "echo OK" || {
    echo "Error: unable to connect to root@$ROUTER"
    exit 1
}

# Install dependencies
echo "Checking dependencies..."
ssh "root@$ROUTER" 'opkg update >/dev/null 2>&1; opkg install jsonfilter pbr wireguard-tools 2>/dev/null || true'

# Create directories
echo "Creating directories..."
ssh "root@$ROUTER" 'mkdir -p /usr/libexec/rpcd /usr/share/rpcd/acl.d /usr/share/luci/menu.d /www/luci-static/resources/view/mullvadvpn /etc/mullvadvpn'

# Copy files (using cat instead of scp)
echo "Copying files..."

cat "$SCRIPT_DIR/root/usr/libexec/rpcd/luci.mullvadvpn" | \
    ssh "root@$ROUTER" 'cat > /usr/libexec/rpcd/luci.mullvadvpn && chmod +x /usr/libexec/rpcd/luci.mullvadvpn'

cat "$SCRIPT_DIR/root/usr/share/rpcd/acl.d/luci-app-mullvadvpn.json" | \
    ssh "root@$ROUTER" 'cat > /usr/share/rpcd/acl.d/luci-app-mullvadvpn.json'

cat "$SCRIPT_DIR/root/usr/share/luci/menu.d/luci-app-mullvadvpn.json" | \
    ssh "root@$ROUTER" 'cat > /usr/share/luci/menu.d/luci-app-mullvadvpn.json'

cat "$SCRIPT_DIR/htdocs/luci-static/resources/view/mullvadvpn/overview.js" | \
    ssh "root@$ROUTER" 'cat > /www/luci-static/resources/view/mullvadvpn/overview.js'

cat "$SCRIPT_DIR/htdocs/luci-static/resources/view/mullvadvpn/wizard.js" | \
    ssh "root@$ROUTER" 'cat > /www/luci-static/resources/view/mullvadvpn/wizard.js'

# Create config if it does not exist
ssh "root@$ROUTER" << 'EOF'
if [ ! -f /etc/config/mullvadvpn ]; then
    cat > /etc/config/mullvadvpn << 'CONF'
config mullvadvpn 'globals'
	option enabled '1'
	option servers_cache_path '/etc/mullvadvpn/servers.json'
	option last_server_refresh '0'
CONF
fi
EOF

# Clean cache and restart services
echo "Restarting services..."
ssh "root@$ROUTER" 'rm -rf /tmp/luci-* && service rpcd restart'

echo ""
echo "=========================================="
echo "Installation completed!"
echo "=========================================="
echo ""
echo "Open: http://$ROUTER -> VPN -> Mullvad"
