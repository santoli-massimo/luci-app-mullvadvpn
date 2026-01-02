#!/bin/bash

# ============================================================================
# INSTALLER per luci-app-mullvadvpn
# ============================================================================
#
# Uso:
#   ./install.sh <ip-router>           # Installa sul router
#   ./install.sh <ip-router> --remove  # Disinstalla
#
# Esempio:
#   ./install.sh 192.168.1.1
#   ./install.sh router.local
#
# ============================================================================

set -e

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Directory dello script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Funzioni utility
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Verifica argomenti
if [ -z "$1" ]; then
    echo "Uso: $0 <ip-router> [--remove]"
    echo ""
    echo "Esempi:"
    echo "  $0 192.168.1.1         # Installa"
    echo "  $0 192.168.1.1 --remove # Disinstalla"
    exit 1
fi

ROUTER="$1"
REMOVE_MODE=false

if [ "$2" = "--remove" ] || [ "$2" = "-r" ]; then
    REMOVE_MODE=true
fi

# Test connessione SSH
log_info "Verifico connessione a $ROUTER..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "root@$ROUTER" "echo ok" >/dev/null 2>&1; then
    log_error "Impossibile connettersi a root@$ROUTER"
    log_warn "Assicurati di:"
    echo "  1. Il router sia raggiungibile: ping $ROUTER"
    echo "  2. SSH sia abilitato sul router"
    echo "  3. La chiave SSH sia configurata: ssh-copy-id root@$ROUTER"
    exit 1
fi
log_info "Connessione OK"

# === DISINSTALLAZIONE ===
if [ "$REMOVE_MODE" = true ]; then
    log_info "Disinstallazione in corso..."

    ssh "root@$ROUTER" << 'ENDSSH'
        # Rimuovi file
        rm -f /usr/libexec/rpcd/luci.mullvadvpn
        rm -f /usr/share/rpcd/acl.d/luci-app-mullvadvpn.json
        rm -f /usr/share/luci/menu.d/luci-app-mullvadvpn.json
        rm -rf /www/luci-static/resources/view/mullvadvpn
        rm -f /etc/uci-defaults/luci-app-mullvadvpn

        # Opzionale: rimuovi configurazione (chiedi conferma)
        # rm -f /etc/config/mullvadvpn
        # rm -rf /etc/mullvadvpn

        # Rimuovi policy PBR generate
        if [ -f /etc/config/pbr ]; then
            # Trova e rimuovi policy con prefisso mvpn_
            for section in $(uci show pbr 2>/dev/null | grep "\.name='mvpn_" | cut -d. -f2 | cut -d= -f1); do
                uci delete pbr.$section 2>/dev/null || true
            done
            uci commit pbr 2>/dev/null || true
        fi

        # Pulisci cache e riavvia servizi
        rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
        service rpcd restart

        echo "Disinstallazione completata!"
ENDSSH

    log_info "Disinstallazione completata!"
    log_warn "La configurazione /etc/config/mullvadvpn è stata preservata."
    log_warn "Per rimuoverla: ssh root@$ROUTER 'rm -rf /etc/config/mullvadvpn /etc/mullvadvpn'"
    exit 0
fi

# === INSTALLAZIONE ===
log_info "Installazione su $ROUTER..."

# Verifica dipendenze sul router
log_info "Verifico dipendenze..."
MISSING_DEPS=""
for dep in jsonfilter pbr; do
    if ! ssh "root@$ROUTER" "command -v $dep" >/dev/null 2>&1; then
        MISSING_DEPS="$MISSING_DEPS $dep"
    fi
done

# Verifica WireGuard
if ! ssh "root@$ROUTER" "command -v wg" >/dev/null 2>&1; then
    MISSING_DEPS="$MISSING_DEPS wireguard-tools"
fi

if [ -n "$MISSING_DEPS" ]; then
    log_warn "Dipendenze mancanti:$MISSING_DEPS"
    log_info "Installo dipendenze..."
    ssh "root@$ROUTER" "opkg update && opkg install $MISSING_DEPS" || {
        log_error "Impossibile installare dipendenze. Installa manualmente:"
        echo "  ssh root@$ROUTER 'opkg update && opkg install$MISSING_DEPS'"
        exit 1
    }
fi

# Crea directory sul router
log_info "Creo directory..."
ssh "root@$ROUTER" << 'ENDSSH'
    mkdir -p /usr/libexec/rpcd
    mkdir -p /usr/share/rpcd/acl.d
    mkdir -p /usr/share/luci/menu.d
    mkdir -p /www/luci-static/resources/view/mullvadvpn
    mkdir -p /etc/mullvadvpn
    mkdir -p /etc/uci-defaults
ENDSSH

# Copia file
log_info "Copio file..."

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

# Config (solo se non esiste)
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

# Imposta permessi e riavvia servizi
log_info "Configuro permessi e riavvio servizi..."
ssh "root@$ROUTER" << 'ENDSSH'
    # Rendi eseguibile lo script RPC
    chmod +x /usr/libexec/rpcd/luci.mullvadvpn

    # Esegui uci-defaults se presente
    if [ -f /etc/uci-defaults/luci-app-mullvadvpn ]; then
        sh /etc/uci-defaults/luci-app-mullvadvpn
    fi

    # Pulisci cache LuCI
    rm -rf /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*

    # Riavvia rpcd per caricare nuovo ACL
    service rpcd restart

    echo "Configurazione completata!"
ENDSSH

log_info "=========================================="
log_info "Installazione completata con successo!"
log_info "=========================================="
echo ""
echo "Prossimi passi:"
echo "  1. Apri LuCI: http://$ROUTER"
echo "  2. Vai a: VPN → Mullvad"
echo "  3. Segui il wizard per configurare il primo tunnel"
echo ""
log_warn "Assicurati di avere già configurato un'interfaccia WireGuard con Mullvad"
echo "  (Network → Interfaces → Add new interface → WireGuard)"
