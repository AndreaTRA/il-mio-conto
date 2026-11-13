import { emptyState, validateState } from './model.js';

export const samePayload = (a, b) => JSON.stringify(validateState(a)) === JSON.stringify(validateState(b));
export const sameIdentity = (a, b) => Boolean(a && b && a.projectUrl === b.projectUrl && a.userId === b.userId);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MISSING = Symbol('missing');
const isBlank = payload => samePayload(payload, emptyState()) || (
  payload.entries.length === 0 && payload.accounts.length === 0 && payload.transactions.length === 0 &&
  payload.settings.targetCents === 5000000 && payload.settings.deadline === '2030-12-31' &&
  payload.settings.goalChosen !== true && (payload.settings.reminderDay ?? 1) === 1
);

/** Three-way merge. Missing months are deletions only when a shared base exists. */
export function mergeArchives(baseInput, localInput, remoteInput, preference = null) {
  const local = validateState(localInput), remote = validateState(remoteInput);
  const base = baseInput ? validateState(baseInput) : null;
  if (!base && isBlank(local)) return { payload: remote, conflicts: [] };
  if (!base && isBlank(remote)) return { payload: local, conflicts: [] };
  const conflicts = [];
  function pick(path, baseline, left, right) {
    if (same(left, right)) return left;
    if (baseline !== MISSING) {
      if (same(left, baseline)) return right;
      if (same(right, baseline)) return left;
    }
    conflicts.push({ path, local: left === MISSING ? null : left, remote: right === MISSING ? null : right });
    return preference === 'remote' ? right : left;
  }
  let settings = {};
  const goalOnly = archive => { const { reminderDay, ...goal } = archive.settings; return goal; };
  if ([base, local, remote].some(archive => archive && (archive.settings.targetCents === null || archive.settings.goalChosen === true))) settings = pick('settings', base ? goalOnly(base) : MISSING, goalOnly(local), goalOnly(remote));
  else for (const field of ['targetCents', 'deadline']) settings[field] = pick(`settings.${field}`, base ? base.settings[field] : MISSING, local.settings[field], remote.settings[field]);
  const day = pick('settings.reminderDay', base ? base.settings.reminderDay ?? 1 : MISSING, local.settings.reminderDay ?? 1, remote.settings.reminderDay ?? 1);
  if (day !== 1) settings = { ...settings, reminderDay: day };
  const maps = [base?.entries || [], local.entries, remote.entries].map(entries => new Map(entries.map(entry => [entry.month, entry])));
  const months = [...new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])].sort();
  const entries = [];
  for (const month of months) {
    const baseline = maps[0].get(month), left = maps[1].get(month), right = maps[2].get(month);
    if (same(left, right)) { if (left) entries.push(left); continue; }
    if (base && same(left, baseline)) { if (right) entries.push(right); continue; }
    if (base && same(right, baseline)) { if (left) entries.push(left); continue; }
    if (!base && !left) { entries.push(right); continue; }
    if (!base && !right) { entries.push(left); continue; }
    if (!left || !right) {
      const selected = pick(`entries.${month}`, baseline ?? MISSING, left ?? MISSING, right ?? MISSING);
      if (selected !== MISSING) entries.push(selected);
      continue;
    }
    const entry = { month };
    if (baseline?.accountBalances || left.accountBalances || right.accountBalances) {
      const snapshot = item => item ? { balanceCents: item.balanceCents, ...(item.accountBalances ? { verifiedAt: item.verifiedAt, accountBalances: item.accountBalances } : {}) } : MISSING;
      Object.assign(entry, pick(`entries.${month}.snapshot`, snapshot(baseline), snapshot(left), snapshot(right)));
      entry.note = pick(`entries.${month}.note`, baseline ? baseline.note : MISSING, left.note, right.note);
    } else for (const field of ['balanceCents', 'note']) entry[field] = pick(`entries.${month}.${field}`, baseline ? baseline[field] : MISSING, left[field], right[field]);
    entries.push(entry);
  }
  // Checkpoints are atomic: an amount must always travel with its timestamp.
  // Movements are merged by immutable identity so simultaneous card payments add up.
  const mergeRows = (key, fields) => {
    const maps = [base?.[key] || [], local[key], remote[key]].map(rows => new Map(rows.map(row => [row.id, row])));
    return [...new Set(maps.flatMap(map => [...map.keys()]))].sort().flatMap(id => {
      const [baseline, left, right] = maps.map(map => map.get(id));
      if (same(left, right)) return left ? [left] : [];
      if (base && same(left, baseline)) return right ? [right] : [];
      if (base && same(right, baseline)) return left ? [left] : [];
      if (!base && !left) return [right];
      if (!base && !right) return [left];
      if (!left || !right || key === 'transactions') {
        const selected = pick(`${key}.${id}`, baseline ?? MISSING, left ?? MISSING, right ?? MISSING);
        return selected === MISSING ? [] : [selected];
      }
      const row = { id };
      for (const field of fields) row[field] = pick(`${key}.${id}.${field}`, baseline?.[field] ?? MISSING, left[field], right[field]);
      const checkpoint = item => item ? { openingCents: item.openingCents, openingAt: item.openingAt } : MISSING;
      Object.assign(row, pick(`${key}.${id}.checkpoint`, checkpoint(baseline), checkpoint(left), checkpoint(right)));
      return [row];
    });
  };
  const accounts = mergeRows('accounts', ['name', 'currency', 'archived']);
  const transactions = mergeRows('transactions', []);
  // A deletion/import versus a new payment is a ledger-level conflict, never a silent loss.
  const orphans = transactions.some(item => !accounts.some(account => account.id === item.accountId));
  let ledger = { accounts, transactions };
  if (orphans) ledger = pick('ledger', base ? { accounts: base.accounts, transactions: base.transactions } : MISSING, { accounts: local.accounts, transactions: local.transactions }, { accounts: remote.accounts, transactions: remote.transactions });
  return { payload: validateState({ schemaVersion: 3, settings, entries, ...ledger }), conflicts };
}
export function conflictFingerprint(local, remote, version) {
  return JSON.stringify([validateState(local), validateState(remote), version]);
}
