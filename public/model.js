/** Pure domain logic. Monetary values are integer cents; missing is null. */
export const SCHEMA_VERSION = 2;
export const DEFAULT_SETTINGS = Object.freeze({ targetCents: 5_000_000, deadline: '2030-12-31' });
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
  return { schemaVersion: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, entries: [] };
}
/** Accepts old 60-month backups, discarding only their empty placeholder rows. */
export function validateState(raw) {
  if (!raw || ![1, 2].includes(raw.schemaVersion)) throw new Error('Il file non è un backup compatibile con Flowly.');
  const target = raw.settings?.targetCents, deadline = raw.settings?.deadline;
  if (!Number.isSafeInteger(target) || target <= 0 || target > MAX_CENTS) throw new Error('L’obiettivo deve essere un importo positivo.');
  if (!isDate(deadline)) throw new Error('La data dell’obiettivo non è valida.');
  if (!Array.isArray(raw.entries) || raw.entries.length > 119988) throw new Error('L’elenco dei saldi nel backup non è valido.');
  const seen = new Set();
  const entries = raw.entries.map(entry => {
    if (!entry || !isMonth(entry.month) || seen.has(entry.month)) throw new Error('Nel backup ci sono mesi non validi o duplicati.');
    seen.add(entry.month);
    if (entry.balanceCents !== null && (!Number.isSafeInteger(entry.balanceCents) || Math.abs(entry.balanceCents) > MAX_CENTS)) throw new Error('Un saldo nel backup non è valido.');
    if (typeof entry.note !== 'string' || entry.note.length > 500) throw new Error('Le note possono contenere al massimo 500 caratteri.');
    return { month: entry.month, balanceCents: entry.balanceCents, note: entry.note };
  }).filter(entry => entry.balanceCents !== null || entry.note !== '').sort((a, b) => a.month.localeCompare(b.month));
  return { schemaVersion: SCHEMA_VERSION, settings: { targetCents: target, deadline }, entries };
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
  const monthsLeft = today > state.settings.deadline ? 0 : remainingMonths(today.slice(0, 7), state.settings.deadline);
  const missingCents = last ? Math.max(0, state.settings.targetCents - last.balanceCents) : null;
  return { today, last, monthsLeft, missingCents,
    monthlyCents: missingCents === null ? null : missingCents === 0 ? 0 : monthsLeft ? Math.ceil(missingCents / monthsLeft) : null,
    deadlinePassed: today > state.settings.deadline && missingCents !== null && missingCents > 0 };
}
/** Active reminders persist after the fifth until the balance is registered.
 * Recorded zero counts as complete; notes without a balance do not. */
export function balanceReminders(state, today) {
  if (!isDate(today)) throw new Error('La data del promemoria non è valida.');
  const current = today.slice(0, 7);
  const existing = new Set(state.entries.filter(entry => entry.balanceCents !== null).map(entry => entry.month));
  const start = state.entries.map(entry => entry.month).filter(month => month <= current).sort()[0] || current;
  const reminders = [];
  const count = monthIndex(current) - monthIndex(start);
  for (let offset = count; offset >= 0; offset--) {
    const month = shiftMonth(start, offset);
    if (!existing.has(month)) reminders.push({ month, dueDate: month + '-05', overdue: today > month + '-05' });
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
  const gap = last ? Math.max(0, state.settings.targetCents - last.balanceCents) : null;
  const months = last ? remainingMonths(last.month, state.settings.deadline) : null;
  const deltas = recorded.map(changeOf).filter(value => value !== null);
  const annual = new Map();
  for (const entry of recorded) {
    const year = Number(entry.month.slice(0, 4));
    const item = annual.get(year) || { year, count: 0, first: entry.balanceCents };
    item.count++; item.last = entry.balanceCents; annual.set(year, item);
  }
  return {
    recorded, first, last, change, gap, months,
    progress: last ? last.balanceCents / state.settings.targetCents : null,
    rate: change !== null && previous?.balanceCents > 0 ? change / previous.balanceCents : null,
    growth, growthRate: growth !== null && first.balanceCents > 0 ? growth / first.balanceCents : null,
    averageMonthlyChange: elapsedMonths ? Math.round(growth / elapsedMonths) || 0 : null, elapsedMonths,
    needed: last ? gap === 0 ? 0 : months > 0 ? gap / months : null : null,
    deadlinePassed: Boolean(last && months === 0 && gap > 0),
    up: deltas.filter(value => value > 0).length,
    down: deltas.filter(value => value < 0).length,
    stable: deltas.filter(value => value === 0).length,
    over: recorded.filter(entry => entry.balanceCents >= state.settings.targetCents).length,
    annual: [...annual.values()].map(item => ({ year: item.year, count: item.count, last: item.last, change: item.count > 1 ? item.last - item.first : null }))
  };
}
export function csvFor(state) {
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const amount = value => value === null ? '' : (value / 100).toFixed(2).replace('.', ',');
  const rows = [['Data', 'Saldo iniziale (€)', 'Variazione (€)', 'Variazione (%)', 'Nota']];
  const byMonth = new Map(state.entries.map(entry => [entry.month, entry]));
  for (const entry of state.entries) {
    const previous = monthIndex(entry.month) > 12 ? byMonth.get(shiftMonth(entry.month, -1)) : null;
    const change = entry.balanceCents !== null && previous?.balanceCents != null ? entry.balanceCents - previous.balanceCents : null;
    const rate = change !== null && previous?.balanceCents > 0 ? (100 * change / previous.balanceCents).toFixed(2).replace('.', ',') : '';
    const note = /^[=+@\-\t\r]/.test(entry.note) ? "'" + entry.note : entry.note;
    rows.push([`01/${entry.month.slice(5)}/${entry.month.slice(0, 4)}`, amount(entry.balanceCents), amount(change), rate, note]);
  }
  return '\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n');
}
