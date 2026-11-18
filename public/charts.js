/** Local, accessible SVG charts. No network, persisted data, or financial calculations. */
import { accountBalance } from './ledger.js';
import * as echarts from './echarts-6.1.0.esm.min.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label = month => `${month.slice(5)}/${month.slice(0, 4)}`;
const monthName = month => new Date(`${month}-01T12:00:00`).toLocaleDateString('it-IT', {month:'long', year:'numeric'});
export const privateChart = () => '<div class="private-chart"><span class="privacy-symbol" aria-hidden="true">••••</span><p>Importi al sicuro</p><p>Mostra i numeri con l’occhio per esplorare il grafico.</p></div>';

export function historyChart({ visible, mode = 'line', primary = false }) {
  if (!visible) return privateChart();
  return chartMarkup(primary ? 'monthly' : 'history', mode === 'bar' ? 'Saldi mensili, grafico a colonne' : 'Andamento dei saldi nel tempo');
}
export function chartMarkup(kind, description) {
  return `<div class="chart-block"><div class="echart" data-chart-kind="${esc(kind)}" tabindex="0" role="group" aria-label="${esc(description)}. Usa frecce, Home e End per esplorare i dati."></div><p class="chart-selection" aria-live="polite">Passa sul grafico o tocca per i dettagli.</p></div>`;
}

export function allocationMarkup(state, money, visible) {
  const accounts=state.accounts.filter(a=>!a.archived).map(a=>({...a,balance:accountBalance(state,a.id)}));
  const total=accounts.reduce((sum,a)=>sum+a.balance,0);
  const canUseShares=total>0&&accounts.every(a=>a.balance>=0);
  const header='<div class="section-top"><div><p class="eyebrow">IL TUO PATRIMONIO</p><h2>Come è distribuito</h2></div><a class="text-link" href="#conti">Gestisci ↗</a></div>';
  if(!visible)return `<section class="panel allocation-panel">${header}${privateChart()}</section>`;
  if(!accounts.length)return `<section class="panel allocation-panel">${header}<div class="private-chart"><p>Un posto per ogni conto</p><p>Aggiungi i tuoi conti per vedere la distribuzione.</p><button class="button secondary" data-ledger="new-account">Aggiungi conto</button></div></section>`;
  // A pie of negative balances would imply misleading percentages. Use signed values instead.
  return `<section class="panel allocation-panel">${header}${canUseShares ? chartMarkup('allocation', 'Distribuzione dei saldi tra i conti') : '<p class="chart-footnote">Saldi a zero o negativi: sono mostrati gli importi, senza quote percentuali.</p>'}<div class="allocation-list">${accounts.map((a,i)=>`<a href="#conti/${esc(a.id)}" class="allocation-row"><span class="allocation-key tone-${i%4}"></span><span>${esc(a.name)}</span><strong>${esc(money(a.balance))}</strong>${canUseShares?`<small>${(a.balance/total*100).toLocaleString('it-IT',{maximumFractionDigits:1})}%</small>`:''}</a>`).join('')}</div><p class="chart-footnote">Saldi correnti dei conti inclusi nel totale.</p></section>`;

}


const palette = ['#9276f5','#65b69f','#c7e68a','#81a8cc'];
const defaultMoney = cents => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(cents/100);
const compactMoney = cents => `${(cents/100).toLocaleString('it-IT',{notation:'compact',maximumFractionDigits:1})} €`;
const commonOption = reduced => ({backgroundColor:'transparent',textStyle:{fontFamily:'Manrope, system-ui, sans-serif'},animation:!reduced,animationDuration:850,animationDurationUpdate:600,animationEasing:'cubicOut',animationEasingUpdate:'cubicInOut',tooltip:{confine:true,backgroundColor:'#111615',borderColor:'#40504c',borderWidth:1,padding:[10,13],textStyle:{color:'#f1f5f3',fontFamily:'Manrope',fontSize:12},extraCssText:'border-radius:10px;box-shadow:0 8px 24px #0004;'}});

