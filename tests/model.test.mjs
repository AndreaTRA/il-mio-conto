import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/model.js';

const configuredState = () => ({ ...M.emptyState(), settings: { targetCents: 5_000_000, deadline: '2030-12-31' } });
test('new accounts have no goal and cannot receive a savings forecast until it is chosen', () => {
  let state = M.emptyState();
  assert.deepEqual(state.settings, { targetCents: null, deadline: null });
  assert.equal(M.hasGoal(state), false);
  state = M.setEntry(state, { month: '2026-11', balanceCents: 100000, note: '' });
  assert.equal(M.stats(state).gap, null);
  assert.equal(M.stats(state).progress, null);
  assert.equal(M.goalPlan(state, '2026-11-03').monthlyCents, null);
  assert.deepEqual(M.validateState(JSON.parse(JSON.stringify(state))), state);
  for (const settings of [{ targetCents: null, deadline: '2030-12-31' }, { targetCents: 5000000, deadline: null }]) assert.throws(() => M.validateState({ ...state, settings }));
  state.settings = { targetCents: 2000000, deadline: '2029-06-30' };
  assert.equal(M.hasGoal(M.validateState(state)), true);
  assert.ok(M.goalPlan(state, '2026-11-03').monthlyCents > 0);
});
test('access-request notifications are limited to administrators and pending non-admin accounts', () => {
  const users = [{ status: 'pending', user_id: 'a' }, { status: 'pending', user_id: 'b' }, { status: 'approved' }, { status: 'blocked' }, { status: 'pending', is_admin: true }];
  assert.equal(M.pendingAccessRequests({ is_admin: true }, users).length, 2);
  assert.deepEqual(M.pendingAccessRequests({ is_admin: false }, users), []);
  assert.deepEqual(M.pendingAccessRequests(null, users), []);
  users[0].status = 'approved';
  assert.equal(M.pendingAccessRequests({ is_admin: true }, users).length, 1);
});
test('legacy automatic goals ask non-admin users to choose without changing their archive', () => {
  const state = configuredState(), before = JSON.stringify(state);
  assert.equal(M.requiresGoalSetup(state), true);
  assert.equal(M.requiresGoalSetup(state, true), false);
  assert.equal(JSON.stringify(state), before);
  state.settings.goalChosen = true;
  assert.equal(M.requiresGoalSetup(M.validateState(state)), false);
  state.settings.targetCents = 7000000; delete state.settings.goalChosen;
  assert.equal(M.requiresGoalSetup(state), false);
  assert.equal(M.requiresGoalSetup(M.emptyState(), true), true);
});
const add = (state, month, balanceCents, note = '') => M.setEntry(state, { month, balanceCents, note });
test('balances continue beyond 2030 and goals can move to a later date', () => {
  let state = add(configuredState(), '2031-12', 1_000_000);
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
  let state = add(configuredState(), '2026-01', 0);
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
  let state = add(configuredState(), '2030-12', 4_900_000);
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
  const old = { schemaVersion: 1, settings: { targetCents: 5_000_000, deadline: '2030-12-31' }, entries: Array.from({ length: 60 }, (_, index) => ({ month: `${2026 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`, balanceCents: null, note: '' })) };
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
  let state = add(configuredState(), '2034-01', 100000);
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
  assert.throws(() => M.validateState({ ...configuredState(), schemaVersion: 99 }));
  assert.throws(() => M.validateState({ ...configuredState(), entries: [{ month: '2035-01', balanceCents: 0, note: '' }, { month: '2035-01', balanceCents: 1, note: '' }] }));
  assert.throws(() => M.validateState({ ...configuredState(), settings: { targetCents: 0, deadline: '2035-12-31' } }));
  assert.throws(() => M.validateState({ ...configuredState(), entries: [{ month: '2035-01', balanceCents: 1.25, note: '' }] }));
});
test('CSV includes new years and escapes formulas and delimiters in notes', () => {
  let state = add(configuredState(), '2045-01', -50, '=HYPERLINK("x");nota');
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
 const state=add(configuredState(),'2026-10',1_000_000);
 const plan=M.goalPlan(state,'2026-11-02');
 assert.equal(plan.monthsLeft,50);assert.equal(plan.missingCents,4_000_000);assert.equal(plan.monthlyCents,80_000);
 assert.equal(M.stats(state).months,51);
 assert.equal(plan.last.month,'2026-10');
});
test('saving deposits round up, respect a passed deadline and preserve zero', () => {
 const state=add(configuredState(),'2030-11',4_999_999);
 assert.equal(M.goalPlan(state,'2030-11-30').monthlyCents,1);
 assert.equal(M.goalPlan(state,'2030-12-31').monthlyCents,1);
 assert.equal(M.goalPlan(state,'2031-01-01').monthlyCents,null);
 assert.equal(M.goalPlan(state,'2031-01-01').deadlinePassed,true);
 const reached=add(state,'2030-12',5_100_000);
 assert.equal(M.goalPlan(reached,'2031-01-01').monthlyCents,0);
 const zero=add(configuredState(),'2026-11',0);
 assert.equal(M.goalPlan(zero,'2026-11-02').missingCents,5_000_000);
});
test('a future snapshot is not counted as a current balance', () => {
 let state=add(configuredState(),'2035-01',8_000_000);
 assert.equal(M.goalPlan(state,'2026-11-02').monthlyCents,null);
 state=add(state,'2026-10',2_000_000);
 assert.equal(M.goalPlan(state,'2026-11-02').missingCents,3_000_000);
 assert.throws(()=>M.goalPlan(state,'2026-02-30'));
});

