import AirDatepicker from './air-datepicker-3.6.0.js';
import localeIt from './air-datepicker-it.js';
import { localDateValue, parseDateValue, dateButtonLabel } from './date-values.js';
const pad=n=>String(n).padStart(2,'0');
export function initializeCalendarUi() {
 let picker=null,input=null,kind='',selection=null,opener=null,original=null,timeChanged=false;
 const controls=new Map();
 document.body.insertAdjacentHTML('beforeend',`<dialog id="calendar-dialog" aria-labelledby="calendar-title" class="calendar-dialog"><div class="calendar-header"><div><p class="eyebrow">CALENDARIO</p><h2 id="calendar-title">Scegli la data</h2></div><button type="button" class="icon-button" data-calendar-close aria-label="Chiudi calendario">×</button></div><p id="calendar-selection" class="calendar-selection" aria-live="polite"></p><div id="calendar-surface" tabindex="-1"></div><div id="calendar-time-row" hidden><label for="calendar-time">Ora</label><input id="calendar-time" type="time" step="60"></div><div class="calendar-quick"><button type="button" class="button secondary" id="calendar-today">Oggi</button><span>Puoi cambiare mese e anno dal titolo.</span></div><div class="calendar-actions"><button type="button" class="button secondary" data-calendar-close>Annulla</button><button type="button" class="button primary" id="calendar-confirm">Conferma data</button></div></dialog>`);
 const dialog=document.getElementById('calendar-dialog'),surface=document.getElementById('calendar-surface'),time=document.getElementById('calendar-time');
 const refresh=()=>{
  for(const [field,button]of controls){if(!field.isConnected){controls.delete(field);continue;}const value=dateButtonLabel(field.value,field.dataset.calendarKind);if(button.querySelector('.date-trigger-value').textContent!==value)button.querySelector('.date-trigger-value').textContent=value;button.classList.toggle('is-empty',!field.value);button.disabled=field.disabled;}
 };
 const enhance=()=>{
  for(const field of document.querySelectorAll('input[type="date"],input[type="month"],input[type="datetime-local"]')){
   if(!field.id||controls.has(field))continue;
   const fieldKind=field.type,button=document.createElement('button');button.type='button';button.id=field.id+'-choose';button.className='date-trigger';button.dataset.dateField=field.id;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','calendar-dialog');
   const value=document.createElement('span');value.className='date-trigger-value';const icon=document.createElement('span');icon.className='date-trigger-icon';icon.setAttribute('aria-hidden','true');icon.textContent='▦';button.append(value,icon);
   const label=document.querySelector(`label[for="${field.id}"]`);if(label)label.htmlFor=button.id;
   if(field.getAttribute('aria-describedby'))button.setAttribute('aria-describedby',field.getAttribute('aria-describedby'));
   if(field.required)button.setAttribute('aria-required','true');
   field.dataset.calendarKind=fieldKind;field.type='hidden';field.after(button);controls.set(field,button);
  }
  refresh();
 };
 function selectedDate(){if(!selection)return null;const date=new Date(selection);if(kind==='datetime-local'){const [h,m]=time.value.split(':').map(Number);date.setHours(h||0,m||0,timeChanged?0:original?.getSeconds()||0,timeChanged?0:original?.getMilliseconds()||0);}return date;}
 function report(){const date=selectedDate();document.getElementById('calendar-selection').textContent=date?dateButtonLabel(localDateValue(date,kind),kind):'Scegli una data nel calendario.';}
 function decorate(){
  if(!picker)return;
  const cells=[...surface.querySelectorAll('.air-datepicker-cell')];let focusSet=false;
  for(const cell of cells){cell.setAttribute('role','button');cell.setAttribute('aria-disabled',String(cell.classList.contains('-disabled-')));cell.setAttribute('aria-pressed',String(cell.classList.contains('-selected-')));const target=!focusSet&&!cell.classList.contains('-disabled-')&&(cell.classList.contains('-focus-')||cell.classList.contains('-selected-'));cell.tabIndex=target?0:-1;if(target)focusSet=true;}
  if(!focusSet){const first=cells.find(c=>!c.classList.contains('-disabled-'));if(first)first.tabIndex=0;}
  for(const action of surface.querySelectorAll('.air-datepicker-nav--action,.air-datepicker-nav--title')){action.tabIndex=0;action.setAttribute('role','button');action.setAttribute('aria-label',action.dataset.action==='prev'?'Periodo precedente':action.dataset.action==='next'?'Periodo successivo':'Cambia mese o anno');}
 }
 function render(){
  picker?.destroy();surface.replaceChildren();
  const min=parseDateValue(input.getAttribute('min'),kind)||parseDateValue('0001-01-01','date');
  let max=parseDateValue(input.getAttribute('max'),kind)||parseDateValue('9999-12-31','date');
  if(['monthly-month','monthly-date','movement-date'].includes(input.id))max=new Date();
  picker=new AirDatepicker(surface,{inline:true,locale:localeIt,view:kind==='month'?'months':'days',minView:kind==='month'?'months':'days',dateFormat:kind==='month'?'MMMM yyyy':'d MMMM yyyy',startDate:selection,selectedDates:[selection],minDate:min,maxDate:max,keyboardNav:false,toggleSelected:false,showOtherMonths:true,fixedHeight:true,prevHtml:'<span aria-hidden="true">‹</span>',nextHtml:'<span aria-hidden="true">›</span>',navTitles:{days:'MMMM <i>yyyy</i>',months:'yyyy',years:'yyyy1 – yyyy2'},onSelect:({date})=>{if(date&&!Array.isArray(date)){selection=new Date(date);report();queueMicrotask(decorate);}},onChangeView:()=>queueMicrotask(decorate),onChangeViewDate:()=>queueMicrotask(decorate),onRenderCell:({date,cellType})=>({attrs:{'aria-label':new Intl.DateTimeFormat('it-IT',cellType==='year'?{year:'numeric'}:cellType==='month'?{year:'numeric',month:'long'}:{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(date),'data-flowly-date':localDateValue(date,'date')}})});
  decorate();report();
 }
 function open(field,button){
  input=field;kind=field.dataset.calendarKind;opener=button;original=parseDateValue(field.value,kind);selection=new Date(original||new Date());timeChanged=false;
  document.getElementById('calendar-title').textContent=kind==='month'?'Scegli il mese':'Scegli la data';document.getElementById('calendar-time-row').hidden=kind!=='datetime-local';time.value=`${pad(selection.getHours())}:${pad(selection.getMinutes())}`;
  render();dialog.showModal();(surface.querySelector('.air-datepicker-cell[tabindex="0"]')||surface).focus();
 }
 document.addEventListener('click',event=>{const button=event.target.closest('[data-date-field]');if(button){const field=document.getElementById(button.dataset.dateField);if(field)open(field,button);}});
 dialog.addEventListener('click',event=>{if(event.target.closest('[data-calendar-close]'))dialog.close();});
 dialog.addEventListener('close',()=>{picker?.destroy();picker=null;surface.replaceChildren();const target=opener;input=null;selection=null;opener=null;if(target?.isConnected)target.focus({preventScroll:true});});
 time.addEventListener('input',()=>{timeChanged=true;report();});
 document.getElementById('calendar-today').addEventListener('click',()=>{selection=new Date();time.value=`${pad(selection.getHours())}:${pad(selection.getMinutes())}`;timeChanged=false;original=new Date(selection);render();});
 document.getElementById('calendar-confirm').addEventListener('click',()=>{const date=selectedDate();if(!date||!input)return;const field=input;field.value=localDateValue(date,kind);dialog.close();field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));refresh();});
 surface.addEventListener('keydown',event=>{
  const cell=event.target.closest('.air-datepicker-cell');
  if(!cell){if(['Enter',' '].includes(event.key)&&event.target.matches('[role="button"]')){event.preventDefault();event.target.click();}return;}
  if(['Enter',' '].includes(event.key)){event.preventDefault();cell.click();queueMicrotask(decorate);return;}
  const moves={ArrowLeft:-1,ArrowRight:1,ArrowUp:picker.currentView==='days'?-7:picker.currentView==='months'?-3:-4,ArrowDown:picker.currentView==='days'?7:picker.currentView==='months'?3:4};
  if(!(event.key in moves))return;event.preventDefault();const next=parseDateValue(cell.dataset.flowlyDate,'date');
  if(picker.currentView==='days')next.setDate(next.getDate()+moves[event.key]);else if(picker.currentView==='months')next.setMonth(next.getMonth()+moves[event.key]);else next.setFullYear(next.getFullYear()+moves[event.key]);
  if(next.getFullYear()<1||next.getFullYear()>9999)return;
  picker.setViewDate(next);picker.setFocusDate(next);decorate();
  const focus=surface.querySelector(`[data-flowly-date="${localDateValue(next,'date')}"]`);if(focus&&!focus.classList.contains('-disabled-')){surface.querySelectorAll('.air-datepicker-cell').forEach(c=>c.tabIndex=-1);focus.tabIndex=0;focus.focus();}
 });
 const observer=new MutationObserver(enhance);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});enhance();
 return {refresh:enhance};
}
