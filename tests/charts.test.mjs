import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { historyChart, historyOption, allocationMarkup, allocationOption, goalOption } from '../public/charts.js';
import { accountsMarkup } from '../public/accounts-ui.js';
const money=value=>`EUR ${value}`;
const entries=[{month:'2026-01',balanceCents:10000},{month:'2026-02',balanceCents:null},{month:'2026-03',balanceCents:0},{month:'2026-04',balanceCents:-5000}];
test('history preserves null gaps, zero and negative balances without deriving a second series',()=>{
 const option=historyOption(entries,{mode:'bar',money});
 assert.deepEqual(option.series[0].data,[10000,null,0,-5000]);assert.equal(option.series.length,1);
 assert.equal(option.series[0].showBackground,true);assert.equal(option.yAxis.min,undefined);
});
test('annual columns provide twelve ordered months and rounded violet bars with structural tracks',()=>{
 const months=Array.from({length:12},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,balanceCents:i===2?null:i*100}));
 const option=historyOption(months);
 assert.deepEqual(option.xAxis.data,['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']);
 assert.equal(option.xAxis.axisLabel.interval,0);assert.equal(option.series[0].itemStyle.color,'#9276f5');
 assert.equal(option.series[0].itemStyle.borderRadius,22);assert.equal(option.series[0].data[2],null);
 assert.equal(option.series[0].backgroundStyle.borderRadius,24);
});
test('line series do not join missing months; financial options never substitute null with zero',()=>{
 const option=historyOption(entries,{mode:'line'});
 assert.equal(option.series[0].connectNulls,false);assert.equal(option.series[0].data[1],null);assert.equal(option.series[0].showBackground,false);
});
test('reduced motion disables chart animation and stagger delays',()=>{
 const option=historyOption(entries,{reduced:true});assert.equal(option.animation,false);assert.equal(option.series[0].animationDelay(10),0);
 assert.equal(goalOption(.5,{reduced:true}).animation,false);
});
test('empty and single-point history options remain usable without invented entries',()=>{
 assert.deepEqual(historyOption([]).series[0].data,[]);
 assert.deepEqual(historyOption([entries[0]]).series[0].data,[10000]);
});
test('tooltip distinguishes a missing month, zero and negative values',()=>{
 const formatter=historyOption(entries,{money}).tooltip.formatter;
 assert.ok(formatter([{dataIndex:1}]).includes('Non registrato'));
 assert.ok(formatter([{dataIndex:2}]).includes('EUR 0'));
 assert.ok(formatter([{dataIndex:3}]).includes('EUR -5000'));
});
test('concealment omits ECharts containers, account amounts and shares entirely',()=>{
 const markup=historyChart({visible:false});assert.ok(!/echart|data-chart-kind|EUR|svg/.test(markup));
 const result=allocationMarkup({accounts:[{id:'a',name:'Conto',openingCents:123456,archived:false,openingAt:''}],transactions:[]},money,false);
 assert.ok(!/123456|allocation-row|data-chart-kind|%/.test(result));
});
const state={accounts:[{id:'a',name:'<img src=x onerror=alert(1)>',openingCents:10000,openingAt:'2026-01-01T00:00:00.000Z',archived:false},{id:'b',name:'Risparmi',openingCents:-1000,openingAt:'2026-01-01T00:00:00.000Z',archived:false},{id:'c',name:'Escluso',openingCents:100000,openingAt:'2026-01-01T00:00:00.000Z',archived:true}],transactions:[]};
test('negative and zero-total accounts never produce misleading pie shares',()=>{
 assert.equal(allocationOption([{name:'A',balance:1000},{name:'B',balance:-100}]),null);
 assert.equal(allocationOption([{name:'A',balance:0}]),null);
 const result=allocationMarkup(state,money,true);
 assert.ok(!result.includes('data-chart-kind'));assert.ok(!result.includes('Escluso'));assert.ok(result.includes('EUR -1000'));
});
test('positive allocation preserves exact amounts including zero and escapes tooltip HTML',()=>{
 const option=allocationOption([{name:'<img>',balance:10000},{name:'Zero',balance:0}],{money});
 assert.deepEqual(option.series[0].data,[{name:'<img>',value:10000},{name:'Zero',value:0}]);
 const tooltip=option.tooltip.formatter({name:'<img>',value:10000,percent:100});assert.ok(tooltip.includes('&lt;img&gt;'));assert.ok(!tooltip.includes('<img>'));
});
test('goal ring clamps visual geometry while retaining a complete whole',()=>{
 for(const progress of [-1,0,.4,1,1.5]){
  const data=goalOption(progress).series[0].data;assert.equal(data[0].value+data[1].value,1);assert.ok(data.every(d=>d.value>=0));
 }
});
test('movement filters combine account, direction and case-insensitive text without changing the ledger',()=>{
 const fixture={accounts:[{...state.accounts[0],name:'Principale'}],transactions:[{id:'expense',accountId:'a',amountCents:-100,merchant:'Supermercato',occurredAt:'2026-02-01T00:00:00.000Z',source:'manual',voided:false},{id:'income',accountId:'a',amountCents:500,merchant:'Stipendio',occurredAt:'2026-02-02T00:00:00.000Z',source:'manual',voided:false}]};
 const before=JSON.stringify(fixture),result=accountsMarkup(fixture,money,{full:true,movementsOnly:true,accountFilter:'a',search:'SUPER',kind:'expense'});
 assert.ok(result.startsWith('<section class="panel movements-panel"'));assert.ok(result.includes('<h3>Supermercato</h3>'));assert.ok(!result.includes('<h3>Stipendio</h3>'));assert.equal(JSON.stringify(fixture),before);
});
test('every imported ECharts asset is local, pinned and cached offline with license notices',async()=>{
 const source=await fs.readFile(new URL('../public/charts.js',import.meta.url),'utf8');assert.ok(source.includes("'./echarts-6.1.0.esm.min.js'"));
 const sw=await fs.readFile(new URL('../public/service-worker.js',import.meta.url),'utf8');assert.ok(sw.includes('echarts-6.1.0.esm.min.js'));
 for(const name of ['echarts-LICENSE.txt','echarts-NOTICE.txt'])assert.ok((await fs.stat(new URL('../public/'+name,import.meta.url))).size>0);
});
