# SPDX-License-Identifier: MIT
# Copyright (C) 2024

include $(TOPDIR)/rules.mk

# === METADATI PACCHETTO ===
# Questi definiscono come il pacchetto appare in opkg e nel build system

PKG_NAME:=luci-app-mullvadvpn
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Massimo <massimo@example.com>

# === CONFIGURAZIONE LUCI ===
# LUCI_TITLE: Nome mostrato nell'interfaccia di installazione pacchetti
# LUCI_DEPENDS: Pacchetti richiesti per funzionare
#   - luci-base: framework LuCI (obbligatorio per tutte le app LuCI)
#   - jsonfilter: utility per parsing JSON in shell script
#   - pbr: Policy-Based Routing per instradare il traffico
#   - wireguard-tools: comandi wg per gestire interfacce WireGuard
# LUCI_PKGARCH: 'all' significa che non contiene codice compilato (solo script/JS)

LUCI_TITLE:=LuCI support for Mullvad VPN device routing
LUCI_DEPENDS:=+luci-base +jsonfilter +pbr +wireguard-tools
LUCI_PKGARCH:=all

# Include il framework di build LuCI che gestisce automaticamente
# l'installazione dei file nelle directory corrette
include $(TOPDIR)/feeds/luci/luci.mk

# Descrizione estesa mostrata con 'opkg info'
define Package/luci-app-mullvadvpn/description
  Web interface for managing Mullvad VPN tunnels with per-device
  policy-based routing on OpenWrt.

  Features:
  - Associate WireGuard interfaces with logical tunnels
  - Route specific devices through VPN tunnels via MAC address
  - Change Mullvad server without losing device assignments
  - Persistent configuration across reboots
endef

# Questo macro genera le regole di build standard per pacchetti LuCI
$(eval $(call BuildPackage,luci-app-mullvadvpn))
