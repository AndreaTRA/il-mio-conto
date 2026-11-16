const pad=n=>String(n).padStart(2,'0');
export function localDateValue(date,kind) {
 const day=`${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
 return kind==='month'?day.slice(0,7):kind==='date'?day:`${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3,'0')}`;
}
export function parseDateValue(value,kind) {
 const match=String(value||'').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
 if(!match || (kind==='month' && !/^\d{4}-\d{2}$/.test(value)) || (kind==='date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) || (kind==='datetime-local' && !String(value).includes('T')))return null;
 const [,y,m,d='01',h='12',min='00',sec='00',ms='0']=match;
 const date=new Date(0);date.setFullYear(Number(y),Number(m)-1,Number(d));date.setHours(Number(h),Number(min),Number(sec),Number(ms.padEnd(3,'0')));
 if(Number(h)>23||Number(min)>59||Number(sec)>59||Number(y)<1||Number(y)>9999||date.getFullYear()!==Number(y)||date.getMonth()!==Number(m)-1||date.getDate()!==Number(d))return null;
 return date;
}
export function dateButtonLabel(value,kind) {
 const date=parseDateValue(value,kind);
 if(!date)return kind==='month'?'Scegli il mese':'Scegli la data';
 return new Intl.DateTimeFormat('it-IT',{year:'numeric',month:'long',...(kind==='month'?{}:{day:'numeric'}),...(kind==='datetime-local'?{hour:'2-digit',minute:'2-digit'}:{})}).format(date);
}
