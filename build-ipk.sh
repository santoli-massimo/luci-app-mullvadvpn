#!/bin/bash

# ============================================================================
# BUILD SCRIPT - Genera pacchetto .ipk per luci-app-mullvadvpn
# ============================================================================
#
# Compatibile con macOS e Linux
#
# Uso:
#   ./build-ipk.sh
#
# Output:
#   luci-app-mullvadvpn_1.0.0-1_all.ipk
#
# ============================================================================

set -e

# Configurazione pacchetto
PKG_NAME="luci-app-mullvadvpn"
PKG_VERSION="1.0.0"
PKG_RELEASE="4"
PKG_ARCH="all"

# Directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
IPK_NAME="${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"

# Colori
GREEN='\033[0;32m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[BUILD]${NC} $1"
}

# Pulizia precedente build
log "Pulizia directory build..."
rm -rf "$BUILD_DIR"
rm -f "$SCRIPT_DIR/$IPK_NAME"
mkdir -p "$BUILD_DIR"/{control,data}

# === CREA data.tar.gz (file da installare) ===
log "Preparo file da installare..."

DATA_DIR="$BUILD_DIR/data"

# Crea struttura directory
mkdir -p "$DATA_DIR/usr/libexec/rpcd"
mkdir -p "$DATA_DIR/usr/share/rpcd/acl.d"
mkdir -p "$DATA_DIR/usr/share/luci/menu.d"
mkdir -p "$DATA_DIR/usr/share/ucitrack"
mkdir -p "$DATA_DIR/www/luci-static/resources/view/mullvadvpn"
mkdir -p "$DATA_DIR/etc/config"
mkdir -p "$DATA_DIR/etc/mullvadvpn"
mkdir -p "$DATA_DIR/etc/uci-defaults"
mkdir -p "$DATA_DIR/etc/init.d"

# Copia file
cp "$SCRIPT_DIR/root/usr/libexec/rpcd/luci.mullvadvpn" \
   "$DATA_DIR/usr/libexec/rpcd/luci.mullvadvpn"

cp "$SCRIPT_DIR/root/usr/share/rpcd/acl.d/luci-app-mullvadvpn.json" \
   "$DATA_DIR/usr/share/rpcd/acl.d/luci-app-mullvadvpn.json"

cp "$SCRIPT_DIR/root/usr/share/luci/menu.d/luci-app-mullvadvpn.json" \
   "$DATA_DIR/usr/share/luci/menu.d/luci-app-mullvadvpn.json"

cp "$SCRIPT_DIR/root/usr/share/ucitrack/mullvadvpn.json" \
   "$DATA_DIR/usr/share/ucitrack/mullvadvpn.json"

cp "$SCRIPT_DIR/htdocs/luci-static/resources/view/mullvadvpn/"*.js \
   "$DATA_DIR/www/luci-static/resources/view/mullvadvpn/"

cp "$SCRIPT_DIR/root/etc/config/mullvadvpn" \
   "$DATA_DIR/etc/config/mullvadvpn"

cp "$SCRIPT_DIR/root/etc/uci-defaults/luci-app-mullvadvpn" \
   "$DATA_DIR/etc/uci-defaults/luci-app-mullvadvpn"

cp "$SCRIPT_DIR/root/etc/init.d/mullvadvpn" \
   "$DATA_DIR/etc/init.d/mullvadvpn"

# Imposta permessi
chmod 755 "$DATA_DIR/usr/libexec/rpcd/luci.mullvadvpn"
chmod 755 "$DATA_DIR/etc/uci-defaults/luci-app-mullvadvpn"
chmod 755 "$DATA_DIR/etc/init.d/mullvadvpn"
chmod 644 "$DATA_DIR/www/luci-static/resources/view/mullvadvpn/"*.js
chmod 644 "$DATA_DIR/usr/share/rpcd/acl.d/"*.json
chmod 644 "$DATA_DIR/usr/share/luci/menu.d/"*.json

# Crea data.tar.gz (formato GNU tar, senza attributi macOS)
log "Creo data.tar.gz..."
cd "$DATA_DIR"
# IMPORTANTE: usa --format=ustar e escludi file macOS
if tar --version 2>&1 | grep -q GNU; then
    tar --format=ustar --owner=root --group=root -czf "$BUILD_DIR/data.tar.gz" .
else
    # macOS: usa gtar se disponibile, altrimenti tar standard
    if command -v gtar >/dev/null 2>&1; then
        gtar --format=ustar --owner=root --group=root -czf "$BUILD_DIR/data.tar.gz" .
    else
        # Fallback per macOS tar (BSD)
        COPYFILE_DISABLE=1 tar -czf "$BUILD_DIR/data.tar.gz" .
    fi
fi
cd "$SCRIPT_DIR"

# === CREA control.tar.gz (metadati) ===
log "Creo file di controllo..."

CONTROL_DIR="$BUILD_DIR/control"

# Calcola dimensione installata
INSTALLED_SIZE=$(du -sk "$DATA_DIR" | cut -f1)

