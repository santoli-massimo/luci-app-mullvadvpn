# luci-app-mullvadvpn

LuCI application for managing Mullvad VPN device routing on OpenWrt.

## Features

- **Tunnel Management**: Associate WireGuard interfaces with logical "tunnels"
- **Device Routing**: Route specific devices through VPN using MAC address
- **Server Selection**: Change Mullvad server without losing device assignments
- **Policy-Based Routing**: Uses PBR for per-device traffic routing
- **Persistent Configuration**: Settings survive reboots

## Requirements

- OpenWrt 23.05 or later
- WireGuard configured with Mullvad credentials
- PBR (Policy-Based Routing) package

### Required Packages

```bash
opkg update
opkg install luci-base jsonfilter pbr wireguard-tools
```

## Installation

### Option 1: Manual Installation (Development)

Copy files to router:

```bash
# From your development machine
scp -r root/* root@router:/

# On the router
chmod +x /usr/libexec/rpcd/luci.mullvadvpn
service rpcd restart
rm -rf /tmp/luci-*
```

### Option 2: Build OpenWrt Package

```bash
# In OpenWrt build system
cp -r luci-app-mullvadvpn package/feeds/luci/
make package/luci-app-mullvadvpn/compile V=s

# Install the generated .ipk on router
opkg install luci-app-mullvadvpn_*.ipk
```

## Usage

### Initial Setup

1. First, configure a WireGuard interface for Mullvad in **Network → Interfaces**
2. Navigate to **VPN → Mullvad** in LuCI
3. The wizard will guide you to create your first tunnel

### Managing Tunnels

- Each tunnel wraps an existing WireGuard interface
- Click **🔄** to change the Mullvad server
- Toggle **Enabled** to activate/deactivate the tunnel

### Managing Devices

1. Click **Add Device** and select from online hosts or enter MAC manually
2. Assign a tunnel from the dropdown
3. Click **Save & Apply** to create PBR policies

### Changing Mullvad Server

1. Click the **🔄** button on a tunnel
2. Select Country → City → Server
3. Click **Apply** to update the WireGuard peer
4. Click **Save & Apply** to restart the connection

## Configuration Files

| File | Purpose |
|------|---------|
| `/etc/config/mullvadvpn` | UCI configuration (tunnels, devices) |
| `/etc/mullvadvpn/servers.json` | Cached Mullvad server list |
| `/etc/config/pbr` | Generated PBR policies (prefixed with `mvpn_`) |

## How It Works

1. **Tunnels** are logical wrappers around WireGuard interfaces
2. **Devices** are identified by MAC address and assigned to tunnels
3. When you click **Save & Apply**:
   - All `mvpn_*` policies in PBR are deleted
   - New policies are created for each enabled device with a tunnel
   - PBR service is restarted
   - Network is reloaded

## Troubleshooting

### Menu not appearing

```bash
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
service rpcd restart
```

### RPC errors

```bash
# Check if script is executable
ls -la /usr/libexec/rpcd/luci.mullvadvpn

# Test RPC manually
ubus call luci.mullvadvpn getTunnels
```

### Server list not loading

```bash
# Check network connectivity
wget -O /tmp/test.json https://api.mullvad.net/public/relays/wireguard/v1/

# Check cache
cat /etc/mullvadvpn/servers.json | head
```

### PBR policies not working

```bash
# Check PBR status
/etc/init.d/pbr status

# View generated policies
uci show pbr | grep mvpn_
```

## License

MIT License

## Credits

- [OpenWrt](https://openwrt.org/)
- [LuCI](https://github.com/openwrt/luci)
- [Mullvad VPN](https://mullvad.net/)
- [PBR](https://docs.openwrt.melmac.ca/pbr/)