/** Options are pure: tests can inspect the financial semantics without a browser. */
export function historyOption(entries,{mode='bar',compact=false,reduced=false,money=defaultMoney,spark=false}={}) {
  const option=commonOption(reduced), allYear=entries.length===12&&entries.every(e=>e.month.slice(0,4)===entries[0].month.slice(0,4));
  const months=['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  const categories=entries.map(e=>allYear?months[Number(e.month.slice(5))-1]:label(e.month));
  const values=entries.map(e=>e.balanceCents);
  return {...option,
    grid:{top:spark?5:20,left:spark?3:compact?42:48,right:spark?3:12,bottom:spark?5:compact?43:32},
    tooltip:{...option.tooltip,trigger:'axis',axisPointer:{type:mode==='bar'?'shadow':'line',shadowStyle:{color:'#ffffff05'},lineStyle:{color:'#78918a',type:'dashed'}},formatter:params=>{const p=params[0],e=entries[p?.dataIndex];return e?`<span style="color:#a8b9b3">${esc(monthName(e.month))}</span><br><strong>${e.balanceCents===null?'Non registrato':esc(money(e.balanceCents))}</strong>`:'';}},
    xAxis:{type:'category',data:categories,boundaryGap:mode==='bar',axisLine:{show:false},axisTick:{show:false},axisLabel:{show:!spark,interval:allYear?0:'auto',color:'#97a6a1',fontSize:compact?10:11,lineHeight:12,formatter:(value,index)=>compact&&allYear?(index%2?'\n'+value:value+'\n'):value,margin:12,hideOverlap:!allYear}},
    yAxis:{type:'value',show:!spark,min:values.some(v=>v!==null&&v<0)?undefined:0,splitNumber:4,axisLine:{show:false},axisTick:{show:false},axisLabel:{show:values.some(v=>v!==null),color:'#8b9b95',fontSize:compact?9:10,formatter:compactMoney},splitLine:{show:mode==='line'&&!spark,lineStyle:{color:'#34403c',opacity:.45,type:'dashed'}}},
    series:[{id:'verified-balances',name:'Saldo verificato',type:mode==='bar'?'bar':'line',data:values,connectNulls:false,smooth:false,showSymbol:!spark,symbol:'circle',symbolSize:6,lineStyle:{color:'#6cbba4',width:spark?2:2.5},areaStyle:mode==='line'?{color:'#5fa48f',opacity:.045}:undefined,
      itemStyle:{color:mode==='bar'?'#9276f5':'#6cbba4',borderRadius:22},barWidth:allYear?'78%':'60%',barMaxWidth:compact?19:46,barMinHeight:3,
      showBackground:mode==='bar',backgroundStyle:{color:'#2a3334',borderRadius:24,opacity:.85},
      selectedMode:'single',select:{itemStyle:{color:'#b8a4ff',borderColor:'#d9ceff',borderWidth:1}},emphasis:{itemStyle:{color:mode==='bar'?'#ac94fa':'#a5e0cc'},scale:true},animationDelay:i=>reduced?0:Math.min(i*35,420)}]
  };
}

export function allocationOption(accounts,{money=defaultMoney,reduced=false}={}) {
  if(!accounts.length||accounts.some(a=>a.balance<0)||accounts.reduce((sum,a)=>sum+a.balance,0)<=0)return null;
  const base=commonOption(reduced);
  return {...base,color:palette,tooltip:{...base.tooltip,trigger:'item',formatter:p=>`${esc(p.name)}<br><strong>${esc(money(p.value))}</strong> · ${p.percent}%`},series:[{id:'account-shares',type:'pie',radius:['64%','84%'],center:['50%','50%'],avoidLabelOverlap:true,label:{show:false},labelLine:{show:false},itemStyle:{borderWidth:3,borderColor:'#202a28',borderRadius:5},emphasis:{scale:true,scaleSize:5},selectedMode:'single',data:accounts.map(a=>({name:a.name,value:a.balance}))}]};
}
export function goalOption(progress,{reduced=false}={}) {
  const value=Math.max(0,Math.min(1,progress));
  return {...commonOption(reduced),color:['#6ab69d','#303c37'],tooltip:{...commonOption(reduced).tooltip,trigger:'item',formatter:p=>`${esc(p.name)}: ${(p.value*100).toLocaleString('it-IT',{maximumFractionDigits:1})}%`},series:[{id:'goal-progress',type:'pie',radius:['77%','91%'],silent:false,label:{show:false},labelLine:{show:false},startAngle:90,emphasis:{scale:false},data:[{name:'Raggiunto',value:value,itemStyle:{borderRadius:8}},{name:'Da raggiungere',value:1-value}]}]};
}

const instances=new Map();
export function disposeCharts(){for(const {chart,observer} of instances.values()){observer.disconnect();chart.dispose();}instances.clear();}
export function mountCharts(root,{state,summary,entries,visible,mode='bar'}) {
  const active=new Set(), reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!visible){disposeCharts();return;}
  const accounts=state.accounts.filter(a=>!a.archived).map(a=>({...a,balance:accountBalance(state,a.id)}));
  for(const placeholder of root.querySelectorAll('[data-chart-kind]')) {
    const kind=placeholder.dataset.chartKind;active.add(kind);
    let item=instances.get(kind);
    if(item){item.node.setAttribute('aria-label',placeholder.getAttribute('aria-label'));placeholder.replaceWith(item.node);}else{
      const node=placeholder,chart=echarts.init(node,null,{renderer:'svg'}),observer=new ResizeObserver(()=>{if(node.isConnected)chart.resize();});
      observer.observe(node);item={node,chart,observer,index:-1};instances.set(kind,item);
    }
    const {node,chart}=item,compact=node.clientWidth<500;
    let option, labels;
    if(kind==='allocation') {option=allocationOption(accounts,{reduced});labels=accounts.map(a=>`${a.name}: ${defaultMoney(a.balance)}`);}
    else if(kind==='goal') {option=goalOption(summary.progress??0,{reduced});labels=[`Raggiunto: ${((summary.progress??0)*100).toLocaleString('it-IT',{maximumFractionDigits:1})}%`,`Da raggiungere: ${(Math.max(0,1-(summary.progress??0))*100).toLocaleString('it-IT',{maximumFractionDigits:1})}%`];}
    else {option=historyOption(entries,{mode:kind==='monthly'?mode:'line',compact,reduced,spark:kind==='spark'});labels=entries.map(e=>`${monthName(e.month)}: ${e.balanceCents===null?'Non registrato':defaultMoney(e.balanceCents)}`);}
    if(!option){item.observer.disconnect();chart.dispose();instances.delete(kind);node.remove();continue;}
    item.labels=labels;
    // Keep the actual chart node between renders: ECharts can interpolate new data/periods.
    chart.resize();chart.setOption(option,{replaceMerge:['series'],lazyUpdate:false});
    chart.off('mouseover');chart.off('click');chart.off('updateAxisPointer');
    const readout=index=>{const text=node.closest('.chart-block')?.querySelector('.chart-selection');if(text&&labels[index])text.textContent=labels[index];item.index=index;};
    item.readout=readout;
    const selection=node.closest('.chart-block')?.querySelector('.chart-selection');
    if(selection&&!['goal','allocation'].includes(kind)&&entries.every(e=>e.balanceCents===null))selection.textContent='Nessun saldo registrato per questo periodo.';
    chart.on('updateAxisPointer',event=>{const index=event.axesInfo?.[0]?.value;if(Number.isInteger(index))readout(index);});
    chart.on('mouseover',p=>{if(p.dataIndex!==undefined)readout(p.dataIndex);});
    chart.on('click',p=>{if(p.dataIndex===undefined)return;readout(p.dataIndex);chart.dispatchAction({type:'select',seriesIndex:0,dataIndex:p.dataIndex});});
  }
  for(const [kind,item] of instances){if(!active.has(kind)){item.observer.disconnect();item.chart.dispose();instances.delete(kind);}}
}
export function initializeCharts(root,isVisible) {
  root.addEventListener('keydown',event=>{
    const node=event.target.closest('[data-chart-kind]');if(!node||!isVisible())return;
    const item=instances.get(node.dataset.chartKind);if(!item?.labels?.length)return;
    if(event.key==='Escape'){item.chart.dispatchAction({type:'hideTip'});item.chart.dispatchAction({type:'downplay'});return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const last=item.labels.length-1;
    const index=event.key==='Home'?0:event.key==='End'?last:Math.max(0,Math.min(last,item.index+(event.key==='ArrowLeft'?-1:1)));
    item.chart.dispatchAction({type:'downplay'});item.chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:index});item.chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:index});item.readout(index);
  });
}
