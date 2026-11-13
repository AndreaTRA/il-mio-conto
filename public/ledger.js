/** Account balances are checkpoints plus subsequent movements, always in cents. */
export const MAX_CENTS = 100_000_000_000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const isInstant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && value.slice(0, 4) >= '0001' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const cents = value => Number.isSafeInteger(value) && Math.abs(value) <= MAX_CENTS;
export function validateLedger(accounts, transactions) {
  if (!Array.isArray(accounts) || accounts.length > 100 || !Array.isArray(transactions) || transactions.length > 10000) throw new Error('Archivio dei conti non valido o troppo grande.');
  const ids = new Set();
  const cleanAccounts = accounts.map(account => {
    if (!account || !uuid(account.id) || ids.has(account.id) || typeof account.name !== 'string' || !account.name.trim() || [...account.name.trim()].length > 60 || !cents(account.openingCents) || !isInstant(account.openingAt) || account.currency !== 'EUR' || typeof account.archived !== 'boolean') throw new Error('Un conto non è valido. Usa un nome, un saldo in euro e una data validi.');
    ids.add(account.id);
    return { id: account.id, name: account.name.trim(), openingCents: account.openingCents, openingAt: account.openingAt, currency: 'EUR', archived: account.archived };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set();
  const cleanTransactions = transactions.map(item => {
    if (!item || !uuid(item.id) || seen.has(item.id) || !ids.has(item.accountId) || !cents(item.amountCents) || item.amountCents === 0 || !isInstant(item.occurredAt) || typeof item.merchant !== 'string' || [...item.merchant].length > 140 || !['manual', 'apple-pay'].includes(item.source) || typeof item.voided !== 'boolean' || item.source === 'apple-pay' && item.amountCents > 0) throw new Error('Una transazione non è valida o non appartiene a un conto.');
    seen.add(item.id);
    return { id: item.id, accountId: item.accountId, amountCents: item.amountCents, occurredAt: item.occurredAt, merchant: item.merchant, source: item.source, voided: item.voided };
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  const clean = { accounts: cleanAccounts, transactions: cleanTransactions };
  for (const account of cleanAccounts) if (!cents(accountBalance(clean, account.id))) throw new Error('Il saldo risultante del conto supera il limite consentito.');
  return clean;
}
export function accountBalance(state, accountId) {
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) throw new Error('Conto non trovato.');
  return account.openingCents + state.transactions.reduce((total, item) => total + (item.accountId === accountId && !item.voided && item.occurredAt > account.openingAt ? item.amountCents : 0), 0);
}
export const totalBalance = state => state.accounts.filter(account => !account.archived).reduce((total, account) => total + accountBalance(state, account.id), 0);
export function setAccount(state, account) {
  const accounts = state.accounts.filter(item => item.id !== account.id).concat(account);
  return { ...state, ...validateLedger(accounts, state.transactions) };
}
export function addTransaction(state, transaction) {
  const existing = state.transactions.find(item => item.id === transaction.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(transaction)) throw new Error('Questo identificativo è già usato da un’altra transazione.');
    return state;
  }
  if (state.accounts.find(account => account.id === transaction.accountId)?.archived) throw new Error('Riattiva il conto prima di registrare un movimento.');
  return { ...state, ...validateLedger(state.accounts, [...state.transactions, transaction]) };
}
export function voidTransaction(state, id) {
  if (!state.transactions.some(item => item.id === id)) throw new Error('Transazione non trovata.');
  return { ...state, ...validateLedger(state.accounts, state.transactions.map(item => item.id === id ? { ...item, voided: true } : item)) };
}
