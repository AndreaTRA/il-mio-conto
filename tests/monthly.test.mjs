import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/model.js';
import * as L from '../public/ledger.js';
import { mergeArchives } from '../public/sync-merge.js';
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const accounts=ids.map((id,i)=>({id,name:['Fineco','Attività virtuali'][i],openingCents:[200000,50000][i],openingAt:'2026-11-01T00:00:00.000Z',currency:'EUR',archived:false}));
const base=()=>M.validateState({...M.emptyState(),accounts});
const at='2026-11-13T12:00:00.000Z';
const verify=(state,values=[250000,70000],extra={})=>M.reconcileMonthly(state,{month:'2026-11',verifiedAt:at,balances:ids.map((accountId,i)=>({accountId,balanceCents:values[i]})),...extra},at);
test('monthly verification saves each correct balance and the sum, including income missing from Wallet',()=>{
 const state=verify(base());
 assert.equal(L.totalBalance(state),320000);
 assert.deepEqual(state.entries[0].accountBalances.map(a=>a.balanceCents),[250000,70000]);
 assert.equal(state.entries[0].balanceCents,320000);
 assert.equal(state.entries[0].verifiedAt,at);
 assert.deepEqual(M.balanceReminders(state,'2026-11-13'),[]);
 assert.deepEqual(M.validateState(JSON.parse(JSON.stringify(state))),state);
});
test('all balances are required, zeros and negatives are allowed and errors never mutate the original',()=>{
 const state=base(),original=JSON.stringify(state);
 assert.throws(()=>M.reconcileMonthly(state,{month:'2026-11',verifiedAt:at,balances:[{accountId:ids[0],balanceCents:1}]},at));
 assert.throws(()=>verify(state,[250000,null]));
 assert.throws(()=>verify(state,[250000,NaN]));
 assert.equal(JSON.stringify(state),original);
 assert.equal(verify(state,[0,-100]).entries[0].balanceCents,-100);
 assert.throws(()=>verify(state,[100000000000,100000000000]));
});
test('pre-verification expenses are included once; newer payments subtract from the new checkpoint',()=>{
 let state=L.addTransaction(base(),{id:crypto.randomUUID(),accountId:ids[0],amountCents:-2000,occurredAt:'2026-11-13T10:00:00.000Z',merchant:'Spesa',source:'apple-pay',voided:false});
 state=verify(state);
 assert.equal(L.accountBalance(state,ids[0]),250000);
 state=L.addTransaction(state,{id:crypto.randomUUID(),accountId:ids[0],amountCents:-1000,occurredAt:'2026-11-13T13:00:00.000Z',merchant:'Nuova spesa',source:'apple-pay',voided:false});
 assert.equal(L.accountBalance(state,ids[0]),249000);
 assert.equal(state.entries[0].balanceCents,320000);
});
test('a past verification preserves live balances and the actual as-of date survives export',()=>{
 const state=verify(base(),[100000,20000],{month:'2026-10',verifiedAt:'2026-10-13T12:00:00.000Z'});
 assert.equal(L.totalBalance(state),250000);
 assert.equal(state.entries[0].balanceCents,120000);
 assert.match(M.csvFor(state),/13\/10\/2026/);
 assert.throws(()=>verify(base(),undefined,{verifiedAt:'2026-11-14T12:00:00.000Z'}));
 assert.throws(()=>verify(base(),undefined,{month:'2026-10'}));
});
test('new accounts reopen this month’s reminder but retain legacy monthly history',()=>{
 let state=M.setEntry(base(),{month:'2026-10',balanceCents:200000,note:''});
 state=M.setEntry(state,{month:'2026-11',balanceCents:250000,note:''});
 assert.deepEqual(M.balanceReminders(state,'2026-11-13').map(r=>r.month),['2026-11']);
 state=verify(state);
 const extra={...accounts[0],id:crypto.randomUUID(),name:'Revolut',openingAt:'2026-11-13T13:00:00.000Z'};
 state=L.setAccount(state,extra);
 assert.equal(M.monthlyAccountRows(state,'2026-11').length,3);
 assert.deepEqual(M.balanceReminders(state,'2026-11-13').map(r=>r.month),['2026-11']);
 assert.equal(state.entries.find(e=>e.month==='2026-10').balanceCents,200000);
});
test('monthly snapshots reject total mismatches, wrong dates and duplicate account rows',()=>{
 const state=verify(base()),entry=state.entries[0];
 for(const bad of [{...entry,balanceCents:1},{...entry,verifiedAt:'2026-10-13T12:00:00.000Z'},{...entry,accountBalances:[entry.accountBalances[0],entry.accountBalances[0]]}]) assert.throws(()=>M.validateState({...state,entries:[bad]}));
});
test('a monthly verification merges with an arriving card payment without dropping snapshot details',()=>{
 const initial=base(),local=verify(initial),remote=L.addTransaction(initial,{id:crypto.randomUUID(),accountId:ids[0],amountCents:-500,occurredAt:'2026-11-13T13:00:00.000Z',merchant:'POS',source:'apple-pay',voided:false});
 const result=mergeArchives(initial,local,remote);
 assert.equal(result.conflicts.length,0);
 assert.equal(result.payload.entries[0].accountBalances.length,2);
 assert.equal(L.totalBalance(result.payload),319500);
});
test('conflicting monthly verifications keep their breakdown and total together',()=>{
 const initial=verify(base()),local=verify(initial,[260000,70000]),remote=verify(initial,[250000,80000]);
 const result=mergeArchives(initial,local,remote);
 assert.ok(result.conflicts.some(c=>c.path==='entries.2026-11.snapshot'));
 const selected=mergeArchives(initial,local,remote,'remote').payload;
 assert.equal(selected.entries[0].balanceCents,330000);
 assert.equal(selected.entries[0].accountBalances[1].balanceCents,80000);
});
test('the overview total and goal forecast include every active account and new card payments',()=>{
 let state=base();state.settings={targetCents:1000000,deadline:'2026-12-31'};
 state=M.setEntry(state,{month:'2026-11',balanceCents:200000,note:'Solo saldo storico'});
 let plan=M.goalPlan(state,'2026-11-13');
 assert.equal(plan.balanceCents,250000);assert.equal(plan.usesAccounts,true);assert.equal(plan.accountCount,2);
 assert.equal(plan.monthlyCents,375000);
 state=L.addTransaction(state,{id:crypto.randomUUID(),accountId:ids[0],amountCents:-500,occurredAt:'2026-11-13T13:00:00.000Z',merchant:'POS',source:'apple-pay',voided:false});
 plan=M.goalPlan(state,'2026-11-13');assert.equal(plan.balanceCents,249500);assert.equal(plan.missingCents,750500);
 state=L.setAccount(state,{...accounts[1],archived:true});
 assert.equal(M.goalPlan(state,'2026-11-13').balanceCents,199500);
 assert.equal(state.entries[0].balanceCents,200000);
});