test('monthly reminders start on day one and remain overdue after day five', () => {
 const state=add(configuredState(),'2026-10',10000);
 assert.deepEqual(M.balanceReminders(state,'2026-11-01'),[{month:'2026-11',dueDate:'2026-11-05',overdue:false}]);
 assert.equal(M.balanceReminders(state,'2026-11-05')[0].overdue,false);
 assert.equal(M.balanceReminders(state,'2026-11-06')[0].overdue,true);
 assert.equal(M.balanceReminders(state,'2026-11-30')[0].month,'2026-11');
});
test('unfilled reminders survive month and year changes until their balance is recorded', () => {
 let state=add(configuredState(),'2026-10',10000);
 assert.deepEqual(M.balanceReminders(state,'2026-12-01').map(r=>r.month),['2026-12','2026-11']);
 state=add(state,'2026-12',20000);
 assert.deepEqual(M.balanceReminders(state,'2027-01-01').map(r=>r.month),['2027-01','2026-11']);
 state=add(state,'2026-11',0);
 assert.deepEqual(M.balanceReminders(state,'2027-01-01').map(r=>r.month),['2027-01']);
});
test('zero satisfies a reminder, a note alone does not and deleting a balance reopens it', () => {
 let state=add(configuredState(),'2035-03',null,'da aggiornare');
 assert.equal(M.balanceReminders(state,'2035-03-02').length,1);
 state=add(state,'2035-03',0);
 assert.equal(M.balanceReminders(state,'2035-03-02').length,0);
 state=add(state,'2035-03',null,'da aggiornare');
 assert.equal(M.balanceReminders(state,'2035-03-20').length,1);
});
test('reminders work for an empty archive and ignore future months', () => {
 assert.deepEqual(M.balanceReminders(configuredState(),'2045-01-01').map(r=>r.month),['2045-01']);
 const state=add(add(configuredState(),'2045-01',10),'2045-03',30);
 assert.equal(M.balanceReminders(state,'2045-01-05').length,0);
 assert.deepEqual(M.balanceReminders(state,'2045-02-06').map(r=>r.month),['2045-02']);
 assert.throws(()=>M.balanceReminders(state,'2045-02-30'));
});
test('monthly average uses elapsed calendar months instead of number of observations', () => {
 let state=add(add(configuredState(),'2026-01',10000),'2026-04',40000);
 assert.equal(M.stats(state).averageMonthlyChange,10000);assert.equal(M.stats(state).elapsedMonths,3);
 state=add(state,'2026-04',0);
 assert.equal(M.stats(state).averageMonthlyChange,-3333);
 assert.equal(M.stats(add(configuredState(),'2026-01',10000)).averageMonthlyChange,null);
 assert.equal(M.stats(add(add(configuredState(),'2026-01',10000),'2026-03',10000)).averageMonthlyChange,0);
});
