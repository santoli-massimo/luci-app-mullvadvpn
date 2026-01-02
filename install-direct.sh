#!/bin/bash

# ============================================================================
# INSTALLAZIONE DIRETTA (senza .ipk)
# ============================================================================
#
# Uso: ./install-direct.sh <ip-router>
#
# ============================================================================

set -e

if [ -z "$1" ]; then
    echo "Uso: $0 <ip-router>"
    echo "Esempio: $0 192.168.1.1"
    exit 1
fi

ROUTER="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installazione su $ROUTER..."

# Verifica connessione
ssh -o ConnectTimeout=5 "root@$ROUTER" "echo OK" || {
    echo "Errore: impossibile connettersi a root@$ROUTER"
    exit 1
}

# Installa dipendenze
echo "Verifico dipendenze..."
ssh "root@$ROUTER" 'opkg update >/dev/null 2>&1; opkg install jsonfilter pbr wireguard-tools 2>/dev/null || true'

# Crea directory
echo "Creo directory..."
ssh "root@$ROUTER" 'mkdir -p /usr/libexec/rpcd /usr/share/rpcd/acl.d /usr/share/luci/menu.d /www/luci-static/resources/view/mullvadvpn /etc/mullvadvpn'

# Copia file (usando cat invece di scp)
echo "Copio file..."

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

# Crea config se non esiste
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

# Pulisci cache e riavvia servizi
echo "Riavvio servizi..."
ssh "root@$ROUTER" 'rm -rf /tmp/luci-* && service rpcd restart'

echo ""
echo "=========================================="
echo "Installazione completata!"
echo "=========================================="
echo ""
echo "Apri: http://$ROUTER -> VPN -> Mullvad"
