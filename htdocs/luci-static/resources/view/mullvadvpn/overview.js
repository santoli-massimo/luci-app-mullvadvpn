'use strict';
'require form';
'require view';
'require uci';
'require rpc';
'require ui';

/*
 * OVERVIEW.JS - Dashboard principale Mullvad VPN
 *
 * Usa form.Map per integrarsi con il sistema standard di LuCI:
 * - Save & Apply automatico
 * - Tracking modifiche automatico
 * - Nessun bottone custom necessario
 */

// === RPC per dati dinamici (non UCI) ===
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

// Variabili globali per dati dinamici
var onlineHosts = [];
var tunnelChoices = {};
var detectedServers = {}; // Cache per server auto-rilevati

return view.extend({
	load: function() {
		// Prima fase: carica UCI e dati base
		return Promise.all([
			uci.load('mullvadvpn'),
			uci.load('network'),
			callGetOnlineHosts(),
			callGetServers()
		]).then(function(results) {
			// Seconda fase: rileva server per tunnel senza current_server
			var tunnels = uci.sections('mullvadvpn', 'tunnel');
			var detectPromises = [];

			console.log('MVPN DEBUG: Found tunnels:', tunnels.length);

			tunnels.forEach(function(t) {
				var currentServer = uci.get('mullvadvpn', t['.name'], 'current_server');
				console.log('MVPN DEBUG: Tunnel', t['.name'], 'current_server:', currentServer);
				if (!currentServer) {
					console.log('MVPN DEBUG: Calling detectTunnelServer for', t['.name']);
					// Tunnel senza server configurato - prova a rilevarlo dal peer WG
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

			// Aspetta tutte le detection, poi restituisci i risultati originali
			return Promise.all(detectPromises).then(function() {
				return results;
			});
		});
	},

	render: function(data) {
		var self = this;
		onlineHosts = Array.isArray(data[2]) ? data[2] : [];
		var serversCache = data[3];

		// Controlla se ci sono tunnel, altrimenti redirect a wizard
		var tunnels = uci.sections('mullvadvpn', 'tunnel');
		if (tunnels.length === 0) {
			window.location.href = L.url('admin', 'vpn', 'mullvadvpn', 'wizard');
			return E('div', { 'class': 'spinning' }, _('Loading wizard...'));
		}

		// Aggiorna UCI con i server rilevati (per visualizzazione corretta)
		Object.keys(detectedServers).forEach(function(tunnelId) {
			var detected = detectedServers[tunnelId];
			if (detected && detected.country_name) {
				// I dati sono già salvati in UCI dal backend, ricarica per aggiornare cache locale
				uci.unload('mullvadvpn');
			}
		});

		// Ricarica UCI se abbiamo rilevato server
		if (Object.keys(detectedServers).length > 0) {
			return uci.load('mullvadvpn').then(function() {
				return self.renderPage(serversCache);
			});
		}

		return this.renderPage(serversCache);
	},

	renderPage: function(serversCache) {
		var self = this;

		// Rileggi tunnel dopo eventuale reload UCI
		var tunnels = uci.sections('mullvadvpn', 'tunnel');

		// Prepara choices per dropdown tunnel (usa nome paese)
		tunnelChoices = { '': _('-- No VPN --') };
		tunnels.forEach(function(t) {
			var name = t.current_country_name || t.label || t['.name'];
			tunnelChoices[t['.name']] = name;
		});

		// === FORM MAP ===
		var m = new form.Map('mullvadvpn', _('Mullvad VPN'),
			_('Manage VPN tunnels and route devices through them using Policy-Based Routing.'));

		// Salva riferimento per uso nei handler
		this.map = m;

		// === SEZIONE TUNNEL ===
		var s = m.section(form.TableSection, 'tunnel', _('VPN Tunnels'),
			_('Each tunnel is linked to a WireGuard interface.'));
		s.anonymous = true; // Nasconde colonna ID sezione
		s.addremove = false; // Aggiungi tunnel via wizard
		s.sortable = false;

		// Colonna: Country (nome completo)
		var o = s.option(form.DummyValue, '_country', _('Country'));
		o.cfgvalue = function(section_id) {
			var countryName = uci.get('mullvadvpn', section_id, 'current_country_name') || '';
			if (countryName) {
				return countryName;
			}
			return _('Not configured');
		};

		// Colonna: Interfaccia WG
		o = s.option(form.DummyValue, 'wg_interface', _('Interface'));

		// Colonna: Server
		o = s.option(form.DummyValue, 'current_server', _('Server'));
		o.cfgvalue = function(section_id) {
			return uci.get('mullvadvpn', section_id, 'current_server') || _('Not set');
		};

		// Colonna: Enabled
		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		// Colonna: Azioni (cambia server) - usa DummyValue con button custom
		o = s.option(form.DummyValue, '_change_server', _('Server'));
		o.rawhtml = true;
		o.modalonly = false;
		o.cfgvalue = function(section_id) {
			return '<button class="cbi-button cbi-button-action mvpn-change-server" data-tunnel="' + section_id + '">' + _('Change') + '</button>';
		};

		// Colonna: Rimuovi tunnel (solo dalla config app, non elimina interfaccia WG)
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

		// Link per aggiungere tunnel
		s.renderSectionAdd = function() {
			return E('div', { 'class': 'cbi-section-create' }, [
				E('a', {
					'href': L.url('admin', 'vpn', 'mullvadvpn', 'wizard'),
					'class': 'cbi-button cbi-button-add'
				}, _('Add Tunnel'))
			]);
		};

		// === SEZIONE DEVICE ===
		s = m.section(form.TableSection, 'device', _('Devices'),
			_('Assign devices to VPN tunnels. Traffic from the device will be routed through the selected tunnel.'));
		s.anonymous = true; // Nasconde colonna ID sezione
		s.addremove = true;
		s.sortable = false;

		// Override per aggiunta device: mostra dropdown host online
		s.renderSectionAdd = function(extra_class) {
			var el = form.TableSection.prototype.renderSectionAdd.apply(this, [extra_class]);
			return self.renderAddDeviceDropdown();
		};

		// Gestione creazione nuova sezione device
		s.handleAdd = function(ev, name) {
			// name contiene il MAC address selezionato
			if (!name) {
				ui.addNotification(null, E('p', _('Please select a device.')), 'warning');
				return;
			}

			var mac = name;
			var sectionId = 'device_' + mac.toLowerCase().replace(/:/g, '');

			// Trova hostname dall'elenco host online
			var host = onlineHosts.find(function(h) {
				return h.mac.toLowerCase() === mac.toLowerCase();
			});
			var label = host ? (host.hostname || mac) : mac;

			// Crea sezione
			return uci.add('mullvadvpn', 'device', sectionId).then(function() {
				uci.set('mullvadvpn', sectionId, 'mac', mac);
				uci.set('mullvadvpn', sectionId, 'label', label);
				uci.set('mullvadvpn', sectionId, 'tunnel', '');
				uci.set('mullvadvpn', sectionId, 'enabled', '1');
			});
		};

		// Colonna: Nome device (da DHCP, read-only)
		o = s.option(form.DummyValue, 'label', _('Name'));

		// Colonna: MAC
		o = s.option(form.DummyValue, 'mac', _('MAC Address'));

		// Colonna: Tunnel assegnato
		o = s.option(form.ListValue, 'tunnel', _('VPN Tunnel'));
		o.default = '';
		Object.keys(tunnelChoices).forEach(function(key) {
			o.value(key, tunnelChoices[key]);
		});

		// Colonna: Enabled
		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		return m.render();
	},

	// Dropdown per aggiungere device da host online
	renderAddDeviceDropdown: function() {
		var self = this;

		// Filtra host già configurati
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

				// Aggiungi sezione UCI
				uci.add('mullvadvpn', 'device', sectionId);
				uci.set('mullvadvpn', sectionId, 'mac', mac);
				uci.set('mullvadvpn', sectionId, 'label', label);
				uci.set('mullvadvpn', sectionId, 'tunnel', '');
				uci.set('mullvadvpn', sectionId, 'enabled', '1');

				// Salva in staging e ricarica per mostrare nella tabella
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

	// Modal per selezione server Mullvad
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
							// Country è obbligatorio
							if (!countrySelect.value) {
								alert(_('Please select a country.'));
								return;
							}

							var country = countries.find(function(c) { return c.code === countrySelect.value; });
							if (!country || !country.cities || country.cities.length === 0) {
								alert(_('No cities available for this country.'));
								return;
							}

							// Se city non selezionata, usa la prima
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

							// Se server non selezionato, usa il primo
							var hostname = serverSelect.value;
							if (!hostname) {
								hostname = city.relays[0].hostname;
							}

							ui.hideModal();
							callSetTunnelServer(tunnelId, hostname).then(function(result) {
								if (result.success) {
									// Applica modifiche via uci.set() per integrazione con Save & Apply
									return Promise.all([
										uci.load('network'),
										uci.load('mullvadvpn')
									]).then(function() {
										// Trova la sezione peer WireGuard
										var peerSection = null;
										var wgInterface = result.wg_interface;
										uci.sections('network', 'wireguard_' + wgInterface, function(s) {
											if (!peerSection) peerSection = s['.name'];
										});

										if (!peerSection) {
											ui.addNotification(null, E('p', _('WireGuard peer section not found.')), 'error');
											return;
										}

										// Aggiorna peer WireGuard
										console.log('DEBUG: peerSection =', peerSection);
										console.log('DEBUG: result.country_name =', result.country_name);
										uci.set('network', peerSection, 'public_key', result.public_key);
										uci.set('network', peerSection, 'endpoint_host', result.endpoint_host);
										uci.set('network', peerSection, 'endpoint_port', result.endpoint_port);
										console.log('DEBUG: about to set description');
										uci.set('network', peerSection, 'description', result.country_name);
										console.log('DEBUG: description set done');

										// Aggiorna metadata tunnel
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

			// Pre-seleziona paese/città correnti
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
