/** Pure domain logic. Monetary values are integer cents; missing is null. */
import { validateLedger, isInstant, totalBalance } from './ledger.js';
export const SCHEMA_VERSION = 3;
export class ArchiveUpdateRequiredError extends Error {
  constructor() { super('Aggiorna Flowly su questo dispositivo per leggere i conti sincronizzati. I tuoi dati sono conservati.'); this.updateRequired = true; }
}
export const DEFAULT_SETTINGS = Object.freeze({ targetCents: null, deadline: null });
const MAX_CENTS = 100_000_000_000;

export function isMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1;
}
export function monthIndex(month) {
  if (!isMonth(month)) throw new Error('Scegli un mese valido.');
  const [year, m] = month.split('-').map(Number);
  return year * 12 + m - 1;
}
export function shiftMonth(month, amount) {
  const index = monthIndex(month) + amount;
  const year = Math.floor(index / 12), m = index % 12 + 1;
  if (!Number.isInteger(amount) || year < 1 || year > 9999) throw new Error('Anno non supportato dal calendario.');
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}
export function monthsForYear(year) {
  const value = Number(year);
  if (!Number.isInteger(value) || value < 1 || value > 9999) throw new Error('Inserisci un anno da 1 a 9999.');
  return Array.from({ length: 12 }, (_, i) => `${String(value).padStart(4, '0')}-${String(i + 1).padStart(2, '0')}`);
}
export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isMonth(value.slice(0, 7))) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function parseCents(input) {
  let text = String(input ?? '').trim().replace(/[€\s\u00a0]/g, '');
  if (!text) throw new Error('Inserisci un saldo. Zero è un valore valido.');
  if (!/^-?[\d.,]+$/.test(text)) throw new Error('Usa un importo come 1234,56.');
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      if (!/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) throw new Error('Controlla i separatori dell’importo.');
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      if (!/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(text)) throw new Error('Controlla i separatori dell’importo.');
      text = text.replace(/,/g, '');
    }
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error('Usa al massimo due cifre dopo la virgola.');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const value = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_CENTS) throw new Error('Importo troppo grande.');
  return Object.is(value, -0) ? 0 : value;
}
export function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, entries: [], accounts: [], transactions: [] };
}
export function monthAtInstant(instant) {
  if (!isInstant(instant)) throw new Error('Data della verifica non valida.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}`;
}
function cleanMonthlySnapshot(entry) {
  if (entry.verifiedAt === undefined && entry.accountBalances === undefined) return {};
  if (!isInstant(entry.verifiedAt) || monthAtInstant(entry.verifiedAt) !== entry.month || !Array.isArray(entry.accountBalances) || !entry.accountBalances.length || entry.accountBalances.length > 100) throw new Error('La verifica mensile dei conti non è valida.');
  const seen = new Set();
  const accountBalances = entry.accountBalances.map(item => {
    if (!item || typeof item.accountId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.accountId) || seen.has(item.accountId) || typeof item.name !== 'string' || !item.name.trim() || [...item.name.trim()].length > 60 || !Number.isSafeInteger(item.balanceCents) || Math.abs(item.balanceCents) > MAX_CENTS) throw new Error('Un saldo mensile di un conto non è valido.');
    seen.add(item.accountId);
    return { accountId: item.accountId, name: item.name.trim(), balanceCents: item.balanceCents };
  }).sort((a, b) => a.accountId.localeCompare(b.accountId));
  if (accountBalances.reduce((sum, item) => sum + item.balanceCents, 0) !== entry.balanceCents) throw new Error('Il totale mensile non corrisponde ai saldi dei conti.');
  return { verifiedAt: entry.verifiedAt, accountBalances };
}
/** Accepts old 60-month backups, discarding only their empty placeholder rows. */
export function validateState(raw) {
  if (Number.isInteger(raw?.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION) throw new ArchiveUpdateRequiredError();
  if (!raw || ![1, 2, 3].includes(raw.schemaVersion)) throw new Error('Il file non è un backup compatibile con Flowly. Aggiorna l’app se necessario.');
  const target = raw.settings?.targetCents, deadline = raw.settings?.deadline;
  const unset = target === null && deadline === null;
  if (!unset && (!Number.isSafeInteger(target) || target <= 0 || target > MAX_CENTS)) throw new Error('L’obiettivo deve essere un importo positivo.');
  if (!unset && !isDate(deadline)) throw new Error('La data dell’obiettivo non è valida.');
  if (!Array.isArray(raw.entries) || raw.entries.length > 119988) throw new Error('L’elenco dei saldi nel backup non è valido.');
  const seen = new Set();
  const entries = raw.entries.map(entry => {
    if (!entry || !isMonth(entry.month) || seen.has(entry.month)) throw new Error('Nel backup ci sono mesi non validi o duplicati.');
    seen.add(entry.month);
    if (entry.balanceCents !== null && (!Number.isSafeInteger(entry.balanceCents) || Math.abs(entry.balanceCents) > MAX_CENTS)) throw new Error('Un saldo nel backup non è valido.');
    if (typeof entry.note !== 'string' || entry.note.length > 500) throw new Error('Le note possono contenere al massimo 500 caratteri.');
    return { month: entry.month, balanceCents: entry.balanceCents, note: entry.note, ...cleanMonthlySnapshot(entry) };
  }).filter(entry => entry.balanceCents !== null || entry.note !== '').sort((a, b) => a.month.localeCompare(b.month));
  if (raw.settings.goalChosen !== undefined && typeof raw.settings.goalChosen !== 'boolean') throw new Error('La conferma dell’obiettivo non è valida.');
  if (unset && raw.settings.goalChosen === true) throw new Error('Scegli importo e scadenza prima di confermare l’obiettivo.');
  const day = raw.settings.reminderDay ?? 1;
  if (!Number.isInteger(day) || day < 1 || day > 31 || raw.settings.reminderDay === null) throw new Error('Scegli un giorno del mese da 1 a 31.');
  const ledger = validateLedger(raw.schemaVersion < 3 ? [] : raw.accounts, raw.schemaVersion < 3 ? [] : raw.transactions);
  return { schemaVersion: SCHEMA_VERSION, settings: { targetCents: target, deadline, ...(raw.settings.goalChosen === true ? { goalChosen: true } : {}), ...(day !== 1 ? { reminderDay: day } : {}) }, entries, ...ledger };
}
export const hasGoal = state => Number.isSafeInteger(state.settings.targetCents) && state.settings.targetCents > 0 && isDate(state.settings.deadline);
export function requiresGoalSetup(state, isAdmin = false) {
  if (!hasGoal(state)) return true;
  return !isAdmin && state.settings.targetCents === 5000000 && state.settings.deadline === '2030-12-31' && state.settings.goalChosen !== true;
}
export function pendingAccessRequests(profile, users) {
  return profile?.is_admin === true ? (users || []).filter(user => user.status === 'pending' && !user.is_admin) : [];
}
export function entryFor(state, month) {
  return state.entries.find(entry => entry.month === month) || { month, balanceCents: null, note: '' };
}
export function setEntry(state, entry) {
  const draft = validateState(state);
  draft.entries = draft.entries.filter(existing => existing.month !== entry.month);
  draft.entries.push(entry);
  return validateState(draft);
}
/** A recorded month's original account set survives later renames or exclusions. */
export function monthlyAccountRows(state, month) {
  const recorded = entryFor(state, month).accountBalances;
  const rows = recorded ? recorded.map(item => ({ ...item, name: state.accounts.find(account => account.id === item.accountId)?.name || item.name })) : [];
  for (const account of state.accounts.filter(account => !account.archived)) {
    if (!rows.some(row => row.accountId === account.id) && (!recorded || monthAtInstant(account.openingAt) <= month)) rows.push({ accountId: account.id, name: account.name, balanceCents: null });
  }
  return rows;
}
/** Save all verified balances and their total atomically. Older snapshots never rewind live checkpoints. */
export function reconcileMonthly(state, { month, verifiedAt, balances, note = '' }, now = new Date().toISOString()) {
  const draft = validateState(state);
  if (!isMonth(month) || !isInstant(now) || !isInstant(verifiedAt) || verifiedAt > now || monthAtInstant(verifiedAt) !== month) throw new Error('Scegli una data della verifica nel mese indicato, non futura.');
  const expected = monthlyAccountRows(draft, month);
  if (!expected.length) throw new Error('Aggiungi almeno un conto o un’attività prima di verificare i saldi.');
  if (!Array.isArray(balances) || balances.length !== expected.length || new Set(balances.map(item => item.accountId)).size !== expected.length || expected.some(row => !balances.some(item => item.accountId === row.accountId))) throw new Error('Inserisci il saldo corretto di tutti i conti elencati.');
  const accountBalances = expected.map(row => ({ ...row, balanceCents: balances.find(item => item.accountId === row.accountId).balanceCents }));
  const balanceCents = accountBalances.reduce((sum, item) => sum + item.balanceCents, 0);
  const entry = { month, balanceCents, note, verifiedAt, accountBalances };
  cleanMonthlySnapshot(entry);
  draft.accounts = draft.accounts.map(account => {
    const row = accountBalances.find(item => item.accountId === account.id);
    return row && verifiedAt >= account.openingAt ? { ...account, openingCents: row.balanceCents, openingAt: verifiedAt } : account;
  });
  return setEntry(draft, entry);
}
export function deltaFor(state, month) {
  const current = entryFor(state, month);
  const previous = monthIndex(month) > 12 ? entryFor(state, shiftMonth(month, -1)) : null;
  return current.balanceCents === null || !previous || previous.balanceCents === null ? null : current.balanceCents - previous.balanceCents;
}
export function remainingMonths(month, deadline) {
  if (!isDate(deadline)) throw new Error('Scadenza non valida.');
  return Math.max(0, monthIndex(deadline.slice(0, 7)) - monthIndex(month) + 1);
}
/** Saving plan as of today: equal monthly deposits, including the current month.
 * Future snapshots never count as money already available. Amounts round up to
 * a whole cent so the suggested deposits cover the target. */
export function goalPlan(state, today) {
  if (!isDate(today)) throw new Error('La data di calcolo non è valida.');
  const last = state.entries.filter(entry => entry.balanceCents !== null && entry.month <= today.slice(0, 7)).sort((a, b) => a.month.localeCompare(b.month)).at(-1) || null;
  const accountCount = (state.accounts || []).filter(account => !account.archived).length;
  const usesAccounts = accountCount > 0;
  const balanceCents = usesAccounts ? totalBalance(state) : last?.balanceCents ?? null;
  if (!hasGoal(state)) return { today, last, balanceCents, usesAccounts, accountCount, monthsLeft: null, missingCents: null, monthlyCents: null, deadlinePassed: false };
  const monthsLeft = today > state.settings.deadline ? 0 : remainingMonths(today.slice(0, 7), state.settings.deadline);
  const missingCents = balanceCents === null ? null : Math.max(0, state.settings.targetCents - balanceCents);
  return { today, last, balanceCents, usesAccounts, accountCount, monthsLeft, missingCents,
    monthlyCents: missingCents === null ? null : missingCents === 0 ? 0 : monthsLeft ? Math.ceil(missingCents / monthsLeft) : null,
    deadlinePassed: today > state.settings.deadline && missingCents !== null && missingCents > 0 };
}
export const reminderDay = state => state.settings.reminderDay ?? 1;
export function reminderDate(month, day) {
  if (!isMonth(month) || !Number.isInteger(day) || day < 1 || day > 31) throw new Error('Data del promemoria non valida.');
  let date;
  do { date = `${month}-${String(day--).padStart(2, '0')}`; } while (!isDate(date));
  return date;
}
/** Active reminders persist until the balance is registered.
 * Recorded zero counts as complete; notes without a balance do not. */
export function balanceReminders(state, today) {
  if (!isDate(today)) throw new Error('La data del promemoria non è valida.');
  const current = today.slice(0, 7);
  const existing = new Set(state.entries.filter(entry => entry.balanceCents !== null).map(entry => entry.month));
  const active = (state.accounts || []).filter(account => !account.archived);
  const currentEntry = entryFor(state, current);
  if (active.length && (!currentEntry.verifiedAt || active.some(account => !currentEntry.accountBalances?.some(item => item.accountId === account.id)))) existing.delete(current);
  const start = state.entries.map(entry => entry.month).filter(month => month <= current).sort()[0] || current;
  const reminders = [];
  const count = monthIndex(current) - monthIndex(start);
  for (let offset = count; offset >= 0; offset--) {
    const month = shiftMonth(start, offset);
    const startsOn = reminderDate(month, reminderDay(state));
    const dueDate = reminderDate(month, Math.min(31, Number(startsOn.slice(-2)) + 4));
    if (!existing.has(month) && today >= startsOn) reminders.push({ month, dueDate, overdue: today > dueDate });
  }
  return reminders;
}
export function stats(state) {
  const recorded = state.entries.filter(entry => entry.balanceCents !== null).sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(recorded.map(entry => [entry.month, entry]));
  const changeOf = entry => {
    const prev = monthIndex(entry.month) > 12 ? byMonth.get(shiftMonth(entry.month, -1)) : null;
    return prev ? entry.balanceCents - prev.balanceCents : null;
  };
  const first = recorded[0], last = recorded.at(-1);
  const change = last ? deltaFor(state, last.month) : null;
  const previous = last && monthIndex(last.month) > 12 ? entryFor(state, shiftMonth(last.month, -1)) : null;
  const growth = recorded.length > 1 ? last.balanceCents - first.balanceCents : null;
  const elapsedMonths = recorded.length > 1 ? monthIndex(last.month) - monthIndex(first.month) : 0;
  const gap = last && hasGoal(state) ? Math.max(0, state.settings.targetCents - last.balanceCents) : null;
  const months = last && hasGoal(state) ? remainingMonths(last.month, state.settings.deadline) : null;
  const deltas = recorded.map(changeOf).filter(value => value !== null);
  const annual = new Map();
  for (const entry of recorded) {
    const year = Number(entry.month.slice(0, 4));
    const item = annual.get(year) || { year, count: 0, first: entry.balanceCents };
    item.count++; item.last = entry.balanceCents; annual.set(year, item);
  }
  return {
    recorded, first, last, change, gap, months,
    progress: last && hasGoal(state) ? last.balanceCents / state.settings.targetCents : null,
    rate: change !== null && previous?.balanceCents > 0 ? change / previous.balanceCents : null,
    growth, growthRate: growth !== null && first.balanceCents > 0 ? growth / first.balanceCents : null,
    averageMonthlyChange: elapsedMonths ? Math.round(growth / elapsedMonths) || 0 : null, elapsedMonths,
    needed: last && hasGoal(state) ? gap === 0 ? 0 : months > 0 ? gap / months : null : null,
    deadlinePassed: Boolean(last && months === 0 && gap > 0),
    up: deltas.filter(value => value > 0).length,
    down: deltas.filter(value => value < 0).length,
    stable: deltas.filter(value => value === 0).length,
    over: hasGoal(state) ? recorded.filter(entry => entry.balanceCents >= state.settings.targetCents).length : 0,
    annual: [...annual.values()].map(item => ({ year: item.year, count: item.count, last: item.last, change: item.count > 1 ? item.last - item.first : null }))
  };
}
export function csvFor(state) {
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const amount = value => value === null ? '' : (value / 100).toFixed(2).replace('.', ',');
  const rows = [['Data', 'Saldo verificato (€)', 'Variazione (€)', 'Variazione (%)', 'Nota']];
  const byMonth = new Map(state.entries.map(entry => [entry.month, entry]));
  for (const entry of state.entries) {
    const previous = monthIndex(entry.month) > 12 ? byMonth.get(shiftMonth(entry.month, -1)) : null;
    const change = entry.balanceCents !== null && previous?.balanceCents != null ? entry.balanceCents - previous.balanceCents : null;
    const rate = change !== null && previous?.balanceCents > 0 ? (100 * change / previous.balanceCents).toFixed(2).replace('.', ',') : '';
    const note = /^[=+@\-\t\r]/.test(entry.note) ? "'" + entry.note : entry.note;
    rows.push([entry.verifiedAt ? new Date(entry.verifiedAt).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : `01/${entry.month.slice(5)}/${entry.month.slice(0, 4)}`, amount(entry.balanceCents), amount(change), rate, note]);
  }
  return '\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n');
}