# File control (metadati principali)
cat > "$CONTROL_DIR/control" << EOF
Package: $PKG_NAME
Version: ${PKG_VERSION}-${PKG_RELEASE}
Depends: libc, luci-base, jsonfilter, pbr, wireguard-tools
Source: package/$PKG_NAME
License: MIT
Section: luci
SourceName: $PKG_NAME
Architecture: $PKG_ARCH
Installed-Size: $INSTALLED_SIZE
Description: LuCI support for Mullvad VPN device routing
EOF

# File conffiles (file config da preservare negli upgrade)
cat > "$CONTROL_DIR/conffiles" << EOF
/etc/config/mullvadvpn
EOF

# Script postinst (eseguito dopo installazione)
cat > "$CONTROL_DIR/postinst" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# Esegui uci-defaults
if [ -f /etc/uci-defaults/luci-app-mullvadvpn ]; then
    ( . /etc/uci-defaults/luci-app-mullvadvpn ) && rm -f /etc/uci-defaults/luci-app-mullvadvpn
fi

# Crea directory cache se non esiste
mkdir -p /etc/mullvadvpn

# Pulisci cache LuCI
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*

# Riavvia rpcd per caricare ACL
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd restart

# Abilita servizio mullvadvpn
[ -x /etc/init.d/mullvadvpn ] && /etc/init.d/mullvadvpn enable

# Riavvia ucitrack per registrare i nuovi trigger
[ -x /etc/init.d/ucitrack ] && /etc/init.d/ucitrack restart

exit 0
EOF
chmod 755 "$CONTROL_DIR/postinst"

# Script prerm (eseguito prima della rimozione)
cat > "$CONTROL_DIR/prerm" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# Disabilita servizio
[ -x /etc/init.d/mullvadvpn ] && /etc/init.d/mullvadvpn disable

# Rimuovi policy PBR generate
if [ -f /etc/config/pbr ]; then
    for section in $(uci show pbr 2>/dev/null | grep "\.name='mvpn_" | cut -d. -f2 | cut -d= -f1); do
        uci -q delete pbr.$section
    done
    uci commit pbr 2>/dev/null
    [ -x /etc/init.d/pbr ] && /etc/init.d/pbr restart 2>/dev/null
fi

exit 0
EOF
chmod 755 "$CONTROL_DIR/prerm"

# Script postrm (eseguito dopo la rimozione)
cat > "$CONTROL_DIR/postrm" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

rm -rf /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd restart

exit 0
EOF
chmod 755 "$CONTROL_DIR/postrm"

# Crea control.tar.gz
log "Creo control.tar.gz..."
cd "$CONTROL_DIR"
if tar --version 2>&1 | grep -q GNU; then
    tar --format=ustar --owner=root --group=root -czf "$BUILD_DIR/control.tar.gz" .
else
    if command -v gtar >/dev/null 2>&1; then
        gtar --format=ustar --owner=root --group=root -czf "$BUILD_DIR/control.tar.gz" .
    else
        COPYFILE_DISABLE=1 tar -czf "$BUILD_DIR/control.tar.gz" .
    fi
fi
cd "$SCRIPT_DIR"

# === CREA debian-binary ===
echo "2.0" > "$BUILD_DIR/debian-binary"

# === ASSEMBLA IPK ===
log "Assemblo pacchetto $IPK_NAME..."
cd "$BUILD_DIR"

# IMPORTANTE: OpenWrt 23.05+ usa tar.gz per i file .ipk, NON ar format!
# - Il pacchetto finale deve essere tar.gz (non Debian ar archive)
# - Usare --format=ustar (non gnu o pax) per compatibilità con BusyBox
# - I file interni devono avere prefisso ./ (es: ./debian-binary)
if command -v gtar >/dev/null 2>&1; then
    gtar --format=ustar --owner=root --group=root -czf "$SCRIPT_DIR/$IPK_NAME" ./debian-binary ./control.tar.gz ./data.tar.gz
elif tar --version 2>&1 | grep -q GNU; then
    tar --format=ustar --owner=root --group=root -czf "$SCRIPT_DIR/$IPK_NAME" ./debian-binary ./control.tar.gz ./data.tar.gz
else
    COPYFILE_DISABLE=1 tar -czf "$SCRIPT_DIR/$IPK_NAME" ./debian-binary ./control.tar.gz ./data.tar.gz
fi

cd "$SCRIPT_DIR"

# Pulizia
log "Pulizia file temporanei..."
rm -rf "$BUILD_DIR"

# Verifica
if [ -f "$IPK_NAME" ]; then
    echo ""
    echo "=========================================="
    echo -e "${GREEN}Pacchetto creato con successo!${NC}"
    echo "=========================================="
    echo ""
    echo "File: $IPK_NAME"
    echo "Size: $(ls -lh "$IPK_NAME" | awk '{print $5}')"
    echo ""
    echo "Per installare sul router:"
    echo ""
    echo "  # Copia e installa"
    echo "  cat $IPK_NAME | ssh root@<ROUTER> 'cat > /tmp/pkg.ipk && opkg install /tmp/pkg.ipk'"
    echo ""
else
    echo "ERRORE: Pacchetto non creato!"
    exit 1
fi
