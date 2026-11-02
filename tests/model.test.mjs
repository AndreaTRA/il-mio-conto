import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/model.js';

const add = (state, month, balanceCents, note = '') => M.setEntry(state, { month, balanceCents, note });
test('balances continue beyond 2030 and goals can move to a later date', () => {
  let state = add(M.emptyState(), '2031-12', 1_000_000);
  state = add(state, '2032-01', 1_100_000);
  state = add(state, '2042-05', 2_000_000);
  state.settings.deadline = '2045-12-31';
  const stats = M.stats(M.validateState(state));
  assert.equal(stats.last.month, '2042-05');
  assert.equal(stats.months, 44);
  assert.equal(stats.growth, 1_000_000);
  assert.equal(stats.change, null);
  assert.deepEqual(stats.annual.map(item => item.year), [2031, 2032, 2042]);
  assert.equal(M.deltaFor(state, '2032-01'), 100_000);
  assert.equal(M.monthsForYear(2055).at(-1), '2055-12');
});
test('missing, zero and negative balances have different meanings', () => {
  let state = add(M.emptyState(), '2026-01', 0);
  assert.equal(M.stats(state).last.balanceCents, 0);
  assert.equal(M.stats(state).growth, null);
  state = add(state, '2026-02', 10000);
  assert.equal(M.stats(state).change, 10000);
  assert.equal(M.stats(state).rate, null);
  state = add(state, '2026-02', null);
  state = add(state, '2026-03', -5000);
  assert.equal(M.stats(state).change, null);
  assert.equal(M.stats(state).growth, -5000);
  assert.equal(M.stats(state).growthRate, null);
  assert.equal(state.entries.length, 2);
});
test('deadline includes the opening month and expired goals do not block tracking', () => {
  let state = add(M.emptyState(), '2030-12', 4_900_000);
  assert.equal(M.stats(state).needed, 100_000);
  state = add(state, '2031-01', 4_900_000);
  assert.equal(M.stats(state).months, 0);
  assert.equal(M.stats(state).needed, null);
  assert.equal(M.stats(state).deadlinePassed, true);
  state = add(state, '2031-02', 5_200_000);
  assert.equal(M.stats(state).needed, 0);
  assert.equal(M.stats(state).deadlinePassed, false);
  assert.equal(M.stats(state).progress, 1.04);
});
test('old 60-month backups migrate without losing actual zero values or notes', () => {
  const old = { schemaVersion: 1, settings: { ...M.DEFAULT_SETTINGS }, entries: Array.from({ length: 60 }, (_, index) => ({ month: `${2026 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`, balanceCents: null, note: '' })) };
  old.entries[0].balanceCents = 0;
  old.entries[1].balanceCents = 50000;
  old.entries[10].note = 'Nota senza saldo';
  const migrated = M.validateState(old);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.entries.length, 3);
  assert.equal(migrated.entries[0].balanceCents, 0);
  assert.equal(migrated.entries[2].note, 'Nota senza saldo');
  assert.equal(old.entries.length, 60);
});
test('annual growth uses first and last snapshot, never adds balances or percentages', () => {
  let state = add(M.emptyState(), '2034-01', 100000);
  state = add(state, '2034-02', 150000);
  state = add(state, '2034-12', 200000);
  state = add(state, '2035-01', 210000);
  const stats = M.stats(state);
  assert.equal(stats.annual[0].change, 100000);
  assert.equal(stats.annual[0].last, 200000);
  assert.equal(stats.annual[1].change, null);
  assert.equal(stats.up, 2);
  assert.equal(stats.growth, 110000);
});
test('amount parsing is exact and rejects malformed separators and extra precision', () => {
  for (const [text, expected] of [['1.234,56', 123456], ['1234.56', 123456], ['1,234.56', 123456], ['1.234', 123400], ['0', 0], ['-0,01', -1], [' € 25,50 ', 2550], ['999999.99', 99999999]]) assert.equal(M.parseCents(text), expected, text);
  for (const text of ['', '1e6', '1.23,45', '1,,2', '1,234', '1.23456', 'NaN']) assert.throws(() => M.parseCents(text), undefined, text);
});
test('dates, duplicates and future schema versions are validated before replacing data', () => {
  assert.equal(M.isDate('2032-02-29'), true);
  assert.equal(M.isDate('2100-02-29'), false);
  assert.equal(M.isDate('2400-02-29'), true);
  assert.equal(M.isDate('2031-04-31'), false);
  assert.equal(M.isMonth('0000-01'), false);
  assert.equal(M.shiftMonth('0001-01', 0), '0001-01');
  assert.throws(() => M.shiftMonth('9999-12', 1));
  assert.throws(() => M.validateState({ ...M.emptyState(), schemaVersion: 99 }));
  assert.throws(() => M.validateState({ ...M.emptyState(), entries: [{ month: '2035-01', balanceCents: 0, note: '' }, { month: '2035-01', balanceCents: 1, note: '' }] }));
  assert.throws(() => M.validateState({ ...M.emptyState(), settings: { targetCents: 0, deadline: '2035-12-31' } }));
  assert.throws(() => M.validateState({ ...M.emptyState(), entries: [{ month: '2035-01', balanceCents: 1.25, note: '' }] }));
});
test('CSV includes new years and escapes formulas and delimiters in notes', () => {
  let state = add(M.emptyState(), '2045-01', -50, '=HYPERLINK("x");nota');
  state = add(state, '2045-02', 0, 'Riga\ncon "virgolette"');
  const csv = M.csvFor(state);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('01/01/2045'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('"-0,50"'));
  assert.ok(csv.includes('"0,00"'));
  assert.ok(csv.includes('"Riga\ncon ""virgolette"""'));
});

test('saving plan starts today, even when the latest snapshot is older', () => {
 const state=add(M.emptyState(),'2026-10',1_000_000);
 const plan=M.goalPlan(state,'2026-11-02');
 assert.equal(plan.monthsLeft,50);assert.equal(plan.missingCents,4_000_000);assert.equal(plan.monthlyCents,80_000);
 assert.equal(M.stats(state).months,51);
 assert.equal(plan.last.month,'2026-10');
});
test('saving deposits round up, respect a passed deadline and preserve zero', () => {
 const state=add(M.emptyState(),'2030-11',4_999_999);
 assert.equal(M.goalPlan(state,'2030-11-30').monthlyCents,1);
 assert.equal(M.goalPlan(state,'2030-12-31').monthlyCents,1);
 assert.equal(M.goalPlan(state,'2031-01-01').monthlyCents,null);
 assert.equal(M.goalPlan(state,'2031-01-01').deadlinePassed,true);
 const reached=add(state,'2030-12',5_100_000);
 assert.equal(M.goalPlan(reached,'2031-01-01').monthlyCents,0);
 const zero=add(M.emptyState(),'2026-11',0);
 assert.equal(M.goalPlan(zero,'2026-11-02').missingCents,5_000_000);
});
test('a future snapshot is not counted as a current balance', () => {
 let state=add(M.emptyState(),'2035-01',8_000_000);
 assert.equal(M.goalPlan(state,'2026-11-02').monthlyCents,null);
 state=add(state,'2026-10',2_000_000);
 assert.equal(M.goalPlan(state,'2026-11-02').missingCents,3_000_000);
 assert.throws(()=>M.goalPlan(state,'2026-02-30'));
});
