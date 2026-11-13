import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, validateState, setEntry } from '../public/model.js';
import * as L from '../public/ledger.js';
import { mergeArchives, samePayload } from '../public/sync-merge.js';
import { accountsMarkup } from '../public/accounts-ui.js';
const fineco = { id: '11111111-1111-4111-8111-111111111111', name: 'Fineco', openingCents: 200000, openingAt: '2026-11-13T09:00:00.000Z', currency: 'EUR', archived: false };
const revolut = { ...fineco, id: '22222222-2222-4222-8222-222222222222', name: 'Revolut', openingCents: 50000 };
const payment = { id: '33333333-3333-4333-8333-333333333333', accountId: fineco.id, amountCents: -2550, occurredAt: '2026-11-13T10:00:00.000Z', merchant: 'Supermercato', source: 'apple-pay', voided: false };
const initial = () => L.setAccount(L.setAccount(emptyState(), fineco), revolut);

test('a card payment affects only its account and the total, preserving monthly snapshots', () => {
  const before = setEntry(initial(), { month: '2026-11', balanceCents: 250000, note: '' });
  const state = L.addTransaction(before, payment);
  assert.equal(L.accountBalance(state, fineco.id), 197450);
  assert.equal(L.accountBalance(state, revolut.id), 50000);
  assert.equal(L.totalBalance(state), 247450);
  assert.deepEqual(state.entries, before.entries);
  assert.equal(before.transactions.length, 0);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))), state);
});
test('reconciliation is exact, retains history, and handles a late arriving older event', () => {
  let state = L.addTransaction(initial(), payment);
  state = L.setAccount(state, { ...fineco, openingCents: 150000, openingAt: '2026-11-13T12:00:00.000Z' });
  state = L.addTransaction(state, { ...payment, id: '44444444-4444-4444-8444-444444444444', amountCents: -1000, occurredAt: '2026-11-13T11:00:00.000Z' });
  assert.equal(L.accountBalance(state, fineco.id), 150000);
  state = L.addTransaction(state, { ...payment, id: '55555555-5555-4555-8555-555555555555', occurredAt: '2026-11-13T13:00:00.000Z', source: 'manual', amountCents: 2500 });
  assert.equal(L.accountBalance(state, fineco.id), 152500);
  state = L.voidTransaction(state, payment.id);
  assert.equal(L.accountBalance(state, fineco.id), 152500);
  assert.equal(state.transactions.length, 3);
});
test('annulling a movement restores its amount once; duplicate identities cannot double-charge', () => {
  let state = L.addTransaction(initial(), payment);
  assert.equal(L.addTransaction(state, payment), state);
  assert.throws(() => L.addTransaction(state, { ...payment, amountCents: -3000 }));
  state = L.voidTransaction(state, payment.id);
  assert.equal(L.totalBalance(state), 250000);
  assert.equal(L.totalBalance(L.voidTransaction(state, payment.id)), 250000);
});
test('invalid ledger backups are rejected before saving', () => {
  const state = L.addTransaction(initial(), payment);
  for (const change of [{ amountCents: 0 }, { amountCents: 0.5 }, { amountCents: 50 }, { accountId: crypto.randomUUID() }, { occurredAt: '2026-02-30T10:00:00.000Z' }, { voided: 'false' }, { source: 'unknown' }]) assert.throws(() => validateState({ ...state, transactions: [{ ...payment, ...change }] }));
  assert.throws(() => validateState({ ...state, accounts: [{ ...fineco, currency: 'USD' }] }));
  assert.throws(() => validateState({ ...state, transactions: [payment, payment] }));
  assert.throws(() => validateState({ ...state, accounts: [...state.accounts, fineco] }));
  assert.throws(() => L.setAccount(state, { ...fineco, openingCents: -100000000000 }));
});
test('archived accounts are excluded from total and reject new movements', () => {
  const state = L.setAccount(initial(), { ...fineco, archived: true });
  assert.equal(L.totalBalance(state), 50000);
  assert.throws(() => L.addTransaction(state, payment));
});
test('old backups keep their monthly data and start without invented accounts', () => {
  const old = { schemaVersion: 2, settings: { targetCents: null, deadline: null }, entries: [{ month: '2026-10', balanceCents: 250000, note: 'storico' }] };
  const state = validateState(old);
  assert.deepEqual(state.entries, old.entries);
  assert.deepEqual(state.accounts, []); assert.deepEqual(state.transactions, []);
});
test('simultaneous payments and a manual movement merge without losing or duplicating charges', () => {
  const base = initial();
  const local = L.addTransaction(base, payment);
  const other = { ...payment, id: '44444444-4444-4444-8444-444444444444', accountId: revolut.id, source: 'manual', amountCents: -1000 };
  const remote = L.addTransaction(base, other);
  const result = mergeArchives(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(L.totalBalance(result.payload), 246450);
  assert.equal(mergeArchives(base, local, local).payload.transactions.length, 1);
  assert.ok(samePayload(result.payload, mergeArchives(base, remote, local).payload));
});
test('renaming a bank merges with its checkpoint; two conflicting checkpoints stay atomic', () => {
  const base = initial(), local = L.setAccount(base, { ...fineco, name: 'Fineco personale' });
  const remote = L.setAccount(base, { ...fineco, openingCents: 170000, openingAt: '2026-11-13T12:00:00.000Z' });
  const merged = mergeArchives(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.payload.accounts.find(a => a.id === fineco.id).name, 'Fineco personale');
  assert.equal(L.accountBalance(merged.payload, fineco.id), 170000);
  const conflicting = L.setAccount(base, { ...fineco, openingCents: 180000, openingAt: '2026-11-13T11:00:00.000Z' });
  assert.equal(mergeArchives(base, conflicting, remote).conflicts[0].path, `accounts.${fineco.id}.checkpoint`);
  assert.equal(mergeArchives(base, conflicting, remote, 'remote').payload.accounts.find(a => a.id === fineco.id).openingAt, '2026-11-13T12:00:00.000Z');
});
test('restore versus a new payment produces a resolvable conflict instead of an orphan', () => {
  const base = initial(), local = emptyState(), remote = L.addTransaction(base, payment);
  const result = mergeArchives(base, local, remote);
  assert.ok(result.conflicts.some(item => item.path === 'ledger'));
  assert.deepEqual(result.payload.accounts, []);
  const selected = mergeArchives(base, local, remote, 'remote');
  assert.equal(L.totalBalance(selected.payload), 247450);
});
test('account names and transaction descriptions are escaped and values obey privacy masking', () => {
  const state = L.addTransaction(L.setAccount(initial(), { ...fineco, name: '<script>bad</script>' }), { ...payment, merchant: '<img src=x onerror=alert(1)>' });
  const html = accountsMarkup(state, () => '••••', { full: true });
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('1974')); assert.ok(html.includes('••••'));
});
