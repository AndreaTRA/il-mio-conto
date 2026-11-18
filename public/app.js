import * as Model from './model.js';
import { historyChart, allocationMarkup, initializeCharts, chartMarkup, mountCharts, disposeCharts } from './charts.js';
import * as Ledger from './ledger.js';
import * as Storage from './storage.js';
import { initializePwa, checkForAppUpdate, isInstalled } from './pwa.js';
import { cloud, onCloudChange, initializeCloud, sendCode, verifyCode, verifyEmailLink, takeRedirectSession, acceptRedirectSession, session, signIn, requestPasswordRecovery, verifyRecoveryLink, resetPassword, register, requireApproved, manageAccounts, updateProfile, changeEmail } from './cloud.js';
import { samePayload, sameIdentity } from './sync-merge.js';
import { createAuthUi } from './auth-ui.js';
import { createAccountsUi } from './accounts-ui.js';
import { walletLinks } from './cloud.js';
import { createMonthlyUi } from './monthly-ui.js';
import { initializeCalendarUi } from './calendar-ui.js';

const incomingAccess = takeRedirectSession().then(session => ({ session }), error => ({ error }));
// A legacy document retains this flag for the new worker's targeted recovery.
// An updated document removes it immediately so a later release cannot reload
// this page while the user is editing a form.
const startupUrl = new URL(location.href);
if (startupUrl.searchParams.get('aggiorna') === '1') {
  startupUrl.searchParams.delete('aggiorna');
  history.replaceState(null, '', startupUrl.pathname + startupUrl.search + startupUrl.hash);
}
const $ = selector => document.querySelector(selector);
const content = $('#content');
const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const percent = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 1 });
let numbersVisible = false;
let visibilityPreferenceWrite = Promise.resolve();
const concealed = '••••';
const money = value => !numbersVisible ? concealed : value == null ? 'Non disponibile' : euro.format(value / 100);
const pct = value => !numbersVisible ? concealed : value == null ? 'n.d.' : percent.format(value);
const signed = value => !numbersVisible ? concealed : value == null ? 'n.d.' : `${value > 0 ? '+' : ''}${money(value)}`;
const signedRate = value => !numbersVisible ? concealed : value == null ? 'n.d.' : `${value > 0 ? '+' : ''}${pct(value)}`;
const color = value => value == null ? '' : value < 0 ? 'negative' : value > 0 ? 'positive' : '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const monthDate = month => new Date(`${month}-01T12:00:00`);
const monthLabel = month => monthDate(month).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
const shortDate = month => `01/${month.slice(5)}/${month.slice(0, 4)}`;
const asof = month => `1° ${monthLabel(month)}`;
const entryAsOf = entry => entry.verifiedAt ? new Date(entry.verifiedAt).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : asof(entry.month);
const deadlineLabel = () => new Date(`${state.settings.deadline}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const currentMonth = () => {
  const now = new Date(); return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const todayDate = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const dateLabel = date => new Date(date + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const titles = { movimenti: 'Movimenti', panoramica: 'Panoramica', saldi: 'Saldi mensili', obiettivo: 'Obiettivo', notifiche: 'Notifiche', backup: 'Backup e dispositivi', account: 'Account e sicurezza', conti: 'Conti e movimenti' };
const route = () => location.hash.startsWith('#conti/') ? 'conti' : Object.hasOwn(titles, location.hash.slice(1)) ? location.hash.slice(1) : 'panoramica';
let lastAnimatedBalance = null;
let chartMode = 'bar';
let state, tableYear = new Date().getFullYear(), chartYear = String(tableYear), toastTimer;
let pwaStatus = 'preparing', activateUpdate;
let pendingEmail = '';
let accessGranted = false, authReady = false, currentUser = null;
let accountProfile = null, managedUsers = null, usersLoading = false, usersError = '';
let profileSaving = false, emailSaving = false, profileNotice = '', emailNotice = '', accountRefreshing = false;
let planDate = '';
let notificationPage = 0;
const needsGoalSetup = () => Model.requiresGoalSetup(state, accountProfile?.is_admin === true);
let pendingArchiveRefresh = false;
const authUi = createAuthUi({ root: $('#auth-root'), signIn, register, recover: requestPasswordRecovery, verifyLink: verifyRecoveryLink, resetPassword, onAuthenticated: openAuthenticatedArchive });
authUi.show('loading');
const dirtyForms = new Set();
const accountsUi = createAccountsUi({ getState: () => state, getOwner: () => accessGranted ? currentUser?.id : null, money, persist, render, toast, confirmAction, walletLinks,
  synchronize: async () => { await cloud.trigger(); if (cloud.status.phase !== 'synced') throw new Error(cloud.status.error || 'Sincronizza il conto prima di creare il codice.'); state = await Storage.load(); }
});
const monthlyUi = createMonthlyUi({ getState: () => state, getOwner: () => accessGranted ? currentUser?.id : null, money, persist, toast, onSaved: month => { tableYear = Number(month.slice(0, 4)); chartYear = String(tableYear); render(); } });
initializeCalendarUi();
const hasPendingUiEdit = () => Boolean(document.querySelector('dialog[open]') || dirtyForms.size);
setInterval(() => { if (accessGranted && planDate !== todayDate() && !hasPendingUiEdit()) render(); }, 60000);

function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.className = error ? 'error' : ''; node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.hidden = true, error ? 8000 : 4000);
}
function lockAccess() {
  disposeCharts();
  $('#header-balance').replaceChildren(); $('#header-profile-name').textContent = 'Il tuo account';
  accountsUi.reset();
  numbersVisible = false; lastAnimatedBalance = null;
  accessGranted = false; currentUser = null; accountProfile = null; managedUsers = null; $('#app-shell').hidden = true;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  content.replaceChildren(); $('#sidebar-accounts-list').replaceChildren(); dirtyForms.clear();
  if ($('#auth-root').hidden || authUi.mode === 'loading') authUi.show('login');
}
async function openAuthenticatedArchive() {
  const active = await session();
  if (!active) throw new Error('Accedi per aprire il tuo archivio.');
  if (navigator.onLine !== false) {
    try { accountProfile = await requireApproved(); }
    catch (error) { await cloud.logout(); throw error; }
    await Storage.writeMeta('account-access:' + active.user.id, accountProfile);
  } else {
    accountProfile = await Storage.readMeta('account-access:' + active.user.id);
    if (accountProfile?.status !== 'approved') throw new Error('Connettiti a internet per verificare l’accesso.');
  }
  if (cloud.running) await cloud.running;
  await Storage.selectAccount({ projectUrl: active.projectUrl, userId: active.user.id }, { claimLegacy: accountProfile.is_admin });
  state = await Storage.load(); currentUser = { ...active.user, ...(accountProfile.email ? { email: accountProfile.email, username: accountProfile.username } : {}) };
  managedUsers = null; usersError = '';
  authUi.message('Accesso riuscito. Sincronizzo i tuoi dati…');
  await cloud.initialize({ autoLink: true });
  if (!await session()) throw new Error(cloud.status.error || 'Accedi di nuovo per aprire il tuo archivio.');
  state = await Storage.load();
  await visibilityPreferenceWrite;
  numbersVisible = (await Storage.readMeta('numbers-visible:' + active.user.id)) === true;
  accessGranted = true;
  authUi.hide(); $('#app-shell').hidden = false;
  history.replaceState(null, '', location.pathname + location.search + '#panoramica');
  render(); setStatus();
}
function setStatus() {
  const badge = $('#connection');
  const phase = cloud.status.phase;
  const syncLabels = { syncing: 'Sincronizzazione…', synced: 'Sincronizzato', pending: 'Modifiche in attesa', conflict: 'Valori da verificare', error: 'Sincronizzazione interrotta', 'update-required': 'Aggiornamento necessario' };
  const label = !navigator.onLine ? 'Offline · invio in attesa' : syncLabels[phase] || 'Online · collegamento account';
  badge.textContent = label;
  badge.dataset.shortLabel = !navigator.onLine ? 'Offline' : ({syncing:'Sincronizzo…',synced:'Sincronizzato',pending:'In attesa',conflict:'Da verificare',error:'Da sincronizzare','update-required':'Da aggiornare'}[phase] || 'Collegamento…');
  badge.setAttribute('aria-label', label + '. Apri dettagli sincronizzazione');
  badge.title = label;
  badge.classList.toggle('offline', !navigator.onLine || ['pending', 'conflict', 'error', 'update-required'].includes(phase));
  const syncNotice = $('#sync-notice');
  syncNotice.hidden = !['conflict', 'error', 'update-required'].includes(phase);
  if (!syncNotice.hidden) syncNotice.innerHTML = phase === 'update-required' ? 'Aggiorna Flowly su questo dispositivo per leggere i conti sincronizzati. I dati sono conservati.' : phase === 'conflict' ? 'Ci sono dati da confrontare. <a class="button plain" href="#backup">Controlla la sincronizzazione →</a>' : 'La sincronizzazione richiede attenzione. <a class="button plain" href="#backup">Vedi dettagli →</a>';
  if (phase === 'update-required') { $('#update-message').textContent = 'Aggiornamento necessario per sincronizzare i tuoi conti. I dati restano conservati.'; $('#update-banner').hidden = false; }
  const banner = $('#offline-banner'); banner.hidden = navigator.onLine;
  banner.textContent = state?.sync ? 'Sei offline. I saldi restano sul dispositivo e saranno sincronizzati quando l’app torna online.' : 'Sei offline. Puoi continuare a registrare saldi e note su questo dispositivo.';
  $('#saved-state').textContent = state?.updatedAt
    ? `Salvato sul dispositivo · ${new Date(state.updatedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Dati salvati su questo dispositivo';
}
async function persist(next) {
  try { state = await Storage.save(next, state.revision); }
  catch (error) { if (error.current) { state = error.current; if (!dirtyForms.has('goal-form')) render(); } throw error; }
  render(); setStatus();
  cloud.trigger();
}
const addButton = () => '<button class="button primary" data-action="add"><span class="plus" aria-hidden="true">+</span> Verifica saldi</button>';
function heading(eyebrow, title, description, action = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function neededNote(summary) {
  const plan = summary.plan;
  if (needsGoalSetup()) return 'Imposta importo e scadenza per calcolare il piano.';
  if (plan.balanceCents === null) return 'Aggiungi un saldo riferito a oggi o a un mese precedente.';
  if (plan.missingCents === 0) return 'Obiettivo raggiunto con l’ultimo saldo disponibile.';
  if (plan.deadlinePassed) return 'Scadenza superata. Puoi scegliere una nuova data.';
  if (plan.monthsLeft === 0) return 'La scadenza è questo mese: non restano mesi futuri per i versamenti. Scegli una scadenza successiva.';
  return `${plan.monthsLeft} versamenti, da ${monthLabel(Model.shiftMonth(plan.today.slice(0, 7), 1))}.`;
}
function statsMarkup(summary) {
  const growth = summary.yearGrowth;
  return `<div class="metrics">
    <div class="metric"><p class="metric-label">Dall’inizio dell’anno</p><p class="metric-value ${color(growth.changeCents)}">${signed(growth.changeCents)}</p><p class="metric-note">${growth.baseline ? `Rispetto a gennaio ${growth.year} · ${signedRate(growth.rate)}<br>Saldo iniziale: ${money(growth.baseline.balanceCents)}` : `Registra il saldo di gennaio ${growth.year} per il confronto.`}</p></div>
    <div class="metric"><p class="metric-label">Variazione ultimo mese</p><p class="metric-value ${color(summary.change)}">${signed(summary.change)}</p><p class="metric-note">${summary.change !== null ? `${signedRate(summary.rate)} rispetto al mese precedente` : 'Occorrono due mesi consecutivi.'}</p></div>
    <div class="metric">${numbersVisible && summary.recorded.length > 1 ? chartMarkup('spark','Mini andamento dei saldi verificati') : ''}<p class="metric-label">Variazione media mensile</p><p class="metric-value ${color(summary.averageMonthlyChange)}">${signed(summary.averageMonthlyChange)}<span class="subtle"> / mese</span></p><p class="metric-note">${summary.elapsedMonths ? `Dal ${entryAsOf(summary.first)} al ${entryAsOf(summary.last)}, su ${summary.elapsedMonths} mesi.` : 'Aggiungi almeno due saldi per calcolare la media.'}</p></div>
  </div>`;
}
function goalPanel(summary) {
  return `<section class="panel goal-panel" aria-labelledby="goal-card-title"><div class="goal-top"><p class="panel-label" id="goal-card-title">Obiettivo al ${state.settings.deadline.slice(0, 4)}</p><p class="goal-remaining">${summary.gap === null ? '<span>Da calcolare</span>Inserisci un saldo' : summary.gap === 0 ? 'Obiettivo raggiunto' : `<span>Mancano</span>${money(summary.gap)}`}</p><p class="goal-target">Obiettivo: <strong>${money(state.settings.targetCents)}</strong></p></div><div>
    <div class="goal-progress"><span>Quota raggiunta</span><strong>${summary.progress === null ? 'n.d.' : pct(summary.progress)}</strong></div>
    <progress max="100" value="${Math.max(0, Math.min(100, (numbersVisible ? summary.progress || 0 : 0) * 100))}" aria-label="Percentuale dell’obiettivo raggiunta"></progress>
    <p class="goal-note">${deadlineLabel()} · <a href="#obiettivo">Gestisci obiettivo ↗</a></p></div></section>`;
}
function savingsPanel(summary) {
  const plan = summary.plan;
  return `<section class="panel savings-panel" aria-labelledby="savings-card-title"><p class="panel-label" id="savings-card-title">Da mettere da parte</p><p class="savings-value">${money(plan.monthlyCents)}<span> / mese</span></p><p class="savings-detail">${neededNote(summary)}</p><p class="savings-basis">Calcolo al ${dateLabel(plan.today)}${plan.usesAccounts ? '<br>Riferimento: totale aggiornato dei conti' : plan.last ? `<br>Saldo di riferimento: ${entryAsOf(plan.last)}` : ''}. Nessun rendimento ipotizzato.</p></section>`;
}
function row(entry, withNotes = false) {
  const delta = Model.deltaFor(state, entry.month);
  const previous = Model.monthIndex(entry.month) > 12 ? Model.entryFor(state, Model.shiftMonth(entry.month, -1)) : null;
  const rate = delta !== null && previous?.balanceCents > 0 ? delta / previous.balanceCents : null;
  return `<tr><td><span class="table-month">${esc(monthLabel(entry.month))}</span><span class="table-date">${entry.verifiedAt ? new Date(entry.verifiedAt).toLocaleDateString('it-IT') : shortDate(entry.month)}</span></td>
    <td class="amount ${entry.balanceCents === null ? 'missing' : ''}">${entry.balanceCents === null ? '<span aria-label="Saldo non inserito">Da inserire</span>' : money(entry.balanceCents)}</td>
    <td class="amount ${color(delta)}">${signed(delta)}${withNotes ? `<span class="table-date ${color(delta)}">${delta === null ? '' : signedRate(rate)}</span>` : ''}</td>
    ${withNotes ? `<td><span class="row-note" title="${esc(entry.note)}">${esc(entry.note) || 'Nessuna nota'}</span></td>` : ''}
    <td class="amount"><button class="edit-button" data-edit="${entry.month}">${entry.balanceCents === null ? 'Inserisci' : 'Modifica'}<span class="sr-only"> ${esc(monthLabel(entry.month))}</span></button></td></tr>`;
}
function monthlyTable(entries, notes = false) {
  return `<div class="table-scroll"><table><thead><tr><th scope="col">Mese</th><th scope="col" class="amount">Saldo verificato</th><th scope="col" class="amount">Variazione</th>${notes ? '<th scope="col">Nota</th>' : ''}<th scope="col" class="amount"><span class="sr-only">Azioni</span></th></tr></thead><tbody>${entries.map(entry => row(entry, notes)).join('')}</tbody></table></div>`;
}
function availableYears() {
  return [...new Set([new Date().getFullYear(), ...state.entries.map(entry => Number(entry.month.slice(0, 4))), Number(tableYear)])].sort((a, b) => a - b);
}
function periodSelect({primary=false}={}) {
  const year=primary && chartYear==='all' ? String(tableYear) : chartYear;
  return `<label class="sr-only" for="chart-year">Periodo del grafico</label><select id="chart-year" class="filter">${availableYears().map(y=>`<option value="${y}" ${year===String(y)?'selected':''}>${y}</option>`).join('')}${primary?'':`<option value="all" ${chartYear==='all'?'selected':''}>Tutto lo storico</option>`}</select>`;
}
function chart(summary, {primary=false}={}) {
  const mode=primary?chartMode:'line';
  return `<section class="panel chart-panel ${primary?'host-cashflows':'history-panel'}"><div class="section-top"><div><h2>${primary?'Patrimonio mensile':'Andamento nel tempo'}</h2>${primary?'': '<p>Saldi verificati. I mesi mancanti interrompono la linea.</p>'}</div><div class="chart-controls">${primary?`<span class="chart-key ${mode==='line'?'is-line':''}"><i></i> Saldo verificato</span><div class="segmented" role="group" aria-label="Tipo di grafico"><button type="button" data-chart-mode="bar" aria-pressed="${mode==='bar'}">Colonne</button><button type="button" data-chart-mode="line" aria-pressed="${mode==='line'}">Linea</button></div>`:route()==='panoramica'?'':periodSelect()}</div></div>${historyChart({visible:numbersVisible,mode,primary})}${primary?'<p class="chart-footnote">Le tracce scure indicano la scala del grafico. Un mese vuoto non vale zero.</p>':''}</section>`;
}
function dashboardAccounts() {
  const active=state.accounts.filter(a=>!a.archived);
  return `<section class="panel host-accounts"><div class="section-top"><h2>I tuoi conti</h2><a href="#conti" class="panel-more" aria-label="Apri tutti i conti">···</a></div><div class="host-account-list">${active.slice(0,3).map((a,i)=>`<a class="host-account" href="#conti/${a.id}"><span class="bank-avatar tone-${i%4}" aria-hidden="true">${esc([...a.name][0].toLocaleUpperCase('it-IT'))}</span><div><strong>${esc(a.name)}</strong><small>Conto in euro</small><span class="account-status">Incluso nel totale</span></div><b>${money(Ledger.accountBalance(state,a.id))}</b></a>`).join('') || '<div class="compact-empty"><p>Il tuo denaro, conto per conto.</p><span>Aggiungi un conto per iniziare.</span></div>'}</div><button class="button primary full" data-ledger="new-account">Aggiungi conto</button>${active.length>3?`<a class="text-link account-extra" href="#conti">Altri ${active.length-3} conti →</a>`:''}</section>`;
}
function dashboardMovements() {
  const movements=state.transactions.slice().reverse().slice(0,4);
  return `<section class="panel host-transactions"><div class="section-top"><h2>Ultimi movimenti</h2><a href="#movimenti" class="text-link">Vedi tutti</a></div><div class="host-movement-list">${movements.map(item=>{const account=state.accounts.find(a=>a.id===item.accountId);return `<a href="#conti/${item.accountId}" class="host-movement ${item.voided?'voided':''}"><span class="movement-avatar ${item.amountCents>0?'income':'expense'}" aria-hidden="true">${item.amountCents>0?'↙':'↗'}</span><div><strong>${esc(item.merchant||'Movimento')}</strong><small>${esc(account?.name||'Conto')} · ${item.voided?'Annullato':item.source==='apple-pay'?'Apple Pay':'Manuale'}</small></div><div class="host-movement-value"><b class="${item.voided?'':color(item.amountCents)}">${item.amountCents>0?'+':''}${money(item.amountCents)}</b><small>${new Date(item.occurredAt).toLocaleDateString('it-IT',{day:'numeric',month:'short'})}</small></div></a>`;}).join('') || '<div class="compact-empty"><p>Nessun movimento registrato</p><span>Le tue entrate e uscite appariranno qui.</span></div>'}</div><button class="button plain" data-ledger="new-movement" ${state.accounts.some(a=>!a.archived)?'':'disabled'}>+ Aggiungi movimento</button></section>`;
}
function dashboardActions(summary) {
  const reminders=summary.reminders.slice(0,3), syncAttention=['error','conflict','pending','update-required'].includes(cloud.status.phase);
  return `<section class="panel host-actions"><div class="section-top"><h2>Da completare</h2><a href="#notifiche" class="text-link">Vedi tutte</a></div><div class="host-action-list">${reminders.map(item=>`<button class="host-action" data-verify-month="${item.month}"><span class="action-avatar" aria-hidden="true">▤</span><span><strong>Verifica ${esc(monthLabel(item.month))}</strong><small>${item.overdue?'Saldo mensile da verificare':`Entro il ${dateLabel(item.dueDate)}`}</small></span><span class="action-arrow" aria-hidden="true">›</span></button>`).join('')}${needsGoalSetup()?'<a class="host-action" href="#obiettivo"><span class="action-avatar" aria-hidden="true">◎</span><span><strong>Scegli il tuo obiettivo</strong><small>Imposta importo e scadenza</small></span><span class="action-arrow">›</span></a>':''}${syncAttention?'<a class="host-action" href="#backup"><span class="action-avatar" aria-hidden="true">↻</span><span><strong>Controlla sincronizzazione</strong><small>Ci sono aggiornamenti in attesa</small></span><span class="action-arrow">›</span></a>':''}${!reminders.length&&!syncAttention&&!needsGoalSetup()?'<div class="compact-empty"><span class="all-clear" aria-hidden="true">✓</span><p>Tutto aggiornato</p><span>Non ci sono verifiche in sospeso.</span></div>':''}</div>${summary.reminders.length>3?`<a href="#notifiche" class="text-link action-extra">Altre ${summary.reminders.length-3} verifiche →</a>`:''}</section>`;
}
function dashboardGoal(summary) {
  return `<section class="panel host-goal"><div class="section-top"><h2>Il tuo obiettivo</h2><a href="#obiettivo" class="panel-more" aria-label="Gestisci obiettivo">···</a></div>${numbersVisible&&summary.progress!==null?`<div class="goal-ring-layout">${chartMarkup('goal','Avanzamento del tuo obiettivo finanziario')}<div class="goal-ring-center"><strong>${pct(summary.progress)}</strong><small>raggiunto</small></div></div>`:numbersVisible?'<div class="compact-empty"><p>Il tuo prossimo traguardo</p><span>Imposta un obiettivo e registra un saldo.</span></div>':'<div class="goal-concealed">••••<small>Avanzamento nascosto</small></div>'}<div class="goal-figures"><span>Traguardo<strong>${money(state.settings.targetCents)}</strong></span><span>Da raggiungere<strong>${money(summary.gap)}</strong></span></div><div class="goal-monthly"><span>Da mettere da parte<strong>${money(summary.plan.monthlyCents)}<small> / mese</small></strong></span><a href="#obiettivo" aria-label="Apri il piano dell’obiettivo">↗</a></div><p class="goal-deadline">${state.settings.deadline?deadlineLabel():'Scadenza da scegliere'}</p></section>`;
}
function overview(summary) {
  const phone = window.matchMedia('(max-width: 560px)').matches;
  const allocation = allocationMarkup(state, money, numbersVisible);
  // Keep DOM and keyboard order aligned with the phone's reading order.
  const panels = phone
    ? chart(summary, {primary:true}) + dashboardGoal(summary) + dashboardActions(summary) + allocation + dashboardAccounts() + dashboardMovements()
    : chart(summary, {primary:true}) + dashboardAccounts() + dashboardMovements() + dashboardActions(summary) + dashboardGoal(summary);
  const insights = chart(summary) + (phone ? '' : allocation);
  return heading('IL TUO SPAZIO', 'Panoramica', 'Il tuo patrimonio, mese dopo mese.', `<div class="heading-actions">${periodSelect({primary:true})}<button class="button secondary" data-action="export" aria-label="Esporta backup"><span aria-hidden="true">↥</span><span class="export-label">Esporta</span></button></div>`) +
    `<div class="mobile-balance-summary"><span>${summary.plan.usesAccounts ? 'Patrimonio totale' : 'Ultimo saldo verificato'}</span><strong>${money(summary.plan.balanceCents)}</strong></div><div class="host-dashboard">${panels}</div><div class="insights-heading"><h2>Il quadro completo</h2><span>Saldi correnti e storico verificato</span></div>${statsMarkup(summary)}<div class="host-insights">${insights}</div><section class="panel table-panel"><div class="table-intro"><div><h2>Gli ultimi saldi</h2><p>Il totale dei conti verificato ogni mese.</p></div><a class="text-link" href="#saldi">Vedi tutti →</a></div>${summary.recorded.length?monthlyTable(summary.recorded.slice(-4).reverse()):'<p class="empty-state">Nessun saldo registrato. Aggiungi un conto e verifica i saldi per iniziare.</p>'}</section>`;
}
function balances(summary) {
  const entries = Model.monthsForYear(tableYear).map(month => Model.entryFor(state, month));
  return heading('IL TUO STORICO', 'Saldi mensili', 'Scegli qualsiasi anno e inserisci i mesi disponibili.', addButton()) +
    `${chart(summary)}<div class="year-control"><button class="button secondary" data-year-step="-1" aria-label="Anno precedente" ${tableYear <= 1 ? 'disabled' : ''}>←</button><div><label for="table-year">Anno</label><input type="number" id="table-year" min="1" max="9999" value="${tableYear}" inputmode="numeric"></div><button class="button secondary" data-year-step="1" aria-label="Anno successivo" ${tableYear >= 9999 ? 'disabled' : ''}>→</button></div>
    <p class="record-summary">${entries.filter(entry => entry.balanceCents !== null).length} saldi su 12 per il ${tableYear}.</p><section class="panel table-panel">${monthlyTable(entries, true)}<p class="info-caption">Le variazioni confrontano due mesi consecutivi. Un mese vuoto non viene considerato un saldo a zero. Le verifiche conservano anche il dettaglio di ogni conto.</p></section>`;
}
function goalSetup() {
  return heading('INIZIAMO', 'Scegli il tuo obiettivo', 'Prima di continuare, indica quanto vuoi raggiungere e per quale data.') +
    `<section class="panel form-panel"><h2>Il tuo traguardo personale</h2><p>Non è stato impostato alcun obiettivo. Importo e scadenza li scegli tu e potrai modificarli in seguito.</p><form id="goal-form"><label for="goal-amount">Obiettivo (€)</label><input id="goal-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="Inserisci l’importo" required><label for="goal-deadline">Scadenza</label><input id="goal-deadline" type="date" min="0001-01-01" max="9999-12-31" required><p id="goal-error" class="form-error" role="alert"></p><button class="button primary" type="submit">Salva e continua</button></form></section>`;
}
function goal(summary) {
  if (needsGoalSetup()) return goalSetup();
  const text = neededNote(summary);
  return heading('IL TUO TRAGUARDO', 'Obiettivo', 'Scegli importo e scadenza. Puoi aggiornarli nel tempo.') +
    `<div class="goal-overview">${goalPanel(summary)}<section class="panel goal-accumulated"><p class="panel-label">Già accumulato</p><p class="goal-number">${money(summary.plan.balanceCents)}</p><p class="muted">${summary.plan.usesAccounts ? "Totale aggiornato dei conti inclusi" : "Ultimo saldo mensile disponibile"}</p></section></div><div class="goal-detail"><section class="panel form-panel"><h2>Il saldo che vuoi raggiungere</h2><p>I calcoli usano il totale aggiornato dei conti; se non hai ancora conti, l’ultimo saldo mensile disponibile. L’app continua a registrare i mesi anche dopo questa scadenza.</p><form id="goal-form"><label for="goal-amount">Obiettivo (€)</label><input id="goal-amount" inputmode="decimal" type="${numbersVisible ? 'text' : 'password'}" autocomplete="off" value="${(state.settings.targetCents / 100).toFixed(2).replace('.', ',')}" required><label for="goal-deadline">Scadenza</label><input id="goal-deadline" type="date" min="0001-01-01" max="9999-12-31" value="${state.settings.deadline}" required><p id="goal-error" class="form-error" role="alert"></p><button class="button primary" type="submit">Salva obiettivo</button></form></section><section class="panel goal-info"><p class="eyebrow">DA RISPARMIARE DAL PROSSIMO MESE</p><p class="big-needed">${money(summary.plan.monthlyCents)}<span class="subtle"> / mese</span></p><p>${text}</p><p class="info-rule">Calcolo al ${dateLabel(summary.plan.today)}, con il primo versamento dal mese successivo. Nessun rendimento futuro viene ipotizzato.</p></section></div>
    <section class="panel table-panel"><div class="table-intro"><div><h2>Anno per anno</h2><p>Dal primo all’ultimo saldo disponibile nell’anno.</p></div></div>${summary.annual.length ? `<div class="table-scroll"><table><thead><tr><th>Anno</th><th class="amount">Mesi registrati</th><th class="amount">Ultimo saldo</th><th class="amount">Variazione nell’anno</th></tr></thead><tbody>${summary.annual.map(annual => `<tr><td>${annual.year}</td><td class="amount">${annual.count}</td><td class="amount">${money(annual.last)}</td><td class="amount ${color(annual.change)}">${signed(annual.change)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-state">Gli anni appariranno con i primi saldi.</p>'}<p class="info-caption">${summary.up} mesi in crescita · ${summary.down} in decrescita · ${summary.stable} stabili · ${summary.over} saldi pari o superiori all’obiettivo.</p></section>`;
}
function cloudMarkup() {
  const status = cloud.status;
  if (status.phase === 'not-configured') return `<section id="cloud-panel" class="panel backup-panel wide"><h2>Sincronizzazione automatica</h2><p>Il collegamento a Supabase deve ancora essere configurato. Dopo l’attivazione potrai accedere con la stessa email su telefono e computer.</p>${status.error ? `<p class="form-error">${esc(status.error)}</p>` : ''}<p class="local-note">I dati locali e i backup continuano a funzionare.</p></section>`;
  if (status.phase === 'signed-out') return `<section id="cloud-panel" class="panel backup-panel wide"><h2>Accesso personale</h2><p>Accedi con la stessa email sui due dispositivi. Supabase invia un link di accesso; se hai configurato il codice email puoi usare anche quello. L’archivio online sarà riservato al tuo utente.</p><form id="cloud-email-form"><label for="cloud-email">Email</label><div class="form-inline"><input id="cloud-email" type="email" autocomplete="username" value="${esc(pendingEmail || status.email || '')}" required><button class="button primary" type="submit">Invia email di accesso</button></div></form>${pendingEmail ? `<form id="cloud-code-form"><label for="cloud-code">Codice numerico, se presente nell’email</label><div class="form-inline"><input id="cloud-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" pattern="[0-9]{6,10}" required><button class="button primary" type="submit">Accedi</button></div></form>` : ''}<p>Su iPhone dalla Home: tieni premuto il link nell’email, copialo e incollalo qui senza aprirlo. L’accesso resterà nell’app.</p><form id="cloud-link-form"><label for="cloud-link">Link ricevuto via email</label><input id="cloud-link" type="password" autocomplete="off" spellcheck="false" required><button class="button secondary" type="submit">Accedi con il link</button></form><p id="cloud-login-error" class="form-error" role="alert">${esc(status.error)}</p></section>`;
  const labels = { 'ready-to-link': 'Collega il tuo archivio', syncing: 'Sincronizzazione in corso', synced: 'Archivio sincronizzato', pending: 'Modifiche in attesa', conflict: 'Controlla i valori in conflitto', error: 'Sincronizzazione interrotta', 'update-required': 'Aggiornamento necessario' };
  const conflicts = status.conflict?.fields || [];
  const valueLabel = (value, path) => path === 'settings' ? (value?.targetCents === null ? 'Obiettivo da impostare' : `${money(value.targetCents)} · ${value.deadline}`) : value === null ? 'Eliminato o vuoto' : path.endsWith('Cents') ? money(value) : typeof value === 'object' ? value.accounts ? `${value.accounts.length} conti · ${value.transactions.length} movimenti` : value.openingCents !== undefined ? `${value.name || 'Saldo verificato'} · ${money(value.openingCents)} · ${value.openingAt}` : value.amountCents !== undefined ? `${value.merchant} · ${money(value.amountCents)} · ${value.voided ? 'Annullato' : 'Attivo'}` : `${money(value.balanceCents)} · ${value.note || 'Nessuna nota'}` : String(value);
  const fieldLabel = path => path === 'ledger' ? 'Conti e movimenti' : path.startsWith('accounts.') ? `Conto ${state.accounts.find(a => a.id === path.split('.')[1])?.name || 'modificato'} · ${path.endsWith('checkpoint') ? 'saldo verificato' : path.endsWith('name') ? 'nome' : path.endsWith('archived') ? 'inclusione nel totale' : 'dati'}` : path.startsWith('transactions.') ? 'Movimento del conto' : path === 'settings' ? 'Obiettivo' : path === 'settings.reminderDay' ? 'Giorno del promemoria' : path === 'settings.targetCents' ? 'Importo obiettivo' : path === 'settings.deadline' ? 'Scadenza obiettivo' : `${monthLabel(path.split('.')[1])}${path.endsWith('.note') ? ' · nota' : ' · saldo'}`;
  return `<section id="cloud-panel" class="panel backup-panel wide"><h2>${labels[status.phase] || 'Sincronizzazione'}</h2><p>Account: <strong>${esc(status.email || '—')}</strong></p><p id="cloud-status" role="status">${status.phase === 'ready-to-link' ? 'Conferma per collegare i saldi di questo dispositivo al tuo account personale.' : status.phase === 'pending' ? 'Le modifiche sono salvate sul dispositivo. Saranno inviate quando l’app è aperta e online.' : status.phase === 'synced' ? 'Telefono e computer usano lo stesso archivio dopo l’accesso con questa email.' : status.phase === 'syncing' ? 'Controllo gli aggiornamenti e invio le modifiche salvate.' : ''}</p>${status.syncedAt ? `<p class="local-note">Ultimo controllo: ${esc(new Date(status.syncedAt).toLocaleString('it-IT'))}</p>` : ''}${status.error ? `<p class="form-error" role="alert">${esc(status.error)}</p>` : ''}${conflicts.length ? `<p>Le modifiche indipendenti saranno unite. Scegli quali valori usare solo per questi conflitti:</p><ul class="cloud-conflicts">${conflicts.map(item => `<li><strong>${esc(fieldLabel(item.path))}</strong><div>Questo dispositivo: <span>${esc(valueLabel(item.local, item.path))}</span></div><div>Online: <span>${esc(valueLabel(item.remote, item.path))}</span></div></li>`).join('')}</ul><button class="button secondary" data-action="cloud-export-remote">Esporta copia online</button><button class="button primary" data-action="cloud-keep-local">Usa valori del dispositivo</button><button class="button secondary" data-action="cloud-keep-remote">Usa valori online</button>` : `<button class="button primary" data-action="${status.phase === 'ready-to-link' ? 'cloud-enable' : 'cloud-sync'}" ${status.phase === 'syncing' ? 'disabled' : ''}>${status.phase === 'ready-to-link' ? 'Attiva sincronizzazione' : 'Sincronizza ora'}</button>`}<button class="button secondary" data-action="cloud-logout">Esci dall’account</button><p class="local-note">Il backup JSON resta disponibile anche quando il servizio online non è raggiungibile.</p></section>`;
}
function backup(summary) {
  return heading('I TUOI DATI', 'Backup e dispositivi', 'L’app funziona anche con il computer spento.', '<a class="button secondary" href="#account">Account e sicurezza</a>') +
    `<div class="backup-grid">${cloudMarkup()}<section class="panel backup-panel"><h2>Una copia dei tuoi dati</h2><p>Il backup JSON conserva saldi mensili, conti, movimenti, note e obiettivo. I codici Apple Pay restano esclusi dal backup. Sono compatibili anche i backup della versione precedente.</p><button class="button primary" data-action="export">Esporta backup</button><button class="button secondary" data-action="import">Importa backup</button><button class="button secondary" data-action="restore">Ripristina ultimo salvataggio</button><p class="local-note">${summary.recorded.length} saldi mensili, ${state.accounts.length} conti e ${state.transactions.length} movimenti registrati. L’importazione chiede conferma prima di sostituirli.</p></section>
    <section class="panel backup-panel"><h2>Apri in Excel o Numbers</h2><p>Esporta i mesi registrati con saldo, variazione e note. Per ripristinare l’app usa il backup JSON.</p><button class="button secondary" data-action="csv">Esporta CSV</button></section>
    <section class="panel backup-panel"><h2>Su iPhone, dalla Home</h2><ol><li>Apri il link pubblicato in Safari.</li><li>Tocca Condividi e “Aggiungi alla schermata Home”.</li><li>Apri l’app dall’icona e accedi con la stessa email.</li></ol><p>${isInstalled() ? 'Stai usando l’app dalla schermata Home.' : 'Dopo il primo caricamento completo l’app si prepara per l’uso offline.'}</p><p>Stato: ${pwaStatus === 'offline-ready' ? 'pronta per l’uso offline' : 'apri l’app online per completare la preparazione offline'}.</p></section>
    <section class="panel backup-panel"><h2>Telefono e computer</h2><p>Con la sincronizzazione attiva, i saldi vengono controllati automaticamente mentre l’app è aperta, dopo il salvataggio, alla riapertura e circa ogni 3 secondi mentre è visibile. Se due valori sono in conflitto, scegli quale conservare.</p><p>GitHub distribuisce l’app. L’archivio online personale è in Supabase; una copia resta sul dispositivo per l’uso offline.</p>${navigator.storage?.persist ? '<button class="button secondary" data-action="persist-storage">Richiedi conservazione dati</button>' : ''}<p class="local-note">Conserva un backup anche dopo l’attivazione della sincronizzazione.</p></section></div>`;
}
const accountStatuses = { pending: 'In attesa', approved: 'Attivo', rejected: 'Rifiutato', blocked: 'Bloccato' };
function usersMarkup() {
  if (!accountProfile?.is_admin) return '';
  const users = managedUsers || [];
  return `<section class="panel users-panel"><div class="users-heading"><div><p class="eyebrow">AMMINISTRAZIONE</p><h2>Gestione utenti</h2></div><button class="button secondary" data-action="users-refresh" ${usersLoading ? 'disabled' : ''}>Aggiorna</button></div><p>Approva le richieste, rifiuta l’accesso o blocca gli account. Gli archivi personali rimangono separati.</p><p role="status">${esc(usersError || (usersLoading ? 'Caricamento utenti…' : `${users.filter(u => u.status === 'pending').length} richieste in attesa`))}</p>${['pending','approved','rejected','blocked'].map(status => {
    const group = users.filter(u => u.status === status);
    if (!group.length) return '';
    return `<h3>${accountStatuses[status]} · ${group.length}</h3><div class="users-list">${group.map(u => `<article class="user-card"><div><strong>${esc([u.first_name,u.last_name].filter(Boolean).join(' ') || u.email)}</strong>${u.is_admin ? ' · Amministratore' : ''}<p>${esc(u.email)}${u.phone ? `<br>${esc(u.phone)}` : ''}</p><small>${u.email_confirmed ? 'Email confermata' : 'Email da confermare'} · Richiesta del ${new Date(u.created_at).toLocaleDateString('it-IT')}</small></div>${u.is_admin ? '' : `<div class="user-actions">${u.status !== 'approved' ? `<button class="button primary" data-user-id="${esc(u.user_id)}" data-user-status="approved">${u.status === 'blocked' ? 'Riattiva' : 'Approva'}</button>` : ''}${u.status === 'pending' ? `<button class="button secondary" data-user-id="${esc(u.user_id)}" data-user-status="rejected">Rifiuta</button>` : ''}${u.status === 'approved' ? `<button class="button secondary" data-user-id="${esc(u.user_id)}" data-user-status="blocked">Blocca</button>` : ''}</div>`}</article>`).join('')}</div>`;
  }).join('')}</section>`;
}
function accessRequests() { return Model.pendingAccessRequests(accountProfile, managedUsers); }
function updateNotificationBadge(reminders = Model.balanceReminders(state, todayDate())) {
  const pending = accessRequests().length, count = reminders.length + pending;
  const badge = $('#notification-count'), link = $('[data-view="notifiche"]');
  badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : count;
  link.setAttribute('aria-label', `Notifiche: ${reminders.length} saldi da inserire${accountProfile?.is_admin ? ` e ${pending} richieste di accesso` : ''}`);
}
async function loadUsers() {
  if (!accessGranted || !accountProfile?.is_admin || usersLoading || !navigator.onLine) return;
  usersLoading = true; usersError = '';
  const owner = currentUser.id;
  try { const result = await manageAccounts(); if (currentUser?.id === owner) managedUsers = result; }
  catch (error) { if (currentUser?.id === owner) usersError = error.message; }
  finally {
    usersLoading = false;
    if (accessGranted && currentUser?.id === owner) {
      updateNotificationBadge();
      if (['account','notifiche'].includes(route()) && !hasPendingUiEdit()) render();
    }
  }
}
setInterval(() => { if (document.visibilityState === 'visible') loadUsers(); }, 15000);
function accessRequestNotifications() {
  if (!accountProfile?.is_admin) return '';
  const requests = accessRequests();
  return `<div class="notification-list admin-notification-list"><section class="panel notification-card admin-requests"><div><span class="notification-status">Solo amministratore</span><h2>Richieste di accesso · ${requests.length}</h2><p>${usersError ? esc(usersError) : managedUsers === null ? 'Controllo le richieste…' : requests.length ? 'Ogni richiesta rimane qui finché non la approvi o la rifiuti.' : 'Non ci sono richieste in attesa.'}</p></div><button class="button secondary" data-action="users-refresh" ${usersLoading ? 'disabled' : ''}>Aggiorna richieste</button></section>${requests.map(user => `<section class="panel notification-card"><div><h2>${esc([user.first_name,user.last_name].filter(Boolean).join(' ') || user.email)}</h2><p>${esc(user.email)} · ${user.email_confirmed ? 'Email confermata' : 'Email da confermare'}</p></div><div class="account-actions"><button class="button primary" data-user-id="${esc(user.user_id)}" data-user-status="approved">Approva</button><button class="button secondary" data-user-id="${esc(user.user_id)}" data-user-status="rejected">Rifiuta</button></div></section>`).join('')}</div>`;
}

function accountView() {
  const field = (id, label, value, extra = '') => `<label for="${id}">${label}</label><input id="${id}" value="${esc(value || '')}" ${extra}>`;
  const email = accountProfile?.email || currentUser?.email || '';
  return heading('IL TUO ACCOUNT', 'Account e sicurezza', 'Modifica i tuoi dati personali e le impostazioni di accesso.') +
    `<section class="panel account-conti-shortcut"><div><h2>I miei conti</h2><p>Aggiungi i tuoi conti, inserisci i saldi e gestisci i movimenti.</p></div><div class="account-actions"><button class="button primary" data-ledger="new-account">Aggiungi conto</button><a class="button secondary" href="#conti">Gestisci i conti</a></div></section>` +
    `<section class="panel form-panel"><h2>Il tuo profilo</h2><form id="profile-form"><fieldset class="profile-fields" ${profileSaving ? 'disabled' : ''}>
    ${field('profile-first-name', 'Nome', accountProfile?.first_name, 'autocomplete="given-name" maxlength="80"')}
    ${field('profile-last-name', 'Cognome', accountProfile?.last_name, 'autocomplete="family-name" maxlength="80"')}
    ${field('profile-phone', 'Telefono', accountProfile?.phone, 'type="tel" autocomplete="tel" maxlength="30"')}
    ${field('profile-username', 'Nome utente', accountProfile?.username ?? currentUser?.username, 'autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" aria-describedby="username-help"')}
    <p id="username-help" class="field-help">Facoltativo: 3–32 lettere, numeri, punti o trattini. Puoi sempre accedere anche con l’email.</p>
    <p id="profile-error" class="form-error" role="alert"></p><p class="profile-feedback" role="status">${esc(profileNotice)}</p>
    <button class="button primary" type="submit" ${navigator.onLine === false ? 'disabled' : ''}>${profileSaving ? 'Salvataggio…' : 'Salva profilo'}</button></fieldset></form></section>
    <section class="panel form-panel account-section"><h2>Email di accesso e recupero</h2><p>Email attuale: <strong>${esc(email)}</strong></p>
    ${accountProfile?.pending_email ? `<p class="notice">Cambio in attesa di conferma: ${esc(accountProfile.pending_email)}. Controlla la posta.</p>` : ''}
    <form id="profile-email-form"><fieldset class="profile-fields" ${emailSaving ? 'disabled' : ''}>${field('profile-email', 'Nuova email', '', 'type="email" autocomplete="email" maxlength="254" required')}
    <p class="field-help">Il nuovo indirizzo diventa attivo dopo le conferme richieste via email. I tuoi saldi restano nello stesso account.</p>
    <p id="profile-email-error" class="form-error" role="alert"></p><p class="profile-feedback" role="status">${esc(emailNotice)}</p>
    <button class="button secondary" type="submit" ${navigator.onLine === false ? 'disabled' : ''}>${emailSaving ? 'Invio…' : 'Richiedi cambio email'}</button></fieldset></form></section>
    <section class="panel form-panel account-section"><h2>Accesso e password</h2><p>Le istruzioni per recuperare la password vengono inviate alla tua email.</p><div class="account-actions"><button class="button primary" data-action="account-reset">Recupera o cambia password</button><button class="button secondary" data-action="cloud-logout">Esci dall’account</button></div><p class="local-note">La password non viene salvata dall’app. La sessione di accesso resta sul dispositivo finché non esci.</p></section>${usersMarkup()}`;
}
async function acceptProfile(profile) {
  accountProfile = profile;
  currentUser = { ...currentUser, username: profile.username, email: profile.email };
  await Storage.writeMeta('account-access:' + currentUser.id, profile);
}
async function refreshProfile() {
  if (!accessGranted || !navigator.onLine || accountRefreshing || hasPendingUiEdit()) return;
  const owner = currentUser.id; accountRefreshing = true;
  try {
    const profile = await requireApproved();
    if (accessGranted && currentUser?.id === owner && !hasPendingUiEdit() && JSON.stringify(profile) !== JSON.stringify(accountProfile)) { await acceptProfile(profile); if (route() === 'account') render(); }
  } catch (error) { if (error.authRequired) { await cloud.logout(); lockAccess(); } }
  finally { accountRefreshing = false; }
}
setInterval(() => { if (document.visibilityState === 'visible') { if (route() === 'account') refreshProfile(); loadUsers(); } }, 15000);

function reminderSettings(summary) {
  const day = Model.reminderDay(state), month = summary.plan.today.slice(0,7);
  const starts = Model.reminderDate(month, day);
  const current = summary.reminders.find(item => item.month === month);
  let next = starts;
  if (!current && (starts < summary.plan.today || Model.entryFor(state, month).balanceCents !== null)) {
    try { next = Model.reminderDate(Model.shiftMonth(month, 1), day); } catch { next = null; }
  }
  return `<section class="panel form-panel reminder-settings"><h2>Imposta promemoria</h2><p>Il tuo giorno attuale è il <strong>${day} di ogni mese</strong>. Puoi modificarlo qui.</p><form id="reminder-form"><label for="reminder-day">Giorno del mese</label><select id="reminder-day" aria-describedby="reminder-help">${Array.from({length:31},(_,i)=>`<option value="${i+1}" ${day===i+1?'selected':''}>Il giorno ${i+1} di ogni mese</option>`).join('')}</select><p id="reminder-help" class="field-help">Se il mese è più corto, uso l’ultimo giorno disponibile. Il nuovo giorno vale anche per il mese in corso; i mesi precedenti non compilati restano in elenco.</p><p class="reminder-date">${current ? `Il promemoria di ${monthLabel(month)} è già attivo.` : next ? `Prossima data prevista: <strong>${dateLabel(next)}</strong>, se manca il saldo del mese.` : 'Hai raggiunto l’ultimo mese del calendario supportato.'}</p><p class="field-help">Il promemoria compare nella pagina Notifiche e nel pallino del menu quando apri l’app. Rimane finché verifichi i saldi di tutti i conti. Non invia notifiche push mentre l’app è chiusa. Questa impostazione si sincronizza con gli altri dispositivi.</p><p id="reminder-error" class="form-error" role="alert"></p><button class="button primary" type="submit">Salva promemoria</button></form></section>`;
}
function notificationsView(summary) {
  const reminders = summary.reminders, pageSize = 12;
  notificationPage = Math.min(notificationPage, Math.max(0, Math.ceil(reminders.length / pageSize) - 1));
  const visible = reminders.slice(notificationPage * pageSize, (notificationPage + 1) * pageSize);
  return heading('PROMEMORIA', 'Notifiche', 'Scegli il tuo giorno per verificare tutti i conti e gestisci i promemoria ancora aperti.') + reminderSettings(summary) + accessRequestNotifications() +
    (reminders.length ? `<p class="record-summary" role="status">${reminders.length} ${reminders.length === 1 ? 'saldo da inserire' : 'saldi da inserire'}. Si aggiornano automaticamente anche dagli altri dispositivi.</p><div class="notification-list">${visible.map(item => `<section class="panel notification-card"><div><span class="notification-status ${item.overdue ? 'overdue' : ''}">${item.overdue ? 'In ritardo' : `Da compilare entro il ${Number(item.dueDate.slice(-2))}`}</span><h2>Saldo di ${esc(monthLabel(item.month))}</h2><p>Verifica il saldo corretto di tutti i conti e delle attività per ${esc(monthLabel(item.month))}, comprese le entrate non registrate da Wallet. Il promemoria rimane finché salvi la verifica.</p></div><button class="button primary" data-verify-month="${item.month}">Verifica saldi<span class="sr-only"> ${esc(monthLabel(item.month))}</span></button></section>`).join('')}</div>${reminders.length > pageSize ? `<div class="notification-pages"><button class="button secondary" data-notification-page="-1" ${notificationPage === 0 ? 'disabled' : ''}>Più recenti</button><span>Pagina ${notificationPage + 1} di ${Math.ceil(reminders.length / pageSize)}</span><button class="button secondary" data-notification-page="1" ${(notificationPage + 1) * pageSize >= reminders.length ? 'disabled' : ''}>Precedenti</button></div>` : ''}` : '<section class="panel notification-empty"><h2>Saldi aggiornati</h2><p>Non ci sono saldi da inserire. Il promemoria comparirà nel giorno che hai impostato, se il relativo saldo manca.</p></section>');
}
function setNumbersVisible(visible) {
  numbersVisible = visible;
  const owner = currentUser?.id;
  if (owner) visibilityPreferenceWrite = visibilityPreferenceWrite.catch(() => {}).then(() => Storage.writeMeta('numbers-visible:' + owner, visible)).catch(() => toast('Non riesco a memorizzare la preferenza dell’occhio su questo dispositivo.', true));
  // Re-render masked text without discarding an unfinished goal edit.
  const form = $('#goal-form');
  const draft = form ? { amount: $('#goal-amount').value, deadline: $('#goal-deadline').value, error: $('#goal-error').textContent } : null;
  const focused = document.activeElement?.id;
  render();
  if (draft && $('#goal-form')) { $('#goal-amount').value = draft.amount; $('#goal-deadline').value = draft.deadline; $('#goal-error').textContent = draft.error; }
  if (document.visibilityState === 'visible' && focused) document.getElementById(focused)?.focus({ preventScroll: true });
}
function render() {
  if (!accessGranted) return;
  if (state && needsGoalSetup() && !['account','backup','notifiche','conti'].includes(route())) history.replaceState(null, '', location.pathname + location.search + '#obiettivo');
  const view = route(); if (view === 'panoramica' && chartYear === 'all') chartYear = String(tableYear); $('#breadcrumb').textContent = titles[view];
  $('#profile-link').classList.toggle('active', view === 'account');
  if (view === 'account') $('#profile-link').setAttribute('aria-current', 'page'); else $('#profile-link').removeAttribute('aria-current');
  document.querySelectorAll('[data-view]').forEach(link => { const active = link.dataset.view === view; link.classList.toggle('active', active); if (active && !(view === 'conti' && accountsUi.selectedAccount())) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  content.setAttribute('aria-busy', 'false');
  if (!state) return;
  $('#sidebar-accounts-list').innerHTML = accountsUi.sidebarMarkup();
  const visibilityButton = $('#toggle-numbers');
  const visibilityLabel = numbersVisible ? 'Nascondi i numeri' : 'Mostra i numeri';
  visibilityButton.setAttribute('aria-label', visibilityLabel); visibilityButton.title = visibilityLabel;
  visibilityButton.setAttribute('aria-pressed', String(numbersVisible));
  visibilityButton.classList.toggle('revealed', numbersVisible);
  const summary = Model.stats(state); summary.plan = Model.goalPlan(state, todayDate()); planDate = summary.plan.today;
  summary.yearGrowth = Model.currentYearGrowth(state, planDate);
  summary.gap = summary.plan.missingCents;
  summary.progress = Model.hasGoal(state) && summary.plan.balanceCents !== null ? summary.plan.balanceCents / state.settings.targetCents : null;
  summary.reminders = Model.balanceReminders(state, planDate);
  updateNotificationBadge(summary.reminders);
  if (accountProfile?.is_admin && managedUsers === null && !usersLoading && !usersError) queueMicrotask(loadUsers);
  const drafts = [...content.querySelectorAll('#profile-form, #profile-email-form, #reminder-form')].filter(form => dirtyForms.has(form.id)).flatMap(form => [...form.querySelectorAll('input,select')].map(input => [input.id, input.value]));
  const draftErrors = [...content.querySelectorAll('#profile-error, #profile-email-error, #reminder-error')].map(node => [node.id, node.textContent]);
  content.dataset.view = view;
  content.innerHTML = ({ panoramica: overview, saldi: balances, obiettivo: goal, notifiche: notificationsView, backup, account: accountView, movimenti: () => heading('ATTIVITÀ', 'Movimenti', 'Ogni entrata e uscita, al posto giusto.', '<button class="button primary" data-ledger="new-movement">Aggiungi movimento</button>') + accountsUi.markup(true, true), conti: () => heading('IL TUO DENARO', esc(accountsUi.selectedAccount()?.name || 'Conti e movimenti'), accountsUi.selectedAccount() ? 'Saldo e movimenti del conto selezionato.' : 'Saldi separati, un unico totale.', '<button class="button primary" data-ledger="new-account">Aggiungi conto</button>') + allocationMarkup(state, money, numbersVisible) + accountsUi.markup(true) }[view])(summary);
  content.insertAdjacentHTML('afterbegin', `<nav class="mobile-utilities" aria-label="Altre sezioni"><a href="#notifiche" ${view === 'notifiche' ? 'aria-current="page"' : ''}>Notifiche${summary.reminders.length ? ` · ${summary.reminders.length}` : ''}</a><a href="#backup" ${view === 'backup' ? 'aria-current="page"' : ''}>Backup e dispositivi</a><a href="#account" ${view === 'account' ? 'aria-current="page"' : ''}>Account</a></nav>`);
  const currentBalance = numbersVisible ? summary.plan.balanceCents : null;
  $('#header-balance').innerHTML = `<span>Patrimonio totale</span><strong class="balance-digits">${money(summary.plan.balanceCents)}</strong>`;
  const balanceNode = $('#header-balance strong');
  if (currentBalance !== null && lastAnimatedBalance !== null && currentBalance !== lastAnimatedBalance && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const from = lastAnimatedBalance, start = performance.now();
    const tick = time => {
      if (!balanceNode.isConnected || !numbersVisible) return;
      const t = Math.min(1, (time-start)/450);
      balanceNode.textContent = money(Math.round(from+(currentBalance-from)*(1-(1-t)**3)));
      if(t<1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  lastAnimatedBalance = currentBalance;
  $('#header-profile-name').textContent = [accountProfile?.first_name,accountProfile?.last_name].filter(Boolean).join(' ') || 'Il tuo account';
  const selectedYear = chartYear === 'all' ? null : chartYear;
  const chartEntries = selectedYear ? Model.monthsForYear(selectedYear).map(month=>Model.entryFor(state,month)) : (()=>{
    if(!summary.recorded.length)return [];
    const first=summary.recorded[0].month,last=summary.recorded.at(-1).month;
    return Array.from({length:Model.monthIndex(last)-Model.monthIndex(first)+1},(_,i)=>Model.entryFor(state,Model.shiftMonth(first,i)));
  })();
  mountCharts(content,{state,summary,entries:chartEntries,visible:numbersVisible,mode:chartMode});
  drafts.forEach(([id, value]) => { const input = document.getElementById(id); if (input) input.value = value; });
  if (drafts.length) draftErrors.forEach(([id, value]) => { const node = document.getElementById(id); if (node) node.textContent = value; });
}
function fillEntry(month) {
  const entry = Model.entryFor(state, month);
  $('#entry-amount').value = entry.balanceCents === null ? '' : (entry.balanceCents / 100).toFixed(2).replace('.', ',');
  $('#entry-note').value = entry.note; $('#entry-error').textContent = '';
  $('#entry-title').textContent = entry.balanceCents === null ? 'Aggiungi un saldo' : 'Modifica saldo';
  $('#delete-entry').hidden = entry.balanceCents === null && !entry.note;
}
function openEntry(month, { fresh = false } = {}) {
  if (needsGoalSetup()) { location.hash = 'obiettivo'; render(); return; }
  if (Model.monthlyAccountRows(state, month).length) { monthlyUi.open(month, { fresh }); return; }
  if (Model.entryFor(state, month).balanceCents === null) { toast('Aggiungi prima i tuoi conti, anche attività virtuali con un nome a tua scelta.'); location.hash = 'conti'; render(); return; }
  $('#entry-month').value = month; fillEntry(month); $('#entry-dialog').showModal(); $('#entry-amount').focus();
}
function confirmAction(title, text, accept = 'Conferma') {
  return new Promise(resolve => { const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-text').textContent = text; $('#confirm-accept').textContent = accept; dialog.returnValue = ''; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }); dialog.showModal(); });
}
function download(name, text, type) {
  const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function exportBackup() {
  download(`il-mio-conto-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'il-mio-conto', ...Model.validateState(state), exportedAt: new Date().toISOString() }, null, 2), 'application/json'); toast('Backup esportato.');
}
async function restore() {
  const previous = await Storage.previous();
  if (!previous) { toast('Non è ancora disponibile un salvataggio precedente.'); return; }
  if (await confirmAction('Ripristinare il salvataggio precedente?', `${Model.stats(previous).recorded.length} saldi. I dati attuali saranno conservati come salvataggio precedente.${state.sync ? ' Le modifiche verranno sincronizzate anche sugli altri dispositivi.' : ''}`, 'Ripristina')) { await persist(previous); toast('Salvataggio ripristinato.'); }
}
document.addEventListener('click', async event => {
  if (event.target.closest('#toggle-numbers')) { setNumbersVisible(!numbersVisible); return; }
  const close = event.target.closest('[data-close]'); if (close) { close.closest('dialog').close(); return; }
  const verify = event.target.closest('[data-verify-month]'); if (verify) { openEntry(verify.dataset.verifyMonth, { fresh: true }); return; }
  const edit = event.target.closest('[data-edit]'); if (edit) { openEntry(edit.dataset.edit); return; }
  const step = event.target.closest('[data-year-step]'); if (step) { tableYear += Number(step.dataset.yearStep); chartYear = String(tableYear); render(); return; }
  const notificationStep = event.target.closest('[data-notification-page]'); if (notificationStep) { notificationPage = Math.max(0, notificationPage + Number(notificationStep.dataset.notificationPage)); render(); return; }
  const userAction = event.target.closest('[data-user-id]');
  if (userAction && accessGranted && accountProfile?.is_admin) {
    const id = userAction.dataset.userId, status = userAction.dataset.userStatus;
    const user = managedUsers?.find(u => u.user_id === id);
    if (!user || user.is_admin) return;
    if (!await confirmAction(`${accountStatuses[status]}: confermare?`, `${user.first_name} ${user.last_name} · ${user.email}`, status === 'approved' ? 'Conferma accesso' : status === 'blocked' ? 'Blocca account' : 'Rifiuta richiesta')) return;
    userAction.disabled = true;
    try { managedUsers = await manageAccounts(id, status); render(); toast('Stato dell’account aggiornato.'); }
    catch (error) { toast(error.message, true); if (userAction.isConnected) userAction.disabled = false; }
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  try {
    if (action === 'users-refresh') await loadUsers();
    if (action === 'add') openEntry(currentMonth(), { fresh: true });
    if (action === 'export') exportBackup();
    if (action === 'csv') { download('saldi-del-conto.csv', Model.csvFor(state), 'text/csv;charset=utf-8'); toast('CSV esportato.'); }
    if (action === 'import') $('#import-file').click();
    if (action === 'restore') await restore();
    if (action === 'persist-storage') toast(await navigator.storage.persist() ? 'Conservazione persistente concessa dal browser. Mantieni comunque un backup.' : 'Il browser non concede la conservazione persistente. Esporta regolarmente un backup.');
    if (action === 'recover') download('archivio-da-recuperare.json', JSON.stringify(await Storage.rawRecovery(), null, 2), 'application/json');
    if (action === 'cloud-enable') {
      if (await confirmAction('Attivare la sincronizzazione?', `Saldi, note e obiettivo saranno collegati all’account ${cloud.status.email} nel tuo progetto Supabase. Potrai usarli anche sugli altri dispositivi con la stessa email.`, 'Attiva')) {
        await cloud.activate();
        toast(cloud.status.phase === 'synced' ? 'Archivio sincronizzato.' : cloud.status.phase === 'conflict' ? 'Controlla i valori in conflitto.' : cloud.status.error || 'Collegamento attivo. Le modifiche restano salvate sul dispositivo.', Boolean(cloud.status.error));
      }
    }
    if (action === 'cloud-sync') await cloud.trigger();
    if (action === 'account-reset') { await requestPasswordRecovery(currentUser.email); toast('Se l’invio è disponibile, riceverai le istruzioni all’email del tuo account.'); }
    if (action === 'cloud-logout') {
      const local = await Storage.load(), pending = local.sync && (!local.sync.base || !samePayload(local, local.sync.base));
      if (await confirmAction('Uscire dall’account?', pending ? 'Ci sono modifiche non ancora inviate. Restano sul dispositivo e riprenderanno la sincronizzazione accedendo allo stesso account.' : 'I dati salvati restano sul dispositivo. La sincronizzazione riprenderà quando accedi allo stesso account.', 'Esci')) { await cloud.logout(); pendingEmail = ''; dirtyForms.clear(); render(); }
    }
    if (action === 'cloud-keep-local' || action === 'cloud-keep-remote') {
      const preference = action === 'cloud-keep-local' ? 'local' : 'remote';
      if (await confirmAction('Risolvere i valori in conflitto?', `Saranno usati i valori ${preference === 'local' ? 'di questo dispositivo' : 'online'} per i campi in conflitto. Le altre modifiche saranno unite.`, 'Conferma e sincronizza')) await cloud.resolve(preference);
    }
    if (action === 'cloud-export-remote') {
      const saved = cloud.status.conflict?.remote || (await Storage.readMeta('last-cloud-conflict'))?.payload;
      if (!saved) throw new Error('Non è disponibile una copia online da esportare.');
      download('copia-online-da-verificare.json', JSON.stringify({ app: 'il-mio-conto', ...Model.validateState(saved) }, null, 2), 'application/json');
    }
  } catch (error) { toast(error.message, true); }
});
$('#connection').addEventListener('click', () => location.hash = 'backup');
$('#confirm-cancel').addEventListener('click', () => $('#confirm-dialog').close('no'));
$('#confirm-accept').addEventListener('click', () => $('#confirm-dialog').close('yes'));
$('#entry-month').addEventListener('change', () => { if (Model.isMonth($('#entry-month').value)) fillEntry($('#entry-month').value); });
$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#save-entry'); button.disabled = true; $('#entry-error').textContent = '';
  try {
    const month = $('#entry-month').value;
    const next = Model.setEntry(state, { month, balanceCents: Model.parseCents($('#entry-amount').value), note: $('#entry-note').value.trim() });
    await persist(next); tableYear = Number(month.slice(0, 4)); chartYear = String(tableYear); $('#entry-dialog').close(); render(); toast('Saldo salvato.');
  } catch (error) { $('#entry-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#delete-entry').addEventListener('click', async () => {
  const month = $('#entry-month').value;
  if (!await confirmAction('Eliminare questo saldo?', `Il saldo di ${monthLabel(month)} sarà lasciato vuoto. Gli altri mesi restano registrati.${state.sync ? ' La rimozione verrà sincronizzata sugli altri dispositivi.' : ''}`, 'Elimina saldo')) return;
  try { await persist(Model.setEntry(state, { month, balanceCents: null, note: '' })); $('#entry-dialog').close(); toast('Saldo eliminato.'); } catch (error) { $('#entry-error').textContent = error.message; }
});
content.addEventListener('submit', async event => {
  if (event.target.id === 'reminder-form') {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const next = Model.validateState(state); next.settings.reminderDay = Number($('#reminder-day').value);
      await persist(next); dirtyForms.delete('reminder-form'); notificationPage = 0; render(); toast('Promemoria aggiornato.');
    } catch (error) { if ($('#reminder-error')) $('#reminder-error').textContent = error.message; }
    finally { if (button.isConnected) button.disabled = false; }
    return;
  }
  if (event.target.id === 'profile-form') {
    event.preventDefault(); if (profileSaving) return;
    if (!navigator.onLine) { $('#profile-error').textContent = 'Connettiti a internet per salvare il profilo.'; return; }
    const details = { firstName: $('#profile-first-name').value, lastName: $('#profile-last-name').value, phone: $('#profile-phone').value, username: $('#profile-username').value };
    const owner = currentUser.id; profileSaving = true; profileNotice = ''; dirtyForms.add('profile-form'); render();
    try {
      const profile = await updateProfile(details);
      if (!accessGranted || currentUser?.id !== owner) return;
      await acceptProfile(profile); dirtyForms.delete('profile-form'); managedUsers = null; profileNotice = 'Profilo salvato. Le modifiche sono disponibili anche sugli altri dispositivi.';
      profileSaving = false; render();
    } catch (error) { if ($('#profile-error')) $('#profile-error').textContent = error.message; }
    finally { profileSaving = false; if (accessGranted && route() === 'account') render(); }
    return;
  }
  if (event.target.id === 'profile-email-form') {
    event.preventDefault(); if (emailSaving) return;
    const email = $('#profile-email').value.trim().toLowerCase();
    if (!navigator.onLine) { $('#profile-email-error').textContent = 'Connettiti a internet per cambiare email.'; return; }
    if (email === (accountProfile?.email || currentUser.email).toLowerCase()) { $('#profile-email-error').textContent = 'Questo è già il tuo indirizzo attuale.'; return; }
    if (!await confirmAction('Cambiare email?', `Richiedi il cambio dell’indirizzo di accesso e recupero a ${email}. Segui le conferme ricevute via email per completarlo.`, 'Richiedi cambio')) return;
    const owner = currentUser.id; emailSaving = true; emailNotice = ''; dirtyForms.add('profile-email-form'); render();
    try {
      await changeEmail(email);
      const profile = await requireApproved();
      if (!accessGranted || currentUser?.id !== owner) return;
      await acceptProfile(profile); dirtyForms.delete('profile-email-form');
      emailNotice = profile.email === email ? 'Email aggiornata.' : 'Richiesta inviata. Controlla la posta e completa le conferme richieste.';
    } catch (error) { if ($('#profile-email-error')) $('#profile-email-error').textContent = error.message; }
    finally { emailSaving = false; if (accessGranted && route() === 'account') render(); }
    return;
  }
  if (event.target.id !== 'goal-form') return;
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try {
    const wasSetup = needsGoalSetup();
    const next = Model.validateState(state); next.settings = { ...next.settings, targetCents: Model.parseCents($('#goal-amount').value), deadline: $('#goal-deadline').value, goalChosen: true };
    await persist(next); dirtyForms.delete('goal-form'); toast('Obiettivo aggiornato.'); if (wasSetup) location.hash = 'panoramica';
  } catch (error) { if ($('#goal-error')) $('#goal-error').textContent = error.message; } finally { if (button.isConnected) button.disabled = false; }
});
content.addEventListener('change', event => {
  if (event.target.id === 'reminder-day') dirtyForms.add('reminder-form');
  if (event.target.id === 'chart-year') { chartYear = event.target.value; if (route() === 'saldi' && chartYear !== 'all') tableYear = Number(chartYear); render(); }
  if (event.target.id === 'table-year') {
    try { Model.monthsForYear(event.target.value); tableYear = Number(event.target.value); chartYear = String(tableYear); render(); }
    catch (error) { toast(error.message, true); event.target.value = tableYear; }
  }
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 20_000_000) throw new Error('Backup troppo grande.');
    const imported = Model.validateState(JSON.parse(await file.text())), summary = Model.stats(imported);
    if (!await confirmAction('Importa questo backup?', `${summary.recorded.length} saldi mensili, ${imported.accounts.length} conti e ${imported.transactions.length} movimenti, obiettivo ${money(imported.settings.targetCents)}${summary.last ? `, ultimo mese ${monthLabel(summary.last.month)}` : ''}. I dati attuali verranno sostituiti.${state.sync ? ' Le modifiche verranno sincronizzate anche sugli altri dispositivi.' : ''}`, 'Sostituisci dati')) return;
    await persist(imported); if (summary.last) { tableYear = Number(summary.last.month.slice(0, 4)); chartYear = String(tableYear); render(); } toast('Backup importato.');
  } catch (error) { toast(error instanceof SyntaxError ? 'Il file non contiene un backup JSON leggibile.' : error.message, true); }
});
$('#apply-update').addEventListener('click', async () => {
  if (hasPendingUiEdit()) { toast('Salva o chiudi la modifica in corso prima di aggiornare.'); return; }
  const button = $('#apply-update'); button.disabled = true;
  try {
    if (!activateUpdate) await checkForAppUpdate();
    if (activateUpdate) activateUpdate();
    else toast('Controllo aggiornamenti. Attendi qualche secondo e ripremi Aggiorna app. Non cancellare i dati del sito.');
  } catch { toast('Connettiti a internet e riprova ad aggiornare. I dati locali sono conservati.', true); }
  finally { button.disabled = false; }
});
content.addEventListener('submit', async event => {
  if (!['cloud-email-form', 'cloud-code-form', 'cloud-link-form'].includes(event.target.id)) return;
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try {
    if (event.target.id === 'cloud-email-form') { pendingEmail = await sendCode($('#cloud-email').value); toast('Se l’indirizzo è autorizzato, riceverai l’email di accesso.'); }
    else {
      if (event.target.id === 'cloud-link-form') await verifyEmailLink(pendingEmail || $('#cloud-email').value, $('#cloud-link').value);
      else await verifyCode(pendingEmail, $('#cloud-code').value);
      pendingEmail = ''; toast('Accesso completato.');
    }
    dirtyForms.delete('cloud-email-form'); dirtyForms.delete('cloud-code-form'); dirtyForms.delete('cloud-link-form'); render();
  } catch (error) { if ($('#cloud-login-error')) $('#cloud-login-error').textContent = error.message; }
  finally { if (button.isConnected) button.disabled = false; }
});
document.addEventListener('input', event => { const id = event.target.closest('form')?.id; if (['goal-form', 'cloud-email-form', 'cloud-code-form', 'cloud-link-form', 'profile-form', 'profile-email-form', 'reminder-form'].includes(id)) dirtyForms.add(id); });
window.addEventListener('hashchange', () => { dirtyForms.clear(); render(); if (route() === 'account') refreshProfile(); window.scrollTo({ top: 0, behavior: 'auto' }); });
window.addEventListener('online', setStatus); window.addEventListener('offline', setStatus);
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state && accessGranted && ['panoramica', 'saldi'].includes(route()) && !hasPendingUiEdit()) render(); }, 150); });
Storage.subscribe(async () => { if (accessGranted && (await session())?.user.id !== currentUser?.id) { lockAccess(); return; } if (!hasPendingUiEdit()) { try { const latest = await Storage.load(); if (!hasPendingUiEdit()) { state = latest; render(); setStatus(); } } catch (error) { toast(error.message, true); } } });
onCloudChange(async update => {
  setStatus();
  if (!authReady) return;
  if (update.phase === 'signed-out') { lockAccess(); return; }
  if (!accessGranted) return;
  if (hasPendingUiEdit()) { if (update.dataChanged) pendingArchiveRefresh = true; return; }
  try {
    if (update.dataChanged || pendingArchiveRefresh) { const latest = await Storage.load(); if (!hasPendingUiEdit()) { state = latest; pendingArchiveRefresh = false; render(); } else pendingArchiveRefresh = true; }
    else if (route() === 'backup') { const panel = $('#cloud-panel'); if (panel) panel.outerHTML = cloudMarkup(); }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { if (route() === 'account') refreshProfile(); loadUsers(); } if (state && document.visibilityState === 'visible' && !hasPendingUiEdit()) { try { const latest = await Storage.load(); if (!hasPendingUiEdit()) { state = latest; render(); setStatus(); } } catch (error) { toast(error.message, true); } } });
try {
  initializePwa({ onStatus: status => { pwaStatus = status; setStatus(); if (route() === 'backup' && !hasPendingUiEdit()) render(); }, onUpdate: activate => { activateUpdate = activate; $('#update-banner').hidden = false; } });
  state = await Storage.load(); const last = Model.stats(state).last;
  if (last) { tableYear = Number(last.month.slice(0, 4)); chartYear = String(tableYear); }
  render(); setStatus();
  let recovering = false, accessError = '';
  try {
    const incoming = await incomingAccess;
    if (incoming.error) throw incoming.error;
    if (incoming.session?.recovery) { recovering = true; authUi.recovery(incoming.session); }
    else if (incoming.session && await confirmAction('Conferma accesso', `Accedere come ${incoming.session.user.email}? L’archivio locale verrà collegato solo con l’attivazione della sincronizzazione.`, 'Accedi')) await acceptRedirectSession(incoming.session);
  } catch (error) { accessError = error.message; }
  authReady = true;
  await initializeCloud({ initialize: false });
  if (!recovering && await session()) await openAuthenticatedArchive();
  else { lockAccess(); if (accessError) authUi.message(accessError, true); }
} catch (error) {
  lockAccess();
  if (error.updateRequired) { $('#update-message').textContent = error.message; $('#update-banner').hidden = false; }
  authUi.message(error.message + ' I dati locali non sono stati sostituiti.', true);
  content.setAttribute('aria-busy', 'false'); content.replaceChildren();
  const panel = document.createElement('section'); panel.className = 'notice';
  const message = document.createElement('p'); message.textContent = `Non posso aprire l’archivio: ${error.message} I dati esistenti non sono stati sostituiti.`;
  const button = document.createElement('button'); button.className = 'button secondary'; button.dataset.action = 'recover'; button.textContent = 'Esporta archivio da recuperare'; panel.append(message, button); content.append(panel);
}

initializeCharts(content, () => numbersVisible);
content.addEventListener('click', event => {
  const button = event.target.closest('[data-chart-mode]');
  if (!button) return;
  chartMode = button.dataset.chartMode; render();
  content.querySelector(`[data-chart-mode="${chartMode}"]`)?.focus({ preventScroll: true });
});
