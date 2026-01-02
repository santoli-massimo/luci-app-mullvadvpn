'use strict';
'require view';
'require dom';
'require ui';
'require rpc';
'require form';

/*
 * WIZARD.JS - Setup iniziale del primo tunnel
 *
 * Questa view viene mostrata quando l'utente accede all'app
 * e non ha ancora configurato alcun tunnel.
 *
 * Flow:
 * 1. Mostra lista interfacce WireGuard disponibili
 * 2. L'utente seleziona un'interfaccia
 * 3. L'utente assegna un nome (label)
 * 4. Click "Crea Tunnel" → createTunnel RPC
 * 5. Redirect a overview
 */

// === DICHIARAZIONI RPC ===
// rpc.declare crea una funzione che chiama il backend

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
	// Chiamato prima di render() per caricare dati async
	load: function() {
		return callGetWireGuardInterfaces();
	},

	// === RENDER ===
	// Costruisce e restituisce l'interfaccia utente
	render: function(data) {
		// Nota: rpc.declare con expect:{interfaces:[]} restituisce
		// direttamente l'array, non l'oggetto wrapper
		var interfaces = Array.isArray(data) ? data : [];

		// Container principale
		var container = E('div', { 'class': 'cbi-section' }, [
			E('h2', {}, _('Mullvad VPN - Setup Wizard')),
			E('div', { 'class': 'cbi-section-descr' },
				_('Welcome! To get started, select a WireGuard interface to use as a VPN tunnel.'))
		]);

		// Se non ci sono interfacce WireGuard, mostra messaggio di errore
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

		// Filtra interfacce non ancora associate a tunnel
		var availableInterfaces = interfaces.filter(function(iface) {
			return !iface.associated_tunnel;
		});

		// Se tutte già associate, vai a overview
		if (availableInterfaces.length === 0) {
			window.location.href = L.url('admin', 'vpn', 'mullvadvpn');
			return E('div', { 'class': 'spinning' }, _('Redirecting to overview...'));
		}

		// Form di selezione interfaccia
		var formContainer = E('div', { 'class': 'cbi-section-node' });

		// Dropdown interfacce
		var interfaceSelect = E('select', {
			'id': 'wg_interface',
			'class': 'cbi-input-select',
			'style': 'min-width: 200px;'
		});

		// Opzione placeholder
		interfaceSelect.appendChild(
			E('option', { 'value': '' }, _('-- Select Interface --'))
		);

		// Aggiungi opzioni per ogni interfaccia disponibile
		availableInterfaces.forEach(function(iface) {
			var label = iface.name;
			if (iface.addresses) {
				label += ' (' + iface.addresses + ')';
			}
			interfaceSelect.appendChild(
				E('option', { 'value': iface.name }, label)
			);
		});

		// Form semplice - solo selezione interfaccia
		// Il nome del tunnel sarà derivato dal server Mullvad selezionato
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

		// Area messaggi
		var messageArea = E('div', { 'id': 'wizard-message', 'style': 'margin: 15px 0;' });
		container.appendChild(messageArea);

		// Pulsante crea tunnel
		var self = this;
		var createButton = E('button', {
			'class': 'cbi-button cbi-button-positive',
			'click': ui.createHandlerFn(this, function() {
				return self.handleCreateTunnel(interfaceSelect, messageArea);
			})
		}, _('Use this Interface'));

		// Pulsante annulla (torna a overview, utile se ci sono già tunnel)
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

	// === HANDLER: Crea Tunnel ===
	handleCreateTunnel: function(interfaceSelect, messageArea) {
		var wgInterface = interfaceSelect.value;

		// Validazione
		if (!wgInterface) {
			this.showMessage(messageArea, 'error',
				_('Please select a WireGuard interface.'));
			return Promise.resolve();
		}

		// Label vuota - sarà derivata dal server Mullvad selezionato
		var label = '';

		// Mostra spinner
		this.showMessage(messageArea, 'info', _('Creating tunnel...'));

		var self = this;
		return callCreateTunnel(label, wgInterface).then(function(result) {
			if (result.success) {
				self.showMessage(messageArea, 'success',
					_('Tunnel created successfully! Redirecting...'));

				// Redirect a overview dopo 1 secondo
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

	// === UTILITY: Mostra messaggio ===
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
