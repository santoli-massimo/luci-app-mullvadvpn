#!/bin/bash

# ============================================================================
# BUILD SCRIPT - Generates the .ipk package for luci-app-mullvadvpn
# ============================================================================
#
# Compatible with macOS and Linux
#
# Usage:
#   ./build-ipk.sh
#
# Output:
#   luci-app-mullvadvpn_1.0.0-1_all.ipk
#
# ============================================================================

set -e

# Package configuration
PKG_NAME="luci-app-mullvadvpn"
PKG_VERSION="1.0.0"
PKG_RELEASE="4"
PKG_ARCH="all"

# Directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
IPK_NAME="${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"

# Colors
GREEN='\033[0;32m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[BUILD]${NC} $1"
}

# Clean up previous build
log "Cleaning build directory..."
rm -rf "$BUILD_DIR"
rm -f "$SCRIPT_DIR/$IPK_NAME"
mkdir -p "$BUILD_DIR"/{control,data}

# === CREATE data.tar.gz (files to install) ===
log "Preparing files to install..."

DATA_DIR="$BUILD_DIR/data"

# Create directory structure
mkdir -p "$DATA_DIR/usr/libexec/rpcd"
mkdir -p "$DATA_DIR/usr/share/rpcd/acl.d"
mkdir -p "$DATA_DIR/usr/share/luci/menu.d"
mkdir -p "$DATA_DIR/usr/share/ucitrack"
mkdir -p "$DATA_DIR/www/luci-static/resources/view/mullvadvpn"
mkdir -p "$DATA_DIR/etc/config"
mkdir -p "$DATA_DIR/etc/mullvadvpn"
mkdir -p "$DATA_DIR/etc/uci-defaults"
mkdir -p "$DATA_DIR/etc/init.d"

# Copy files
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

# Set permissions
chmod 755 "$DATA_DIR/usr/libexec/rpcd/luci.mullvadvpn"
chmod 755 "$DATA_DIR/etc/uci-defaults/luci-app-mullvadvpn"
chmod 755 "$DATA_DIR/etc/init.d/mullvadvpn"
chmod 644 "$DATA_DIR/www/luci-static/resources/view/mullvadvpn/"*.js
chmod 644 "$DATA_DIR/usr/share/rpcd/acl.d/"*.json
chmod 644 "$DATA_DIR/usr/share/luci/menu.d/"*.json

# Create data.tar.gz (GNU tar format, without macOS attributes)
log "Creating data.tar.gz..."
cd "$DATA_DIR"
# IMPORTANT: use --format=ustar and exclude macOS files
if tar --version 2>&1 | grep -q GNU; then
    tar --format=ustar --owner=root --group=root -czf "$BUILD_DIR/data.tar.gz" .
else
    # macOS: use gtar if available, otherwise standard tar
    if command -v gtar >/dev/null 2>&1; then
        gtar --format=ustar --owner=root --group=root -czf "$BUILD_DIR/data.tar.gz" .
    else
        # Fallback for macOS tar (BSD)
        COPYFILE_DISABLE=1 tar -czf "$BUILD_DIR/data.tar.gz" .
    fi
fi
cd "$SCRIPT_DIR"

# === CREATE control.tar.gz (metadata) ===
log "Creating control files..."

CONTROL_DIR="$BUILD_DIR/control"

# Compute installed size
INSTALLED_SIZE=$(du -sk "$DATA_DIR" | cut -f1)

# control file (main metadata)
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

# conffiles file (config files to preserve across upgrades)
cat > "$CONTROL_DIR/conffiles" << EOF
/etc/config/mullvadvpn
EOF

# postinst script (run after installation)
cat > "$CONTROL_DIR/postinst" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# Run uci-defaults
if [ -f /etc/uci-defaults/luci-app-mullvadvpn ]; then
    ( . /etc/uci-defaults/luci-app-mullvadvpn ) && rm -f /etc/uci-defaults/luci-app-mullvadvpn
fi

# Create cache directory if it does not exist
mkdir -p /etc/mullvadvpn

# Clean LuCI cache
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*

# Restart rpcd to load the ACL
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd restart

# Enable the mullvadvpn service
[ -x /etc/init.d/mullvadvpn ] && /etc/init.d/mullvadvpn enable

# Restart ucitrack to register the new triggers
[ -x /etc/init.d/ucitrack ] && /etc/init.d/ucitrack restart

exit 0
EOF
chmod 755 "$CONTROL_DIR/postinst"

# prerm script (run before removal)
cat > "$CONTROL_DIR/prerm" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

# Disable the service
[ -x /etc/init.d/mullvadvpn ] && /etc/init.d/mullvadvpn disable

# Remove generated PBR policies
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

# postrm script (run after removal)
cat > "$CONTROL_DIR/postrm" << 'EOF'
#!/bin/sh
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0

rm -rf /tmp/luci-indexcache /tmp/luci-modulecache /tmp/luci-*
[ -x /etc/init.d/rpcd ] && /etc/init.d/rpcd restart

exit 0
EOF
chmod 755 "$CONTROL_DIR/postrm"

# Create control.tar.gz
log "Creating control.tar.gz..."
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

# === CREATE debian-binary ===
echo "2.0" > "$BUILD_DIR/debian-binary"

# === ASSEMBLE IPK ===
log "Assembling package $IPK_NAME..."
cd "$BUILD_DIR"

# IMPORTANT: OpenWrt 23.05+ uses tar.gz for .ipk files, NOT ar format!
# - The final package must be tar.gz (not a Debian ar archive)
# - Use --format=ustar (not gnu or pax) for BusyBox compatibility
# - The inner files must have the ./ prefix (e.g.: ./debian-binary)
if command -v gtar >/dev/null 2>&1; then
    gtar --format=ustar --owner=root --group=root -czf "$SCRIPT_DIR/$IPK_NAME" ./debian-binary ./control.tar.gz ./data.tar.gz
elif tar --version 2>&1 | grep -q GNU; then
    tar --format=ustar --owner=root --group=root -czf "$SCRIPT_DIR/$IPK_NAME" ./debian-binary ./control.tar.gz ./data.tar.gz
else
    COPYFILE_DISABLE=1 tar -czf "$SCRIPT_DIR/$IPK_NAME" ./debian-binary ./control.tar.gz ./data.tar.gz
fi

cd "$SCRIPT_DIR"

# Cleanup
log "Cleaning temporary files..."
rm -rf "$BUILD_DIR"

# Verify
if [ -f "$IPK_NAME" ]; then
    echo ""
    echo "=========================================="
    echo -e "${GREEN}Package created successfully!${NC}"
    echo "=========================================="
    echo ""
    echo "File: $IPK_NAME"
    echo "Size: $(ls -lh "$IPK_NAME" | awk '{print $5}')"
    echo ""
    echo "To install on the router:"
    echo ""
    echo "  # Copy and install"
    echo "  cat $IPK_NAME | ssh root@<ROUTER> 'cat > /tmp/pkg.ipk && opkg install /tmp/pkg.ipk'"
    echo ""
else
    echo "ERROR: Package not created!"
    exit 1
fi
