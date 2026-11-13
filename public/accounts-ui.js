import * as Ledger from './ledger.js';
import { parseCents } from './model.js';
import { cloudConfig } from './cloud-config.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stampLabel = value => new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
const decimal = value => (value / 100).toFixed(2).replace('.', ',');
const instantInput = value => {
  const date = new Date(value), local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 23);
};

export function accountsMarkup(state, money, { full = false, accountFilter = '', page = 0 } = {}) {
  const accounts = state.accounts.filter(account => full && accountFilter ? account.id === accountFilter : full || !account.archived);
  const active = state.accounts.filter(account => !account.archived);
  const movements = state.transactions.filter(item => !accountFilter || item.accountId === accountFilter).slice().reverse();
  const pages = Math.max(1, Math.ceil(movements.length / 20));
  page = Math.max(0, Math.min(page, pages - 1));
  const visible = full ? movements.slice(page * 20, page * 20 + 20) : movements.slice(0, 5);
  return `<section class="panel accounts-panel" aria-labelledby="accounts-title"><div class="section-top"><div><h2 id="accounts-title">I miei conti</h2><p>Ogni spesa aggiorna solo il conto a cui appartiene.</p></div>${full ? '' : '<button class="button secondary" data-ledger="new-account">Aggiungi conto</button>'}</div>
  <div class="accounts-total"><div><p class="panel-label">Totale dei conti</p><strong>${money(Ledger.totalBalance(state))}</strong></div><p>${active.length} ${active.length === 1 ? 'conto incluso' : 'conti inclusi'} · EUR<br>Saldo stimato dai movimenti registrati</p></div>
  ${accounts.length ? `<div class="account-grid">${accounts.map(account => `<article class="account-card ${account.archived ? 'archived' : ''}"><div class="account-card-title"><h3>${esc(account.name)}</h3><span>${account.archived ? 'Escluso dal totale' : 'EUR'}</span></div><p class="account-value">${money(Ledger.accountBalance(state, account.id))}</p><p class="account-checkpoint">Saldo verificato il ${stampLabel(account.openingAt)}</p><div class="account-card-actions"><button class="button secondary" data-ledger="edit-account" data-id="${account.id}">Gestisci</button>${account.archived ? '' : `<button class="button plain" data-ledger="wallet" data-id="${account.id}">Collega Apple Pay</button>`}</div></article>`).join('')}</div>` : `<div class="accounts-empty"><h3>Aggiungi il tuo primo conto o attività</h3><p>Inserisci il saldo esatto di Fineco, Revolut o di un’attività con un nome a tua scelta. Il totale si calcola da solo.</p></div>`}
  <p class="accounts-caption">Il totale dei conti è separato dallo storico dei saldi mensili. Aggiungi manualmente entrate, bonifici e spese che non arrivano da Apple Pay. Per ora i conti sono in euro.</p>${full ? '' : '<a class="button plain" href="#conti">Conti e tutti i movimenti →</a>'}</section>
  <section class="panel movements-panel" aria-labelledby="movements-title"><div class="section-top"><div><h2 id="movements-title">${full ? 'Movimenti' : 'Ultimi movimenti'}</h2><p>Spese, entrate e pagamenti Apple Pay.</p></div><button class="button secondary" data-ledger="new-movement" ${active.length ? '' : 'disabled'}>Aggiungi movimento</button></div>
  ${full ? `<label for="movement-filter">Filtra per conto</label><select id="movement-filter"><option value="">Tutti i conti</option>${state.accounts.map(account => `<option value="${account.id}" ${accountFilter === account.id ? 'selected' : ''}>${esc(account.name)}</option>`).join('')}</select>` : ''}
  ${visible.length ? `<div class="movement-list">${visible.map(item => {
    const account = state.accounts.find(account => account.id === item.accountId), included = item.occurredAt > account.openingAt;
    return `<article class="movement-row ${item.voided ? 'voided' : ''}"><div><h3>${esc(item.merchant || (item.amountCents < 0 ? 'Spesa' : 'Entrata'))}</h3><p>${esc(account.name)} · ${stampLabel(item.occurredAt)}<br>${item.source === 'apple-pay' ? 'Apple Pay' : 'Manuale'}${item.voided ? ' · Annullato' : !included ? ' · Già compreso nel saldo verificato' : ''}</p></div><div class="movement-amount"><strong class="${item.amountCents < 0 ? 'negative' : 'positive'}">${item.amountCents > 0 ? '+' : ''}${money(item.amountCents)}</strong>${item.voided ? '' : `<button class="edit-button" data-ledger="void-movement" data-id="${item.id}" aria-label="Annulla movimento ${esc(item.merchant)}">Annulla</button>`}</div></article>`;
  }).join('')}</div>` : '<p class="empty-state">Nessun movimento. I pagamenti appariranno qui dopo aver configurato Comandi Rapidi sul tuo iPhone.</p>'}
  ${full && pages > 1 ? `<div class="movement-pagination"><button class="button secondary" data-ledger="previous-page" ${page ? '' : 'disabled'}>Precedenti</button><span>${page + 1} / ${pages}</span><button class="button secondary" data-ledger="next-page" ${page < pages - 1 ? '' : 'disabled'}>Successivi</button></div>` : ''}</section>`;
}

