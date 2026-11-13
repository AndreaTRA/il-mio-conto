import * as Model from './model.js';
import { accountBalance } from './ledger.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localInput = instant => { const d = new Date(instant); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,23); };
export function createMonthlyUi({ getState, getOwner, money, persist, toast, onSaved }) {
  let revision, rows = [];
  document.body.insertAdjacentHTML('beforeend', `<dialog id="monthly-dialog" aria-labelledby="monthly-title"><form id="monthly-form"><div class="dialog-header"><h2 id="monthly-title">Verifica i saldi di tutti i conti</h2><button class="icon-button" type="button" data-close aria-label="Chiudi">×</button></div><p class="muted">Controlla il saldo corretto di ogni conto o attività, comprese le entrate che non passano da Wallet.</p><label for="monthly-month">Mese da registrare</label><input id="monthly-month" type="month" min="0001-01" max="9999-12" required><label for="monthly-date">Data e ora dei saldi verificati</label><input id="monthly-date" type="datetime-local" step="0.001" required><p class="field-help">Usa saldi riferiti a questa data. Per i mesi passati lo storico viene salvato senza riportare indietro i saldi attuali.</p><div id="monthly-account-fields"></div><div class="monthly-total"><span>Totale del mese</span><strong id="monthly-total-value"></strong></div><label for="monthly-note">Nota facoltativa</label><textarea id="monthly-note" rows="2" maxlength="500"></textarea><p class="field-help">Salvando confermi tutti gli importi. I movimenti precedenti alla verifica restano nello storico e non vengono scalati di nuovo.</p><p id="monthly-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="button secondary" type="button" data-close>Annulla</button><button class="button primary" type="submit">Salva tutti i saldi</button></div></form></dialog>`);
  const $ = selector => document.querySelector(selector);
  function total() {
    try {
      const values = rows.map(row => $('#monthly-balance-' + row.accountId).value);
      $('#monthly-total-value').textContent = values.some(value => !value.trim()) ? 'Compila tutti i conti' : money(values.reduce((sum,value)=>sum+Model.parseCents(value),0));
    } catch { $('#monthly-total-value').textContent = 'Controlla gli importi'; }
  }
  function fill(month, fresh = false) {
    const state = getState(), entry = Model.entryFor(state, month);
    rows = Model.monthlyAccountRows(state, month); revision = state.revision;
    if (!rows.length) throw new Error('Aggiungi almeno un conto o un’attività prima di verificare i saldi.');
    const now = new Date().toISOString();
    $('#monthly-date').value = entry.verifiedAt && !fresh ? localInput(entry.verifiedAt) : month === Model.monthAtInstant(now) ? localInput(now) : month + '-01T00:00:00.000';
    $('#monthly-note').value = entry.note; $('#monthly-error').textContent = '';
    $('#monthly-account-fields').innerHTML = rows.map(row => {
      const live = state.accounts.find(account => account.id === row.accountId);
      return `<div class="monthly-account-field"><label for="monthly-balance-${row.accountId}">${esc(row.name)} · saldo corretto (€)</label>${live ? `<p class="field-help">Saldo stimato oggi: ${money(accountBalance(state,row.accountId))}</p>` : ''}<input id="monthly-balance-${row.accountId}" data-monthly-account="${row.accountId}" type="text" inputmode="decimal" autocomplete="off" placeholder="Inserisci il saldo corretto" value="${fresh || row.balanceCents === null ? '' : (row.balanceCents/100).toFixed(2).replace('.',',')}" required></div>`;
    }).join('');
    total();
  }
  $('#monthly-month').addEventListener('change', () => { try { if(Model.isMonth($('#monthly-month').value)) fill($('#monthly-month').value); } catch(error) { $('#monthly-error').textContent=error.message; } });
  $('#monthly-account-fields').addEventListener('input',total);
  $('#monthly-form').addEventListener('submit', async event => {
    event.preventDefault(); const button=event.submitter; button.disabled=true;
    try {
      if(!getOwner()) throw new Error('Accedi di nuovo prima di salvare.');
      if(getState().revision!==revision) throw new Error('I dati sono cambiati. Chiudi e riapri la verifica per usare i conti aggiornati.');
      const verifiedAt = new Date($('#monthly-date').value).toISOString();
      const balances=rows.map(row=>({accountId:row.accountId,balanceCents:Model.parseCents($('#monthly-balance-'+row.accountId).value)}));
      const month=$('#monthly-month').value;
      await persist(Model.reconcileMonthly(getState(),{month,verifiedAt,balances,note:$('#monthly-note').value.trim()}));
      $('#monthly-dialog').close(); onSaved(month); toast('Saldi di tutti i conti verificati. Totale mensile salvato.');
    } catch(error) { $('#monthly-error').textContent=error instanceof RangeError ? 'Scegli una data valida.' : error.message; }
    finally { button.disabled=false; }
  });
  $('#monthly-dialog').addEventListener('close',()=>{ rows=[]; $('#monthly-form').reset(); $('#monthly-account-fields').replaceChildren(); });
  return { open(month, { fresh = false } = {}) { fill(month, fresh); $('#monthly-month').value=month; $('#monthly-dialog').showModal(); $('#monthly-account-fields input')?.focus(); } };
}
