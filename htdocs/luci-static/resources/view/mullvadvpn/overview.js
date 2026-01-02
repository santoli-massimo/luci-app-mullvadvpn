'use strict';
'require form';
'require view';
'require uci';
'require rpc';
'require ui';

/*
 * OVERVIEW.JS - Main Mullvad VPN dashboard
 *
 * Uses form.Map to integrate with the standard LuCI system:
 * - Automatic Save & Apply
 * - Automatic change tracking
 * - No custom buttons needed
 */

// === RPC for dynamic data (non UCI) ===
var callGetOnlineHosts = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'getOnlineHosts',
	expect: { hosts: [] }
});

var callGetServers = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'getServers',
	expect: { cache_empty: true }
});

var callRefreshServers = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'refreshServers'
});

var callSetTunnelServer = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'setTunnelServer',
	params: ['tunnel_id', 'server_hostname']
});

var callGetServersList = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'getServersList'
});

var callDetectTunnelServer = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'detectTunnelServer',
	params: ['tunnel_id', 'save']
});

var callDeleteTunnel = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'deleteTunnel',
	params: ['tunnel_id']
});

// Global variables for dynamic data
var onlineHosts = [];
var tunnelChoices = {};
var detectedServers = {}; // Cache for auto-detected servers

return view.extend({
	load: function() {
		// First phase: load UCI and base data
		return Promise.all([
			uci.load('mullvadvpn'),
			uci.load('network'),
			callGetOnlineHosts(),
			callGetServers()
		]).then(function(results) {
			// Second phase: detect servers for tunnels without current_server
			var tunnels = uci.sections('mullvadvpn', 'tunnel');
			var detectPromises = [];

			console.log('MVPN DEBUG: Found tunnels:', tunnels.length);

			tunnels.forEach(function(t) {
				var currentServer = uci.get('mullvadvpn', t['.name'], 'current_server');
				console.log('MVPN DEBUG: Tunnel', t['.name'], 'current_server:', currentServer);
				if (!currentServer) {
					console.log('MVPN DEBUG: Calling detectTunnelServer for', t['.name']);
					// Tunnel without a configured server - try to detect it from the WG peer
					detectPromises.push(
						callDetectTunnelServer(t['.name'], true).then(function(result) {
							console.log('MVPN DEBUG: Detection result:', result);
							if (result && result.detected) {
								detectedServers[t['.name']] = result;
							}
							return result;
						}).catch(function(err) {
							console.error('MVPN DEBUG: Detection error:', err);
							return null;
						})
					);
				}
			});

			console.log('MVPN DEBUG: detectPromises count:', detectPromises.length);

			// Wait for all detections, then return the original results
			return Promise.all(detectPromises).then(function() {
				return results;
			});
		});
	},

	render: function(data) {
		var self = this;
		onlineHosts = Array.isArray(data[2]) ? data[2] : [];
		var serversCache = data[3];

		// Check if there are tunnels, otherwise redirect to wizard
		var tunnels = uci.sections('mullvadvpn', 'tunnel');
		if (tunnels.length === 0) {
			window.location.href = L.url('admin', 'vpn', 'mullvadvpn', 'wizard');
			return E('div', { 'class': 'spinning' }, _('Loading wizard...'));
		}

		// Update UCI with the detected servers (for correct display)
		Object.keys(detectedServers).forEach(function(tunnelId) {
			var detected = detectedServers[tunnelId];
			if (detected && detected.country_name) {
				// Data is already saved in UCI by the backend, reload to refresh local cache
				uci.unload('mullvadvpn');
			}
		});

		// Reload UCI if we detected servers
		if (Object.keys(detectedServers).length > 0) {
			return uci.load('mullvadvpn').then(function() {
				return self.renderPage(serversCache);
			});
		}

		return this.renderPage(serversCache);
	},

	renderPage: function(serversCache) {
		var self = this;

		// Re-read tunnels after a possible UCI reload
		var tunnels = uci.sections('mullvadvpn', 'tunnel');

		// Prepare choices for tunnel dropdown (uses country name)
		tunnelChoices = { '': _('-- No VPN --') };
		tunnels.forEach(function(t) {
			var name = t.current_country_name || t.label || t['.name'];
			tunnelChoices[t['.name']] = name;
		});

		// === FORM MAP ===
		var m = new form.Map('mullvadvpn', _('Mullvad VPN'),
			_('Manage VPN tunnels and route devices through them using Policy-Based Routing.'));

		// Save reference for use in handlers
		this.map = m;

		// === TUNNEL SECTION ===
		var s = m.section(form.TableSection, 'tunnel', _('VPN Tunnels'),
			_('Each tunnel is linked to a WireGuard interface.'));
		s.anonymous = true; // Hides section ID column
		s.addremove = false; // Add tunnels via wizard
		s.sortable = false;

		// Column: Country (full name)
		var o = s.option(form.DummyValue, '_country', _('Country'));
		o.cfgvalue = function(section_id) {
			var countryName = uci.get('mullvadvpn', section_id, 'current_country_name') || '';
			if (countryName) {
				return countryName;
			}
			return _('Not configured');
		};

		// Column: WG interface
		o = s.option(form.DummyValue, 'wg_interface', _('Interface'));

		// Column: Server
		o = s.option(form.DummyValue, 'current_server', _('Server'));
		o.cfgvalue = function(section_id) {
			return uci.get('mullvadvpn', section_id, 'current_server') || _('Not set');
		};

		// Column: Enabled
		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		// Column: Actions (change server) - uses DummyValue with a custom button
		o = s.option(form.DummyValue, '_change_server', _('Server'));
		o.rawhtml = true;
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			return '<button class="cbi-button cbi-button-action mvpn-change-server" data-tunnel="' + section_id + '">' + _('Change') + '</button>';
		};

		// Column: Remove tunnel (only from app config, does not delete the WG interface)
		o = s.option(form.DummyValue, '_remove', ' ');
		o.rawhtml = true;
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			return '<button class="cbi-button cbi-button-remove mvpn-remove-tunnel" data-tunnel="' + section_id + '">' + _('Remove') + '</button>';
		};

		// Attach click handlers after render via map's render promise
		var originalRender = m.render.bind(m);
		m.render = function() {
			return originalRender().then(function(node) {
				// Delegated event for buttons
				node.addEventListener('click', function(ev) {
					// Change server button
					var btn = ev.target.closest('.mvpn-change-server');
					if (btn) {
						var tunnelId = btn.getAttribute('data-tunnel');
						self.openServerSelector(tunnelId, serversCache);
						return;
					}

					// Remove tunnel button
					btn = ev.target.closest('.mvpn-remove-tunnel');
					if (btn) {
						var tunnelId = btn.getAttribute('data-tunnel');
						if (confirm(_('Remove this tunnel from the app? The WireGuard interface will not be deleted.'))) {
							callDeleteTunnel(tunnelId).then(function(result) {
								if (result.success) {
									window.location.reload();
								} else {
									ui.addNotification(null, E('p', result.error || _('Failed to remove tunnel.')), 'error');
								}
							});
						}
					}
				});
				return node;
			});
		};

		// Link to add tunnels
		s.renderSectionAdd = function() {
			return E('div', { 'class': 'cbi-section-create' }, [
				E('a', {
					'href': L.url('admin', 'vpn', 'mullvadvpn', 'wizard'),
					'class': 'cbi-button cbi-button-add'
				}, _('Add Tunnel'))
			]);
		};

		// === DEVICE SECTION ===
		s = m.section(form.TableSection, 'device', _('Devices'),
			_('Assign devices to VPN tunnels. Traffic from the device will be routed through the selected tunnel.'));
		s.anonymous = true; // Hides section ID column
		s.addremove = true;
		s.sortable = false;

		// Override for adding devices: shows online hosts dropdown
		s.renderSectionAdd = function(extra_class) {
			var el = form.TableSection.prototype.renderSectionAdd.apply(this, [extra_class]);
			return self.renderAddDeviceDropdown();
		};

		// Handle creation of a new device section
		s.handleAdd = function(ev, name) {
			// name contains the selected MAC address
			if (!name) {
				ui.addNotification(null, E('p', _('Please select a device.')), 'warning');
				return;
			}

			var mac = name;
			var sectionId = 'device_' + mac.toLowerCase().replace(/:/g, '');

			// Find hostname from the online hosts list
			var host = onlineHosts.find(function(h) {
				return h.mac.toLowerCase() === mac.toLowerCase();
			});
			var label = host ? (host.hostname || mac) : mac;

			// Create section
			return uci.add('mullvadvpn', 'device', sectionId).then(function() {
				uci.set('mullvadvpn', sectionId, 'mac', mac);
				uci.set('mullvadvpn', sectionId, 'label', label);
				uci.set('mullvadvpn', sectionId, 'tunnel', '');
				uci.set('mullvadvpn', sectionId, 'enabled', '1');
			});
		};

		// Column: Device name (from DHCP, read-only)
		o = s.option(form.DummyValue, 'label', _('Name'));

		// Column: MAC
		o = s.option(form.DummyValue, 'mac', _('MAC Address'));

		// Column: Assigned tunnel
		o = s.option(form.ListValue, 'tunnel', _('VPN Tunnel'));
		o.default = '';
		Object.keys(tunnelChoices).forEach(function(key) {
			o.value(key, tunnelChoices[key]);
		});

		// Column: Enabled
		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		return m.render();
	},

	// Dropdown to add devices from online hosts
	renderAddDeviceDropdown: function() {
		var self = this;

		// Filter out already configured hosts
		var configuredMacs = [];
		uci.sections('mullvadvpn', 'device', function(s) {
			if (s.mac) configuredMacs.push(s.mac.toLowerCase());
		});

		var availableHosts = onlineHosts.filter(function(host) {
			return configuredMacs.indexOf(host.mac.toLowerCase()) === -1;
		});

		var container = E('div', { 'class': 'cbi-section-create', 'style': 'display: flex; gap: 10px; align-items: center;' });

		var hostSelect = E('select', { 'id': 'new-device-select', 'class': 'cbi-input-select' });
		hostSelect.appendChild(E('option', { 'value': '' }, _('-- Select Device --')));

		availableHosts.forEach(function(host) {
			var label = host.hostname || host.mac;
			if (host.hostname) label += ' (' + host.mac + ')';
			if (host.ip) label += ' - ' + host.ip;
			hostSelect.appendChild(E('option', { 'value': host.mac }, label));
		});

		container.appendChild(hostSelect);

		var addBtn = E('button', {
			'class': 'cbi-button cbi-button-add',
			'click': ui.createHandlerFn(this, function() {
				var mac = hostSelect.value;
				if (!mac) {
					ui.addNotification(null, E('p', _('Please select a device.')), 'warning');
					return Promise.resolve();
				}

				var sectionId = 'device_' + mac.toLowerCase().replace(/:/g, '');
				var host = onlineHosts.find(function(h) {
					return h.mac.toLowerCase() === mac.toLowerCase();
				});
				var label = host ? (host.hostname || mac) : mac;

				// Add UCI section
				uci.add('mullvadvpn', 'device', sectionId);
				uci.set('mullvadvpn', sectionId, 'mac', mac);
				uci.set('mullvadvpn', sectionId, 'label', label);
				uci.set('mullvadvpn', sectionId, 'tunnel', '');
				uci.set('mullvadvpn', sectionId, 'enabled', '1');

				// Save to staging and reload to show in the table
				return uci.save().then(function() {
					window.location.reload();
				});
			})
		}, _('Add Device'));

		container.appendChild(addBtn);

		var refreshBtn = E('button', {
			'class': 'cbi-button',
			'title': _('Refresh online hosts'),
			'click': ui.createHandlerFn(this, function() {
				return callGetOnlineHosts().then(function(hosts) {
					onlineHosts = Array.isArray(hosts) ? hosts : [];
					ui.addNotification(null, E('p', _('Found %d hosts.').format(onlineHosts.length)), 'info');
					window.location.reload();
				});
			})
		}, '↻');

		container.appendChild(refreshBtn);

		return container;
	},

	// Modal for Mullvad server selection
	openServerSelector: function(tunnelId, serversCache) {
		var self = this;

		if (serversCache && serversCache.cache_empty) {
			if (confirm(_('Server list is empty. Download from Mullvad?'))) {
				return callRefreshServers().then(function(result) {
					if (result.success) {
						window.location.reload();
					} else {
						ui.addNotification(null, E('p', result.error || _('Failed to download.')), 'error');
					}
				});
			}
			return Promise.resolve();
		}

		return callGetServersList().then(function(serversData) {
			var countries = [];
			try {
				if (typeof serversData === 'string') {
					serversData = JSON.parse(serversData);
				}
				countries = serversData.countries || [];
			} catch (e) {
				ui.addNotification(null, E('p', _('Failed to parse server list.')), 'error');
				return;
			}

			if (countries.length === 0) {
				ui.addNotification(null, E('p', _('No servers available.')), 'error');
				return;
			}

			var content = E('div', { 'style': 'min-width: 400px;' });

			var countrySelect = E('select', { 'class': 'cbi-input-select', 'style': 'width: 100%; margin-bottom: 10px;' });
			countrySelect.appendChild(E('option', { 'value': '' }, _('-- Select Country --')));
			countries.forEach(function(country) {
				countrySelect.appendChild(E('option', { 'value': country.code }, country.name));
			});

			var citySelect = E('select', { 'class': 'cbi-input-select', 'style': 'width: 100%; margin-bottom: 10px;', 'disabled': true });
			citySelect.appendChild(E('option', { 'value': '' }, _('-- Select City --')));

			var serverSelect = E('select', { 'class': 'cbi-input-select', 'style': 'width: 100%;', 'disabled': true });
			serverSelect.appendChild(E('option', { 'value': '' }, _('-- Select Server --')));

			countrySelect.addEventListener('change', function() {
				citySelect.innerHTML = '';
				serverSelect.innerHTML = '';
				citySelect.appendChild(E('option', { 'value': '' }, _('-- Select City --')));
				serverSelect.appendChild(E('option', { 'value': '' }, _('-- Select Server --')));
				citySelect.disabled = true;
				serverSelect.disabled = true;

				var country = countries.find(function(c) { return c.code === countrySelect.value; });
				if (country && country.cities) {
					country.cities.forEach(function(city) {
						citySelect.appendChild(E('option', { 'value': city.code }, city.name));
					});
					citySelect.disabled = false;
				}
			});

			citySelect.addEventListener('change', function() {
				serverSelect.innerHTML = '';
				serverSelect.appendChild(E('option', { 'value': '' }, _('-- Select Server --')));
				serverSelect.disabled = true;

				var country = countries.find(function(c) { return c.code === countrySelect.value; });
				if (!country) return;
				var city = country.cities.find(function(c) { return c.code === citySelect.value; });
				if (city && city.relays) {
					city.relays.forEach(function(relay) {
						serverSelect.appendChild(E('option', { 'value': relay.hostname }, relay.hostname));
					});
					serverSelect.disabled = false;
				}
			});

			content.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Country')),
				E('div', { 'class': 'cbi-value-field' }, countrySelect)
			]));
			content.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('City')),
				E('div', { 'class': 'cbi-value-field' }, citySelect)
			]));
			content.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Server')),
				E('div', { 'class': 'cbi-value-field' }, serverSelect)
			]));

			var tunnelLabel = uci.get('mullvadvpn', tunnelId, 'label') || tunnelId;

			ui.showModal(_('Select Mullvad Server for "%s"').format(tunnelLabel), [
				content,
				E('div', { 'class': 'right', 'style': 'margin-top: 20px;' }, [
					E('button', {
						'class': 'cbi-button',
						'click': ui.hideModal
					}, _('Cancel')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-positive',
						'click': function() {
							// Country is required
							if (!countrySelect.value) {
								alert(_('Please select a country.'));
								return;
							}

							var country = countries.find(function(c) { return c.code === countrySelect.value; });
							if (!country || !country.cities || country.cities.length === 0) {
								alert(_('No cities available for this country.'));
								return;
							}

							// If no city selected, use the first one
							var city;
							if (citySelect.value) {
								city = country.cities.find(function(c) { return c.code === citySelect.value; });
							} else {
								city = country.cities[0];
							}

							if (!city || !city.relays || city.relays.length === 0) {
								alert(_('No servers available for this city.'));
								return;
							}

							// If no server selected, use the first one
							var hostname = serverSelect.value;
							if (!hostname) {
								hostname = city.relays[0].hostname;
							}

							ui.hideModal();
							callSetTunnelServer(tunnelId, hostname).then(function(result) {
								if (result.success) {
									// Apply changes via uci.set() for Save & Apply integration
									return Promise.all([
										uci.load('network'),
										uci.load('mullvadvpn')
									]).then(function() {
										// Find the WireGuard peer section
										var peerSection = null;
										var wgInterface = result.wg_interface;
										uci.sections('network', 'wireguard_' + wgInterface, function(s) {
											if (!peerSection) peerSection = s['.name'];
										});

										if (!peerSection) {
											ui.addNotification(null, E('p', _('WireGuard peer section not found.')), 'error');
											return;
										}

										// Update WireGuard peer
										console.log('DEBUG: peerSection =', peerSection);
										console.log('DEBUG: result.country_name =', result.country_name);
										uci.set('network', peerSection, 'public_key', result.public_key);
										uci.set('network', peerSection, 'endpoint_host', result.endpoint_host);
										uci.set('network', peerSection, 'endpoint_port', result.endpoint_port);
										console.log('DEBUG: about to set description');
										uci.set('network', peerSection, 'description', result.country_name);
										console.log('DEBUG: description set done');

										// Update tunnel metadata
										uci.set('mullvadvpn', result.tunnel_id, 'current_server', result.server_hostname);
										uci.set('mullvadvpn', result.tunnel_id, 'current_country', result.country_code);
										uci.set('mullvadvpn', result.tunnel_id, 'current_country_name', result.country_name);
										uci.set('mullvadvpn', result.tunnel_id, 'current_city', result.city_code);
										uci.set('mullvadvpn', result.tunnel_id, 'current_city_name', result.city_name);

										return uci.save();
									}).then(function() {
										ui.addNotification(null, E('p', _('Server changed. Click "Save & Apply" to confirm.')), 'info');
										window.location.reload();
									});
								} else {
									ui.addNotification(null, E('p', result.error || _('Failed to change server.')), 'error');
								}
							});
						}
					}, _('Apply'))
				])
			]);

			// Pre-select current country/city
			var currentCountry = uci.get('mullvadvpn', tunnelId, 'current_country');
			var currentCity = uci.get('mullvadvpn', tunnelId, 'current_city');
			if (currentCountry) {
				countrySelect.value = currentCountry;
				countrySelect.dispatchEvent(new Event('change'));
				if (currentCity) {
					setTimeout(function() {
						citySelect.value = currentCity;
						citySelect.dispatchEvent(new Event('change'));
					}, 50);
				}
			}
		});
	}
});