export function createAccountsUi({ getState, getOwner, money, persist, render, toast, confirmAction, walletLinks, synchronize }) {
  let editing = null, editingRevision = null, walletAccount = null, secret = '', generation = 0;
  let page = 0, previousAccountFilter = null;
  const selectedAccount = () => location.hash.startsWith('#conti/') ? getState().accounts.find(account => account.id === location.hash.slice('#conti/'.length)) || null : null;
  document.body.insertAdjacentHTML('beforeend', `
  <dialog id="bank-account-dialog" aria-labelledby="bank-account-title"><form id="bank-account-form"><div class="dialog-header"><h2 id="bank-account-title">Aggiungi conto</h2><button class="icon-button" type="button" data-close aria-label="Chiudi">×</button></div><label for="bank-name">Nome del conto o attività</label><input id="bank-name" maxlength="60" placeholder="Es. Fineco, Revolut, attività virtuali" required autocomplete="off"><label for="bank-balance">Saldo esatto attuale (€)</label><input id="bank-balance" inputmode="decimal" autocomplete="off" placeholder="0,00" required><p id="bank-balance-help" class="field-help">Inserisci il saldo attuale. Le nuove spese verranno scalate da questo importo.</p><label class="ledger-check" for="bank-reconcile"><input id="bank-reconcile" type="checkbox">Ho verificato il saldo e voglio sostituirlo</label><label class="ledger-check" for="bank-archived"><input id="bank-archived" type="checkbox">Escludi questo conto dal totale</label><p id="bank-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" data-close>Annulla</button><button class="button primary" type="submit">Salva conto</button></div></form></dialog>
  <dialog id="movement-dialog" aria-labelledby="movement-title"><form id="movement-form"><div class="dialog-header"><h2 id="movement-title">Aggiungi movimento</h2><button class="icon-button" type="button" data-close aria-label="Chiudi">×</button></div><label for="movement-account">Conto</label><select id="movement-account" required></select><label for="movement-kind">Tipo</label><select id="movement-kind"><option value="expense">Uscita</option><option value="income">Entrata / rimborso</option></select><label for="movement-amount">Importo (€)</label><input id="movement-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" required><label for="movement-merchant">Descrizione</label><input id="movement-merchant" maxlength="140" placeholder="Es. supermercato" required><label for="movement-date">Data e ora</label><input id="movement-date" type="datetime-local" step="0.001" required><p class="field-help">I movimenti precedenti al saldo verificato restano nello storico e non vengono sottratti di nuovo. Per un trasferimento fra tuoi conti registra un’uscita e un’entrata dello stesso importo.</p><p id="movement-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" data-close>Annulla</button><button class="button primary" type="submit">Salva movimento</button></div></form></dialog>
  <dialog id="wallet-dialog" aria-labelledby="wallet-title"><div class="dialog-header"><h2 id="wallet-title">Collega Apple Pay</h2><button class="icon-button" type="button" data-close aria-label="Chiudi">×</button></div><div id="wallet-content"></div></dialog>`);
  const $ = selector => document.querySelector(selector);
  const ownerIs = owner => owner && owner === getOwner();
  function reset() { generation++; secret = ''; walletAccount = null; editing = null; previousAccountFilter = null; page = 0; $('#wallet-content').replaceChildren(); }
  $('#wallet-dialog').addEventListener('close', () => { generation++; secret = ''; walletAccount = null; $('#wallet-content').replaceChildren(); });
  $('#bank-account-dialog').addEventListener('close', () => { editing = null; $('#bank-account-form').reset(); });
  $('#movement-dialog').addEventListener('close', () => $('#movement-form').reset());
  function openAccount(id = null) {
    editing = id ? getState().accounts.find(account => account.id === id) : null;
    editingRevision = getState().revision;
    $('#bank-account-form').reset(); $('#bank-error').textContent = '';
    $('#bank-account-title').textContent = editing ? `Gestisci ${editing.name}` : 'Aggiungi conto';
    $('#bank-name').value = editing?.name || '';
    $('#bank-balance').value = editing ? decimal(Ledger.accountBalance(getState(), id)) : '';
    $('#bank-balance').readOnly = Boolean(editing);
    $('#bank-reconcile').closest('label').hidden = !editing;
    $('#bank-archived').closest('label').hidden = !editing;
    $('#bank-archived').checked = editing?.archived || false;
    $('#bank-balance-help').textContent = editing ? 'Per correggere il saldo, seleziona “Ho verificato il saldo”. I vecchi movimenti restano nello storico e saranno già compresi nel nuovo saldo.' : 'Inserisci il saldo attuale. Le nuove spese verranno scalate da questo importo.';
    $('#bank-account-dialog').showModal(); $('#bank-name').focus();
  }
  $('#bank-reconcile').addEventListener('change', () => { $('#bank-balance').readOnly = !$('#bank-reconcile').checked; if ($('#bank-reconcile').checked) $('#bank-balance').focus(); });
  $('#bank-account-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      if (getState().revision !== editingRevision) throw new Error('I dati sono cambiati. Chiudi e riapri il conto prima di salvare.');
      const reconcile = !editing || $('#bank-reconcile').checked;
      const account = { id: editing?.id || crypto.randomUUID(), name: $('#bank-name').value.trim(), openingCents: reconcile ? parseCents($('#bank-balance').value) : editing.openingCents, openingAt: reconcile ? new Date().toISOString() : editing.openingAt, currency: 'EUR', archived: $('#bank-archived').checked };
      await persist(Ledger.setAccount(getState(), account)); $('#bank-account-dialog').close(); toast('Conto salvato. Il totale è aggiornato.');
    } catch (error) { $('#bank-error').textContent = error.message; } finally { button.disabled = false; }
  });
  $('#movement-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      const amount = parseCents($('#movement-amount').value), date = new Date($('#movement-date').value);
      if (amount <= 0) throw new Error('Inserisci un importo positivo e scegli Entrata o Uscita.');
      if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) throw new Error('Scegli una data e un’ora valide, non future.');
      const item = { id: crypto.randomUUID(), accountId: $('#movement-account').value, amountCents: ($('#movement-kind').value === 'expense' ? -1 : 1) * amount, occurredAt: date.toISOString(), merchant: $('#movement-merchant').value.trim(), source: 'manual', voided: false };
      await persist(Ledger.addTransaction(getState(), item)); $('#movement-dialog').close(); toast('Movimento salvato sul conto selezionato.');
    } catch (error) { $('#movement-error').textContent = error.message; } finally { button.disabled = false; }
  });
  function walletMarkup(active) {
    const account = getState().accounts.find(item => item.id === walletAccount);
    if (!account) return '';
    return `<p>Conto: <strong>${esc(account.name)}</strong>. In Comandi Rapidi seleziona soltanto la carta di questo conto.</p><p class="wallet-status">${active ? 'Codice di collegamento attivo. L’automazione va configurata sul tuo iPhone.' : 'Collegamento da configurare sul tuo iPhone.'}</p>
    <ol class="wallet-steps"><li><strong>Crea il codice per questo conto.</strong><p>Consente solo di inviare spese a ${esc(account.name)}. Viene mostrato una volta; puoi revocarlo qui.</p><button class="button primary" data-ledger="create-code">${active ? 'Genera nuovo codice' : 'Genera codice'}</button>${active ? ' <button class="button secondary" data-ledger="revoke-code">Revoca codice</button>' : ''}${secret ? `<label for="wallet-secret">Codice da copiare in Comandi Rapidi</label><input id="wallet-secret" type="password" readonly autocomplete="off" value="${esc(secret)}"><button class="button secondary" data-ledger="copy-code">Copia codice</button><p class="field-help">Un nuovo codice disattiva il precedente. Chiudendo questa finestra non potrai rivederlo.</p>` : ''}</li>
    <li><strong>Crea l’automazione.</strong><p>Su iPhone apri Comandi Rapidi → Automazione → + → Transazione / Wallet. Seleziona solo la carta di ${esc(account.name)}, tutte le categorie ed “Esegui immediatamente”. Crea un’automazione vuota. Mantieni una sola automazione per questa carta, per evitare doppie registrazioni.</p></li>
    <li><strong>Prepara i dati del pagamento.</strong><p>Dall’input dell’automazione usa Importo ed Esercente. Usa una condizione “Se” per inviare solo importi con valuta EUR; se la valuta non è disponibile nell’input, chiedi conferma dell’importo in euro prima dell’invio. Formatta l’importo con 2 decimali e senza separatore delle migliaia. Aggiungi “Data attuale” e “Formatta data” in formato ISO 8601. Aggiungi “Numero casuale” da 0 a 1000000000 e un Testo con data formattata, un trattino e numero casuale: sarà l’identificativo del pagamento.</p></li>
    <li><strong>Invia a Flowly.</strong><p>Aggiungi “Ottieni contenuti dell’URL”, scegli POST, corpo JSON e inserisci i campi qui sotto. Conserva lo stesso identificativo, la stessa data e gli stessi dati se ritenti un invio fallito.</p>
    <label for="wallet-endpoint">URL</label><input id="wallet-endpoint" readonly value="${esc(cloudConfig.url + '/rest/v1/rpc/conto_wallet_ingest')}"><button class="button secondary" data-ledger="copy-url">Copia URL</button>
    <label for="wallet-apikey">Intestazione apikey</label><input id="wallet-apikey" readonly value="${esc(cloudConfig.publishableKey)}"><p class="field-help">Aggiungi anche Content-Type: application/json. Questa apikey è pubblica: il codice del conto autorizza l’invio.</p>
    <div class="table-scroll"><table class="wallet-fields"><thead><tr><th>Campo JSON (Testo)</th><th>Valore</th></tr></thead><tbody><tr><td>p_token</td><td>Il codice generato per ${esc(account.name)}</td></tr><tr><td>p_event_id</td><td>Testo data-numero casuale</td></tr><tr><td>p_amount</td><td>Importo senza separatore delle migliaia, es. 12,50</td></tr><tr><td>p_merchant</td><td>Esercente dell’input</td></tr><tr><td>p_currency</td><td>Valuta dell’importo: deve essere EUR. Se manca, chiedi conferma prima di inviare.</td></tr><tr><td>p_occurred_at</td><td>Data attuale formattata ISO 8601</td></tr></tbody></table></div><button class="button secondary" data-ledger="copy-template" ${secret ? '' : 'disabled'}>Copia modello JSON</button></li>
    <li><strong>Controlla il primo pagamento.</strong><p>La risposta deve contenere status “ok” oppure “duplicate”. Configura una notifica in Comandi Rapidi per gli errori di invio. Fai un piccolo acquisto in euro e verifica importo e conto in Flowly. Il ricevimento funziona anche con Flowly chiusa e con il Mac spento; Comandi Rapidi deve avere internet.</p></li></ol>
    <p class="accounts-caption">Questa automazione registra i nuovi pagamenti compatibili al POS. Non importa lo storico, bonifici o spese con carta fisica. Il funzionamento dipende da iOS e dalla carta e va verificato sul tuo telefono. I pagamenti in altre valute vanno registrati manualmente in euro. Non cancellare la stessa spesa su Wallet: qui viene soltanto registrata.</p><p id="wallet-error" class="form-error" role="alert"></p>`;
  }
  async function showWallet(id) {
    walletAccount = id; secret = ''; const run = ++generation, owner = getOwner();
    $('#wallet-content').innerHTML = '<p>Controllo il collegamento…</p>'; $('#wallet-dialog').showModal();
    try {
      const result = await walletLinks('list');
      if (run === generation && ownerIs(owner)) $('#wallet-content').innerHTML = walletMarkup(result.links.some(link => link.accountId === id));
    } catch (error) { if (run === generation && ownerIs(owner)) $('#wallet-content').innerHTML = `<p class="form-error">${esc(error.message)}</p><p>Connettiti a internet e sincronizza il conto prima di collegare Apple Pay.</p>`; }
  }
  document.addEventListener('change', event => { if (event.target.id === 'movement-filter') { page = 0; location.hash = event.target.value ? 'conti/' + event.target.value : 'conti'; } });
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-ledger]'); if (!button || !getOwner()) return;
    const action = button.dataset.ledger, id = button.dataset.id;
    try {
      if (action === 'new-account' || action === 'edit-account') openAccount(id);
      if (action === 'new-movement') {
        const active = getState().accounts.filter(account => !account.archived);
        if (!active.length) throw new Error('Aggiungi prima un conto.');
        $('#movement-form').reset(); $('#movement-error').textContent = '';
        $('#movement-account').innerHTML = active.map(account => `<option value="${account.id}">${esc(account.name)}</option>`).join('');
        const selected = selectedAccount();
        if (selected && !selected.archived) $('#movement-account').value = selected.id;
        $('#movement-date').value = instantInput(new Date().toISOString());
        $('#movement-dialog').showModal(); $('#movement-amount').focus();
      }
      if (action === 'void-movement') {
        const item = getState().transactions.find(item => item.id === id);
        if (item && await confirmAction('Annullare questo movimento?', `${item.merchant} · ${money(item.amountCents)}. Resterà nello storico come annullato e non influirà sul saldo.`, 'Annulla movimento')) { await persist(Ledger.voidTransaction(getState(), id)); toast('Movimento annullato.'); }
      }
      if (action === 'previous-page' || action === 'next-page') { page = Math.max(0, page + (action === 'next-page' ? 1 : -1)); render(); }
      if (action === 'wallet') await showWallet(id);
      if (action === 'create-code' || action === 'revoke-code') {
        const owner = getOwner(), accountId = walletAccount, run = generation;
        if (!accountId) return;
        if (!await confirmAction(action === 'create-code' ? 'Generare un codice per questo conto?' : 'Revocare il collegamento?', action === 'create-code' ? 'Il codice precedente sarà disattivato. Inserisci il nuovo codice nell’automazione della carta corretta.' : 'Le spese inviate con questo codice non saranno più accettate.', action === 'create-code' ? 'Genera codice' : 'Revoca')) return;
        button.disabled = true;
        if (action === 'create-code') { await synchronize(); if (run !== generation || !ownerIs(owner)) return; }
        const result = await walletLinks(action === 'create-code' ? 'create' : 'revoke', accountId);
        if (run !== generation || !ownerIs(owner)) return;
        secret = result.token || ''; $('#wallet-content').innerHTML = walletMarkup(result.links.some(link => link.accountId === accountId));
        ($('#wallet-secret') || $('#wallet-dialog').querySelector('button')).focus();
        toast(action === 'create-code' ? 'Codice generato. Configura ora Comandi Rapidi.' : 'Codice revocato.');
      }
      if (['copy-code', 'copy-url', 'copy-template'].includes(action)) {
        if (!navigator.clipboard?.writeText) throw new Error('La copia non è disponibile. Tieni premuto il campo e copia il testo.');
        const value = action === 'copy-code' ? secret : action === 'copy-url' ? cloudConfig.url + '/rest/v1/rpc/conto_wallet_ingest' : JSON.stringify({ p_token: secret, p_event_id: 'SOSTITUISCI_CON_DATA_E_NUMERO_CASUALE', p_amount: 'SOSTITUISCI_CON_IMPORTO', p_merchant: 'SOSTITUISCI_CON_ESERCENTE', p_currency: 'SOSTITUISCI_CON_VALUTA_VERIFICATA_EUR', p_occurred_at: 'SOSTITUISCI_CON_DATA_ISO_8601' }, null, 2);
        await navigator.clipboard.writeText(value); toast('Copiato.');
      }
    } catch (error) { if ($('#wallet-dialog').open && $('#wallet-error')) $('#wallet-error').textContent = error.message; else toast(error.message, true); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  return {
    reset, selectedAccount,
    sidebarMarkup: () => getState().accounts.length ? getState().accounts.map(account => `<li><a href="#conti/${account.id}" class="sidebar-account-link ${selectedAccount()?.id === account.id ? 'active' : ''}" ${selectedAccount()?.id === account.id ? 'aria-current="page"' : ''} title="${esc(account.name)}"><span class="sidebar-account-initial" aria-hidden="true">${esc([...account.name][0].toLocaleUpperCase('it-IT'))}</span><span class="sidebar-account-name">${esc(account.name)}${account.archived ? '<small>Escluso dal totale</small>' : ''}</span></a></li>`).join('') : '<li class="sidebar-accounts-empty">Aggiungi il tuo primo conto o attività.</li>',
    markup: full => {
      const accountFilter = full ? selectedAccount()?.id || '' : '';
      if (accountFilter !== previousAccountFilter) { page = 0; previousAccountFilter = accountFilter; }
      return accountsMarkup(getState(), money, { full, accountFilter, page });
    }
  };
}
