'use strict';
'require view';
'require dom';
'require ui';
'require rpc';
'require form';

/*
 * WIZARD.JS - Initial setup of the first tunnel
 *
 * This view is shown when the user opens the app
 * and has not configured any tunnel yet.
 *
 * Flow:
 * 1. Show list of available WireGuard interfaces
 * 2. The user selects an interface
 * 3. The user assigns a name (label)
 * 4. Click "Create Tunnel" → createTunnel RPC
 * 5. Redirect to overview
 */

// === RPC DECLARATIONS ===
// rpc.declare creates a function that calls the backend

var callGetWireGuardInterfaces = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'getWireGuardInterfaces',
	expect: { interfaces: [] }
});

var callCreateTunnel = rpc.declare({
	object: 'luci.mullvadvpn',
	method: 'createTunnel',
	params: ['label', 'wg_interface']
});

return view.extend({
	// === LOAD ===
	// Called before render() to load async data
	load: function() {
		return callGetWireGuardInterfaces();
	},

	// === RENDER ===
	// Builds and returns the user interface
	render: function(data) {
		// Note: rpc.declare with expect:{interfaces:[]} returns
		// the array directly, not the wrapper object
		var interfaces = Array.isArray(data) ? data : [];

		// Main container
		var container = E('div', { 'class': 'cbi-section' }, [
			E('h2', {}, _('Mullvad VPN - Setup Wizard')),
			E('div', { 'class': 'cbi-section-descr' },
				_('Welcome! To get started, select a WireGuard interface to use as a VPN tunnel.'))
		]);

		// If there are no WireGuard interfaces, show an error message
		if (interfaces.length === 0) {
			container.appendChild(
				E('div', { 'class': 'alert-message warning' }, [
					E('h4', {}, _('No WireGuard Interfaces Found')),
					E('p', {},
						_('You need to configure a WireGuard interface first. ' +
						  'Go to Network → Interfaces and create a new interface with protocol "WireGuard VPN".')),
					E('p', {}, [
						E('a', {
							'href': L.url('admin', 'network', 'interface'),
							'class': 'cbi-button cbi-button-action'
						}, _('Go to Network Interfaces'))
					])
				])
			);
			return container;
		}

		// Filter interfaces not yet associated with a tunnel
		var availableInterfaces = interfaces.filter(function(iface) {
			return !iface.associated_tunnel;
		});

		// If all are already associated, go to overview
		if (availableInterfaces.length === 0) {
			window.location.href = L.url('admin', 'vpn', 'mullvadvpn');
			return E('div', { 'class': 'spinning' }, _('Redirecting to overview...'));
		}

		// Interface selection form
		var formContainer = E('div', { 'class': 'cbi-section-node' });

		// Interfaces dropdown
		var interfaceSelect = E('select', {
			'id': 'wg_interface',
			'class': 'cbi-input-select',
			'style': 'min-width: 200px;'
		});

		// Placeholder option
		interfaceSelect.appendChild(
			E('option', { 'value': '' }, _('-- Select Interface --'))
		);

		// Add options for each available interface
		availableInterfaces.forEach(function(iface) {
			var label = iface.name;
			if (iface.addresses) {
				label += ' (' + iface.addresses + ')';
			}
			interfaceSelect.appendChild(
				E('option', { 'value': iface.name }, label)
			);
		});

		// Simple form - interface selection only
		// The tunnel name will be derived from the selected Mullvad server
		formContainer.appendChild(
			E('table', { 'class': 'cbi-section-table' }, [
				E('tr', { 'class': 'cbi-section-table-row' }, [
					E('td', { 'class': 'cbi-value-title', 'style': 'width: 200px;' },
						_('WireGuard Interface')),
					E('td', { 'class': 'cbi-value-field' }, interfaceSelect)
				])
			])
		);

		container.appendChild(formContainer);

		// Message area
		var messageArea = E('div', { 'id': 'wizard-message', 'style': 'margin: 15px 0;' });
		container.appendChild(messageArea);

		// Create tunnel button
		var self = this;
		var createButton = E('button', {
			'class': 'cbi-button cbi-button-positive',
			'click': ui.createHandlerFn(this, function() {
				return self.handleCreateTunnel(interfaceSelect, messageArea);
			})
		}, _('Use this Interface'));

		// Cancel button (goes back to overview, useful if tunnels already exist)
		var cancelButton = E('a', {
			'href': L.url('admin', 'vpn', 'mullvadvpn'),
			'class': 'cbi-button',
			'style': 'margin-left: 10px;'
		}, _('Cancel'));

		container.appendChild(
			E('div', { 'class': 'cbi-page-actions' }, [createButton, cancelButton])
		);

		return container;
	},

	// === HANDLER: Create Tunnel ===
	handleCreateTunnel: function(interfaceSelect, messageArea) {
		var wgInterface = interfaceSelect.value;

		// Validation
		if (!wgInterface) {
			this.showMessage(messageArea, 'error',
				_('Please select a WireGuard interface.'));
			return Promise.resolve();
		}

		// Empty label - will be derived from the selected Mullvad server
		var label = '';

		// Show spinner
		this.showMessage(messageArea, 'info', _('Creating tunnel...'));

		var self = this;
		return callCreateTunnel(label, wgInterface).then(function(result) {
			if (result.success) {
				self.showMessage(messageArea, 'success',
					_('Tunnel created successfully! Redirecting...'));

				// Redirect to overview after 1 second
				setTimeout(function() {
					window.location.href = L.url('admin', 'vpn', 'mullvadvpn');
				}, 1000);
			} else {
				self.showMessage(messageArea, 'error',
					result.error || _('Failed to create tunnel.'));
			}
		}).catch(function(err) {
			self.showMessage(messageArea, 'error',
				_('Error: ') + (err.message || err));
		});
	},

	// === UTILITY: Show message ===
	showMessage: function(container, type, text) {
		var className = 'alert-message ';
		switch (type) {
			case 'error':
				className += 'error';
				break;
			case 'success':
				className += 'success';
				break;
			case 'info':
			default:
				className += 'notice';
		}

		dom.content(container, E('div', { 'class': className }, text));
	}
});
