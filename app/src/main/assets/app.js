(function(){
'use strict';
const KEY='reminders_v2';
const GC='Google Calendar';
const $=s=>document.querySelector(s);
let items=[], filter='up', alarmId=null, chosenChip=null, manualTime=false;
let selCat=null, catAuto=true, fCat='all', query='';
const CATS=[
  {k:'personal',n:'אישי',e:'🙂',c:'#7c6cff'},
  {k:'family',n:'משפחה',e:'👨‍👩‍👧',c:'#ff6ca8'},
  {k:'home',n:'בית',e:'🏠',c:'#2fb889'},
  {k:'shop',n:'קניות',e:'🛒',c:'#e39b2d'},
  {k:'work',n:'עבודה',e:'💼',c:'#3e8ef7'},
  {k:'biz',n:'עסק',e:'💰',c:'#c9a227'},
  {k:'health',n:'בריאות',e:'💊',c:'#e5534b'}
];
const CATMAP=Object.fromEntries(CATS.map(c=>[c.k,c]));
const CATKW=[
  ['shop',/לקנות|קניות|סופר|שופרסל|רמי לוי|להזמין|חלב|לחם|ביצים/],
  ['health',/רופא|תרופ|ויטמי|כדור|בדיק|מרפאה|קופת חולים|שיניים|אימון|חדר כושר/],
  ['family',/אמא|אבא|סבא|סבתא|אח |אחות|ילד|אשתי|בעלי|הורים|משפחה|יום הולדת/],
  ['work',/פגישה|מייל|לקוח|ישיבה|דוח|דו"ח|משרד|עבודה|זום|הצעת מחיר/],
  ['biz',/חנות|הזמנ|שופיפיי|יוטיוב|סרטון|פרסום|מודעה|חשבונית|תשלום/],
  ['home',/לנקות|כביסה|זבל|כלים|להשקות|תיקון|חשמל|ארנונה|שכירות/]
];
function guessCat(t){for(const [k,re] of CATKW)if(re.test(t))return k;return null}
let db=null, col=null, mcp=null, gcalReady=false;

/* ---------- local cache ---------- */
function loadLocal(){try{items=JSON.parse(localStorage.getItem(KEY)||'[]')}catch(e){items=[]}}
const NATIVE=!!window.AndroidApp;
function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify(items))}catch(e){}syncAlarms()}
let syncT=null;
function syncAlarms(){
  if(!NATIVE)return;
  clearTimeout(syncT);
  syncT=setTimeout(()=>{
    const now=Date.now(),out=[];
    const ctx=[];
    items.forEach(i=>{
      if(i.done)return;
      if(i.trig){
        if(!i.fired)ctx.push({id:i.id,title:i.title,type:i.trig.type,device:i.trig.device||'',lat:i.trig.lat||0,lng:i.trig.lng||0,radius:150,body:trigLabel(i),nag:!!i.nag,buddy:i.buddy||''});
        return;
      }
      if(!(i.at>now)){
        if(i.nag&&i.fired)out.push({key:i.id,id:i.id,title:i.title,body:fmtWhen(i.at),at:i.at,repeat:i.repeat||'none',kind:'main',early:0,nag:true,buddy:i.buddy||''});
        return;
      }
      out.push({key:i.id,id:i.id,title:i.title,body:fmtWhen(i.at),at:i.at,repeat:i.repeat||'none',kind:'main',early:+i.early||0,nag:!!i.nag,buddy:i.buddy||''});
      const e=+i.early||0;
      if(e&&i.at-e*6e4>now)out.push({key:i.id+'_e',id:i.id,title:i.title,body:rel(i.at).replace('בעוד','זה בעוד'),at:i.at-e*6e4,repeat:'none',kind:'early',early:e});
    });
    try{window.AndroidApp.setAlarms(JSON.stringify(out))}catch(e){}
    try{window.AndroidApp.setContext(JSON.stringify(ctx))}catch(e){}
  },150);
}

/* ---------- cloud persistence (per-user, private) ---------- */
const clean=o=>JSON.parse(JSON.stringify(o));
async function put(i){
  saveLocal();
  if(col){try{await col.doc(i.id).set(clean(i))}catch(e){setSync('err','לא נשמר בענן — נשמר במכשיר')}}
}
async function drop(i){
  saveLocal();
  if(col){try{await col.doc(i.id).delete()}catch(e){}}
}
function setSync(state,text){const el=$('#sync');el.className='sync'+(state?' '+state:'');$('#syncTxt').textContent=text}

async function initCloud(){
  let loaded=false;
  const timer=setTimeout(()=>{if(!loaded)setSync('err','שמור במכשיר הזה בלבד')},10000);
  try{
    const [d,u]=await Promise.all([window.claude.use('db'),window.claude.use('user')]);
    const uid=u?await u.id():null;
    if(!d||!uid){clearTimeout(timer);setSync('', 'שמור במכשיר הזה בלבד');return}
    db=d;col=db.collection('data/users/'+uid);
    let first=true;
    col.onSnapshot(snap=>{
      loaded=true;
      if(snap.metadata.fromCache&&first&&snap.empty)return;
      const cloud=snap.docs.map(x=>Object.assign({},x.data()));
      if(first&&!snap.metadata.fromCache){
        first=false;clearTimeout(timer);
        // push anything that exists only on this device
        const ids=new Set(cloud.map(c=>c.id));
        const localOnly=items.filter(i=>!ids.has(i.id));
        (async()=>{for(const i of localOnly){try{await col.doc(i.id).set(clean(i))}catch(e){}}})();
        items=cloud.concat(localOnly);
      }else{
        items=cloud;
      }
      saveLocal();render();
      if(!snap.metadata.fromCache)setSync('on','מסונכרן לחשבון שלך ☁️');
    },err=>{clearTimeout(timer);setSync('err','שמור במכשיר הזה בלבד')});
  }catch(e){clearTimeout(timer);setSync('','שמור במכשיר הזה בלבד')}
}

/* ---------- Google Calendar ---------- */
function gcalOn(){return gcalReady&&$('#gcalOn').checked}
function isoLocal(ts){const d=new Date(ts);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':00'}
const RRULE={daily:'RRULE:FREQ=DAILY',weekly:'RRULE:FREQ=WEEKLY',monthly:'RRULE:FREQ=MONTHLY',weekdays:'RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH'};
function findId(p){
  if(!p)return null;
  if(typeof p==='object'){
    if(typeof p.id==='string')return p.id;
    if(typeof p.eventId==='string')return p.eventId;
    if(p.event&&typeof p.event.id==='string')return p.event.id;
  }
  const m=JSON.stringify(p).match(/"(?:eventId|id)"\s*:\s*"([^"]+)"/);
  return m?m[1]:null;
}
function gcalErr(e){
  const c=e&&e.code;
  if(c==='needs_reauth')return 'צריך לחבר מחדש את Google Calendar בהגדרות של Claude';
  if(c==='server_not_connected')return 'Google Calendar לא מחובר לחשבון Claude שלך';
  if(c==='approval_required'||c==='not_in_manifest'||c==='consent_required')return 'לא ניתן אישור ליומן — אפשר לנסות שוב בהוספה הבאה';
  if(c==='blocked_by_policy')return 'הארגון חוסם גישה ליומן';
  return 'היומן לא ענה כרגע — התזכורת נשמרה באפליקציה';
}
async function gcalCreate(i){
  if(!gcalOn())return;
  i.gstate='pending';render();
  const input={summary:'⏰ '+i.title,startTime:isoLocal(i.at),endTime:isoLocal(i.at+15*6e4),
    overrideReminders:[{method:'popup',minutes:0}].concat(+i.early?[{method:'popup',minutes:+i.early}]:[]),availability:'AVAILABILITY_FREE',
    description:'תזכורת מאפליקציית התזכורות',colorId:i.pri==='high'?'11':'9'};
  if(RRULE[i.repeat])input.recurrenceData=[RRULE[i.repeat]];
  try{
    const r=await mcp.callTool(GC,'create_event',input);
    i.gid=findId(r.payload)||'unknown';i.gstate='ok';
    toast('📅 נכנס ליומן — הטלפון יצלצל בזמן');
  }catch(e){i.gstate='fail';toast(gcalErr(e))}
  await put(i);render();
}
async function gcalMove(i){
  if(!gcalReady||!i.gid||i.gid==='unknown')return;
  try{await mcp.callTool(GC,'update_event',{eventId:i.gid,startTime:isoLocal(i.at),endTime:isoLocal(i.at+15*6e4),notificationLevel:'NONE'})}catch(e){toast(gcalErr(e))}
}
async function gcalDelete(i){
  if(!gcalReady||!i.gid||i.gid==='unknown')return;
  try{await mcp.callTool(GC,'delete_event',{eventId:i.gid,notificationLevel:'NONE'})}catch(e){}
}
async function initGcal(){
  try{
    mcp=await window.claude.use('mcp');
    if(!mcp)return;
    gcalReady=true;$('#gcalWrap').style.display='flex';
    try{const v=localStorage.getItem('rem_gcal');if(v==='0')$('#gcalOn').checked=false}catch(e){}
    $('#gcalOn').addEventListener('change',e=>{try{localStorage.setItem('rem_gcal',e.target.checked?'1':'0')}catch(x){}});
    render();
  }catch(e){}
}

/* ---------- dictation ---------- */
async function initMic(){
  let d=null;try{d=await window.claude.use('dictation')}catch(e){}
  if(!d)return;
  const btn=$('#mic');btn.style.display='block';let base='',live=false,denied=false;
  d.onPartial(({text})=>{txt.value=(base+' '+text).trim();txt.dispatchEvent(new Event('input'))});
  d.onFinal(({text})=>{base=(base+' '+text).trim();txt.value=base;txt.dispatchEvent(new Event('input'))});
  d.onState(({state})=>{live=state==='listening';btn.classList.toggle('on',live)});
  btn.addEventListener('click',()=>{
    if(denied)return;
    if(live){d.stop().catch(()=>{});return}
    base=txt.value.trim();
    d.start().catch(e=>{if(e&&e.code==='not_granted'){denied=true;btn.style.display='none'}});
  });
}
/* ---------- helpers ---------- */
const pad=n=>String(n).padStart(2,'0');
const toDateVal=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const toTimeVal=d=>pad(d.getHours())+':'+pad(d.getMinutes());
const DAYS=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
function sameDay(a,b){return a.toDateString()===b.toDateString()}
function fmtWhen(ts){
  const d=new Date(ts), now=new Date(), diff=ts-now.getTime();
  const tm=toTimeVal(d);
  const tmr=new Date(now);tmr.setDate(now.getDate()+1);
  let day;
  if(sameDay(d,now))day='היום';
  else if(sameDay(d,tmr))day='מחר';
  else if(diff>0&&diff<6*864e5)day='יום '+DAYS[d.getDay()];
  else day=d.getDate()+'.'+(d.getMonth()+1)+(d.getFullYear()!==now.getFullYear()?'.'+d.getFullYear():'');
  return day+' · '+tm;
}
function rel(ts){
  const m=Math.round((ts-Date.now())/6e4);
  if(m<0){const a=-m;return a<60?'לפני '+a+' דק׳':a<1440?'לפני '+Math.round(a/60)+' שע׳':'לפני '+Math.round(a/1440)+' ימים'}
  if(m<1)return 'עכשיו';
  if(m<60)return 'בעוד '+m+' דק׳';
  if(m<1440){const h=Math.floor(m/60),r=m%60;return 'בעוד '+h+' שע׳'+(r?' ו-'+r+' דק׳':'')}
  const dd=Math.floor(m/1440),hh=Math.round((m%1440)/60);
  if(dd<3)return 'בעוד '+(dd===1?'יום':'יומיים')+(hh?' ו-'+hh+' שע׳':'');
  return 'בעוד '+Math.round(m/1440)+' ימים';
}
const REP={none:'',daily:'כל יום',weekdays:'א׳–ה׳',weekly:'כל שבוע',monthly:'כל חודש'};
function nextRepeat(ts,rep){
  const d=new Date(ts);
  const now=Date.now();
  do{
    if(rep==='daily')d.setDate(d.getDate()+1);
    else if(rep==='weekly')d.setDate(d.getDate()+7);
    else if(rep==='monthly')d.setMonth(d.getMonth()+1);
    else if(rep==='weekdays'){do{d.setDate(d.getDate()+1)}while(d.getDay()>4)}
  }while(d.getTime()<=now);
  return d.getTime();
}

const NUMW={'אחת':1,'אחד':1,'שתיים':2,'שתי':2,'שניים':2,'שני':2,'שלוש':3,'שלושה':3,'ארבע':4,'ארבעה':4,'חמש':5,'חמישה':5,'שש':6,'שישה':6,'שבע':7,'שבעה':7,'שמונה':8,'תשע':9,'תשעה':9,'עשר':10,'עשרה':10,'רבע':.25,'חצי':.5};
function parse(text){
  let t=' '+text+' ', when=null, base=new Date(), clean=text;
  const strip=re=>{clean=clean.replace(re,' ');t=t.replace(re,' ')};
  let m;
  // בעוד X דקות/שעות/ימים
  m=t.match(/בעוד\s+(\d+|[א-ת]+)?\s*(דקה|דקות|דק׳|דק'|שעה|שעות|שעתיים|יום|ימים|יומיים|שבוע|שבועות)/);
  if(m){
    let n=m[1]?(isNaN(m[1])?(NUMW[m[1]]||1):+m[1]):1, u=m[2];
    if(u==='שעתיים'){n=2;u='שעה'} if(u==='יומיים'){n=2;u='יום'}
    if(m[1]==='חצי'&&/שע/.test(u)){n=.5}
    if(m[1]==='רבע'&&/שע/.test(u)){n=.25}
    const ms=/דק/.test(u)?6e4:/שע/.test(u)?36e5:/שבוע/.test(u)?6048e5:864e5;
    if(/^\s*וחצי/.test(t.slice(t.indexOf(m[0])+m[0].length))){n+=.5;strip(/וחצי/)}
    when=new Date(Date.now()+n*ms); strip(m[0]);
  }else{
    // day
    let day=new Date(base);
    let hasDay=false;
    if((m=t.match(/(?:ב-?|ב?תאריך\s*)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d|:)/))&&+m[2]>=1&&+m[2]<=12&&+m[1]>=1&&+m[1]<=31){
      let y=m[3]?+m[3]:day.getFullYear(); if(y<100)y+=2000;
      day=new Date(y,+m[2]-1,+m[1]); if(!m[3]&&day<new Date(new Date().toDateString()))day.setFullYear(y+1);
      hasDay=true;strip(m[0]);
    }
    else if((m=t.match(/(?:ב)?שבוע הבא/))){const add=(7-day.getDay())||7;day.setDate(day.getDate()+add);hasDay=true;strip(m[0])}
    else if((m=t.match(/מחרתיים/))){day.setDate(day.getDate()+2);hasDay=true;strip(m[0])}
    else if((m=t.match(/מחר/))){day.setDate(day.getDate()+1);hasDay=true;strip(m[0])}
    else if((m=t.match(/היום|הערב|הלילה/))){hasDay=true;strip(/היום/)}
    else if((m=t.match(/(?:ב)?יום\s+(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/))||(m=t.match(/\s(?:ב)?(שבת)\s/))){
      const idx=DAYS.indexOf(m[1]); let add=(idx-day.getDay()+7)%7; if(add===0)add=7;
      day.setDate(day.getDate()+add);hasDay=true;strip(m[0]);
    }
    // time
    let h=null,mi=0;
    if((m=t.match(/(?:ב-?|בשעה\s*)(\d{1,2})[:.](\d{2})/))||(m=t.match(/\s(\d{1,2}):(\d{2})/))){h=+m[1];mi=+m[2];strip(m[0])}
    else if((m=t.match(/(?:ב-?|בשעה\s*)(\d{1,2})(?!\d)/))){h=+m[1];strip(m[0])}
    else if((m=t.match(/בבוקר/))){h=9}
    else if((m=t.match(/בצהריים/))){h=13}
    else if((m=t.match(/אחה"צ|אחר הצהריים/))){h=16}
    else if((m=t.match(/הערב|בערב/))){h=20}
    else if((m=t.match(/הלילה|בלילה/))){h=22}
    if(h!==null){
      if(/ערב|לילה|אחה"צ|אחר הצהריים/.test(t)&&h<12)h+=12;
      else if(!/בוקר/.test(t)&&h>=1&&h<=7&&!hasDay)h+=12;
    }
    if(h!==null||hasDay){
      if(h===null){h=9}
      day.setHours(h,mi,0,0);
      if(!hasDay&&day.getTime()<=Date.now())day.setDate(day.getDate()+1);
      when=day;
    }
    clean=clean.replace(/בבוקר|בצהריים|בערב|הערב|בלילה|הלילה|אחה"צ|אחר הצהריים/g,' ');
  }
  let rep=null;
  if((m=t.match(/כל יום|כל בוקר|כל ערב|יומי/))){rep='daily';strip(m[0])}
  else if((m=t.match(/כל שבוע|שבועי/))){rep='weekly';strip(m[0])}
  else if((m=t.match(/כל חודש|חודשי/))){rep='monthly';strip(m[0])}
  clean=clean.replace(/^\s*(תזכיר\s+לי|תזכורת|להזכיר\s+לי|תזכירי\s+לי)\s*/,'').replace(/\s{2,}/g,' ').trim().replace(/^(ש|ל)?\s*$/,'');
  return {when,rep,clean};
}

/* ---------- composer ---------- */
const txt=$('#txt'),dateI=$('#date'),timeI=$('#time'),hint=$('#hint');
function setDT(d){dateI.value=toDateVal(d);timeI.value=toTimeVal(d)}
function defaultDT(){const d=new Date(Date.now()+36e5);d.setMinutes(Math.ceil(d.getMinutes()/5)*5,0,0);setDT(d)}
defaultDT();
txt.addEventListener('input',()=>{
  const p=parse(txt.value);
  if(p.when&&!manualTime&&!chosenChip){
    setDT(p.when);
    if(p.rep)$('#repeat').value=p.rep;
    hint.textContent='✨ זיהיתי: '+fmtWhen(p.when.getTime())+' ('+rel(p.when.getTime())+')'+(p.rep?' · '+REP[p.rep]:'');
  }else if(!p.when&&!chosenChip&&!manualTime){hint.textContent=''}
});
[dateI,timeI].forEach(el=>el.addEventListener('change',()=>{manualTime=true;clearChips();const t=getDT();if(!isNaN(t))hint.textContent='🕒 '+fmtWhen(t)+' ('+rel(t)+')'}));
function clearChips(){chosenChip=null;document.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'))}
$('#chips').addEventListener('click',e=>{
  const c=e.target.closest('.chip');if(!c)return;
  clearChips();c.classList.add('on');chosenChip=c.dataset.q;
  const n=new Date(),q=chosenChip;let d;
  if(q.endsWith('m'))d=new Date(+n+parseInt(q)*6e4);
  else if(q.endsWith('h'))d=new Date(+n+parseInt(q)*36e5);
  else if(q==='eve'){d=new Date(n);d.setHours(20,0,0,0);if(d<=n)d.setDate(d.getDate()+1)}
  else if(q==='tmr'){d=new Date(n);d.setDate(d.getDate()+1);d.setHours(9,0,0,0)}
  else if(q==='wk'){d=new Date(+n+6048e5)}
  setDT(d);hint.textContent='🕒 '+fmtWhen(+d)+' ('+rel(+d)+')';
});
function getDT(){
  if(!dateI.value||!timeI.value)return NaN;
  const [y,mo,da]=dateI.value.split('-').map(Number),[h,mi]=timeI.value.split(':').map(Number);
  return new Date(y,mo-1,da,h,mi,0,0).getTime();
}
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
$('#add').addEventListener('click',()=>{
  const raw=txt.value.trim();
  if(!raw){toast('כתוב קודם על מה להזכיר 🙂');txt.focus();return}
  const pc=NATIVE?parseCtx(raw):{clean:raw};
  const p=parse(pc.clean);
  let title=(p.clean&&p.clean.length>1)?p.clean:pc.clean||raw;
  title=title.replace(/^ו(?=[לבמהכש])/,'').trim()||raw;
  let at, trig=null;
  if(NATIVE&&trigMode!=='time'){
    trig=buildTrig(trigMode);
    if(!trig)return;
    at=9e15;
  }else{
    at=getDT();
    if(isNaN(at)){toast('בחר תאריך ושעה');return}
    if(at<Date.now()-3e4){toast('הזמן הזה כבר עבר ⏳');return}
  }
  const nag=NATIVE&&$('#nag').checked, buddy=nag?$('#buddy').value.trim():'';
  const i={id:newId(),title,at,repeat:trig?'none':$('#repeat').value,pri:nag?'high':$('#pri').value,cat:selCat||guessCat(raw)||'personal',early:trig?0:(+$('#early').value||0),done:false,fired:false,created:Date.now()};
  if(trig)i.trig=trig;
  if(nag){i.nag=true;if(buddy)i.buddy=buddy}
  items.push(i);render();
  txt.value='';hint.textContent='';clearChips();manualTime=false;$('#repeat').value='none';$('#pri').value='normal';$('#early').value='0';selCat=null;catAuto=true;renderCats();defaultDT();
  if(NATIVE){$('#nag').checked=false;$('#buddy').value='';$('#buddy').style.display='none';setTrig('time')}
  toast(trig?'✅ אזכיר '+trigLabel(i):'✅ נקבע ל'+fmtWhen(at));
  put(i).then(()=>gcalCreate(i));
  askPermission(true);
  if(nag&&buddy&&NATIVE&&!nstatus().sms)AndroidApp.requestPerm('sms');
});
txt.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#add').click()}});

/* ---------- list ---------- */
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');filter=b.dataset.f;render();
}));
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function gcalLink(i){
  const f=ts=>{const d=new Date(ts);return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+pad(d.getUTCMinutes())+'00Z'};
  let u='https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent('⏰ '+i.title)+'&dates='+f(i.at)+'/'+f(i.at+15*6e4);
  if(RRULE[i.repeat])u+='&recur='+encodeURIComponent(RRULE[i.repeat]);
  return u;
}
function calBadge(i){
  if(i.gstate==='ok')return '<span class="tag" style="background:#1d3b33;color:#7ff0c0">📅 ביומן</span>';
  if(i.gstate==='pending')return '<span class="tag">📅 מוסיף…</span>';
  return '';
}
function render(){
  const list=$('#list');
  let arr=items.slice();
  if(filter==='up')arr=arr.filter(i=>!i.done);
  if(filter==='done')arr=arr.filter(i=>i.done);
  if(fCat!=='all')arr=arr.filter(i=>(i.cat||'personal')===fCat);
  if(query)arr=arr.filter(i=>i.title.toLowerCase().includes(query));
  renderStats();
  arr.sort((a,b)=>filter==='done'?b.at-a.at:a.at-b.at);
  const pending=items.filter(i=>!i.done).length;
  $('#sub').textContent=pending?pending+' תזכורות פתוחות':'אין תזכורות פתוחות 🎉';
  if(!arr.length&&(query||fCat!=='all')){list.innerHTML='<div class="empty"><b>🔎</b>לא נמצאו תזכורות</div>';return}
  if(!arr.length){list.innerHTML='<div class="empty"><b>'+(filter==='done'?'📭':'🌤️')+'</b>'+(filter==='done'?'עוד לא סימנת כלום כבוצע':'הכל נקי. כתוב משהו למעלה')+'</div>';return}
  const now=new Date();let html='',last='';
  arr.forEach(i=>{
    let g;const d=new Date(i.at);
    if(i.trig&&!i.done)g='🧭 לפי מצב';
    else if(!i.done&&i.at<Date.now())g='⚠️ פספסת';
    else if(sameDay(d,now))g='היום';
    else{const t=new Date(now);t.setDate(t.getDate()+1);g=sameDay(d,t)?'מחר':(i.at-Date.now()<7*864e5&&i.at>Date.now()?'השבוע':'בהמשך')}
    if(filter!=='done'&&g!==last){html+='<div class="group">'+g+'</div>';last=g}
    const over=!i.done&&i.at<Date.now()&&!i.trig;
    const calAct=(NATIVE||i.gstate==='ok'||i.gstate==='pending')?'':(gcalReady?'<button class="act" data-a="gcal" data-id="'+i.id+'">📅 ליומן</button>':'<a class="act" style="text-decoration:none" target="_blank" rel="noopener" href="'+gcalLink(i)+'">📅 ליומן</a>');
    html+='<div class="item'+(i.done?' done':'')+(over?' overdue':'')+'" style="'+(!i.done&&!over?'border-right-color:'+(CATMAP[i.cat]||CATMAP.personal).c:'')+'">'+
      '<button class="check" data-a="toggle" data-id="'+i.id+'">'+(i.done?'✓':'')+'</button>'+
      '<div class="body"><div class="t">'+(i.pri==='high'?'🔴 ':'')+esc(i.title)+'</div>'+
      '<div class="meta"><span>'+(CATMAP[i.cat]||CATMAP.personal).e+'</span>'+(i.trig?'<span class="tag tagc">'+trigLabel(i)+(i.fired?' · הופעל':'')+'</span>':'<span class="when">'+fmtWhen(i.at)+'</span><span>'+rel(i.at)+'</span>')+(i.nag?'<span class="tag tagn">🔥 לא נותן לברוח</span>':'')+(i.repeat&&i.repeat!=='none'?'<span class="tag">🔁 '+REP[i.repeat]+'</span>':'')+calBadge(i)+(+i.early?'<span class="tag">🔔 '+earlyTxt(i.early)+'</span>':'')+'</div>'+
      (i.done?'<div class="acts"><button class="act del" data-a="del" data-id="'+i.id+'">מחק</button></div>':
      '<div class="acts">'+calAct+(i.trig?'':'<button class="act" data-a="snz" data-id="'+i.id+'">+1 שעה</button>')+(NATIVE?'<button class="act" data-a="share" data-id="'+i.id+'">📤 שלח</button>':'')+'<button class="act" data-a="edit" data-id="'+i.id+'">ערוך</button><button class="act del" data-a="del" data-id="'+i.id+'">מחק</button></div>')+
      '</div></div>';
  });
  list.innerHTML=html;
}
$('#list').addEventListener('click',e=>{
  const b=e.target.closest('button[data-a]');if(!b)return;
  const i=items.find(x=>x.id===b.dataset.id);if(!i)return;
  const a=b.dataset.a;
  if(a==='toggle'){complete(i)}
  else if(a==='del'){
    items=items.filter(x=>x!==i);render();drop(i);
    let undone=false;
    const t=setTimeout(()=>{if(!undone&&!i.done)gcalDelete(i)},5200);
    toast('נמחק 🗑️',()=>{undone=true;clearTimeout(t);items.push(i);put(i);render();toast('שוחזר ↩️')});
  }
  else if(a==='snz'){snooze(i,60)}
  else if(a==='share'){shareItem(i)}
  else if(a==='edit'){
    txt.value=i.title;setDT(new Date(Math.min(Math.max(i.at,Date.now()+6e4),Date.now()+3e11)));if(NATIVE){setTrig(i.trig?i.trig.type:'time');$('#nag').checked=!!i.nag;$('#buddy').value=i.buddy||'';$('#buddy').style.display=i.nag?'block':'none'}manualTime=true;$('#repeat').value=i.repeat||'none';$('#pri').value=i.pri||'normal';$('#early').value=String(i.early||0);selCat=i.cat||null;catAuto=!i.cat;renderCats();
    items=items.filter(x=>x!==i);render();drop(i);gcalDelete(i);
    window.scrollTo({top:0,behavior:'smooth'});txt.focus();toast('ערוך ולחץ "הוסף"');
  }
  else if(a==='gcal'){const was=$('#gcalOn').checked;$('#gcalOn').checked=true;gcalCreate(i).finally(()=>{$('#gcalOn').checked=was})}
});
function snooze(i,min){
  i.at=Math.max(i.at,Date.now())+min*6e4;i.fired=false;put(i);render();
  if(i.repeat==='none')gcalMove(i);
  toast('⏰ אזכיר שוב '+rel(i.at));
}
const PRAISE=['כל הכבוד! ✓','אלוף! 💪','עוד אחד ירד מהרשימה 🎯','יפה מאוד! ⭐','מכונה! 🚀'];
function complete(i){
  if(NATIVE){try{AndroidApp.dismiss(i.id)}catch(e){}}
  if(i.done){i.done=false;put(i);render();return}
  if(i.repeat&&i.repeat!=='none'){i.at=nextRepeat(i.at,i.repeat);i.fired=false;toast('🔁 הבא: '+fmtWhen(i.at))}
  else{i.done=true;toast(PRAISE[Math.floor(Math.random()*PRAISE.length)])}
  i.lastDone=Date.now();confetti();
  put(i);render();
}

/* ---------- in-app alarm ---------- */
function permState(){try{return ('Notification' in window)?Notification.permission:'unsupported'}catch(e){return 'unsupported'}}
function updateBell(){if(NATIVE){$('#bell').classList.toggle('off',!nativeOk());return}$('#bell').classList.toggle('off',!gcalReady&&permState()!=='granted')}
async function askPermission(){
  const s=permState();
  if(s!=='default')return;
  try{await Notification.requestPermission()}catch(e){}
  updateBell();
}
$('#bell').addEventListener('click',()=>{askPermission();$('#sheet').classList.add('show')});
$('#sheetClose').addEventListener('click',()=>$('#sheet').classList.remove('show'));
$('#sheet').addEventListener('click',e=>{if(e.target.id==='sheet')e.currentTarget.classList.remove('show')});

function notify(i){
  try{if(permState()==='granted')new Notification('⏰ '+i.title,{body:fmtWhen(i.at),tag:i.id,requireInteraction:true})}catch(e){}
  try{navigator.vibrate&&navigator.vibrate([400,150,400,150,400])}catch(e){}
  if(!NATIVE)beep();
  showAlarm(i);
}
let actx=null;
function beep(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    const now=actx.currentTime;
    [0,.25,.5,1,1.25,1.5].forEach((t,k)=>{
      const o=actx.createOscillator(),g=actx.createGain();
      o.type='sine';o.frequency.value=k%3===2?1175:880;
      g.gain.setValueAtTime(0,now+t);g.gain.linearRampToValueAtTime(.25,now+t+.02);g.gain.exponentialRampToValueAtTime(.001,now+t+.22);
      o.connect(g);g.connect(actx.destination);o.start(now+t);o.stop(now+t+.25);
    });
  }catch(e){}
}
document.addEventListener('click',()=>{try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();actx.resume&&actx.resume()}catch(e){}},{once:true});

function showAlarm(i){
  alarmId=i.id;$('#alarmText').textContent=i.title;$('#alarm').classList.add('show');
  $('#alarm').querySelectorAll('[data-s]').forEach(b=>b.style.display=(i.nag||i.trig)?'none':'');
  if(NATIVE&&speakOn()){try{AndroidApp.speak((i.nag?'תזכורת חשובה! ':'תזכורת: ')+i.title)}catch(e){}}
}
$('#alarm').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const i=items.find(x=>x.id===alarmId);
  $('#alarm').classList.remove('show');
  if(!i)return;
  if(b.dataset.s)snooze(i,+b.dataset.s);
  else complete(i);
});

function tick(){
  const now=Date.now();
  items.forEach(i=>{
    if(!i.done&&!i.fired&&i.at<=now&&now-i.at<12*36e5){i.fired=true;put(i);notify(i)}
    else if(!i.done&&+i.early&&i.earlyFiredAt!==i.at&&i.at-now<=i.early*6e4&&i.at>now){i.earlyFiredAt=i.at;put(i);preNotify(i)}
  });
  render();
}
setInterval(tick,10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});

/* ---------- misc ---------- */
let tt,undoFn=null;
function toast(m,undo){
  const t=$('#toast');$('#toastTxt').textContent=m;undoFn=undo||null;
  $('#toastUndo').style.display=undo?'inline':'none';
  t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>{t.classList.remove('show');undoFn=null},undo?5000:2800);
}
$('#toastUndo').addEventListener('click',()=>{const f=undoFn;undoFn=null;$('#toast').classList.remove('show');if(f)f()});

/* ---------- categories, search, stats ---------- */
function earlyTxt(m){m=+m;return m>=1440?'יום לפני':m>=60?(m/60)+' שע׳ לפני':m+' דק׳ לפני'}
function renderCats(){
  const auto=catAuto?guessCat(txt.value):null, cur=selCat||auto;
  $('#cats').innerHTML=CATS.map(c=>'<button class="cat'+(cur===c.k?' on':'')+'" style="--c:'+c.c+'" data-k="'+c.k+'">'+c.e+' '+c.n+'</button>').join('');
}
$('#cats').addEventListener('click',e=>{const b=e.target.closest('.cat');if(!b)return;const k=b.dataset.k;
  if(selCat===k){selCat=null;catAuto=true}else{selCat=k;catAuto=false}renderCats()});
txt.addEventListener('input',()=>{if(catAuto)renderCats()});
function renderFCats(){
  const used=new Set(items.map(i=>i.cat||'personal'));
  const list=CATS.filter(c=>used.has(c.k));
  const el=$('#fcats');
  if(list.length<2){el.innerHTML='';if(fCat!=='all'&&!used.has(fCat))fCat='all';return}
  el.innerHTML='<button class="chip'+(fCat==='all'?' on':'')+'" data-k="all">הכל</button>'+list.map(c=>'<button class="chip'+(fCat===c.k?' on':'')+'" data-k="'+c.k+'">'+c.e+' '+c.n+'</button>').join('');
}
$('#fcats').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;fCat=b.dataset.k;render()});
let sT;$('#search').addEventListener('input',e=>{clearTimeout(sT);sT=setTimeout(()=>{query=e.target.value.trim().toLowerCase();render()},120)});
function renderStats(){
  const now=new Date(),todayEnd=new Date(now);todayEnd.setHours(23,59,59,999);
  const doneToday=items.filter(i=>i.lastDone&&sameDay(new Date(i.lastDone),now)).length;
  const leftToday=items.filter(i=>!i.done&&i.at<=+todayEnd).length;
  const total=doneToday+leftToday;
  const pct=total?doneToday/total:0;
  $('#ringFg').style.strokeDashoffset=String(113.1*(1-pct));
  $('#ringTxt').textContent=doneToday+'/'+total;
  const over=items.filter(i=>!i.done&&i.at<Date.now()).length;
  const week=items.filter(i=>!i.done&&i.at>Date.now()&&i.at<Date.now()+7*864e5).length;
  $('#stats').innerHTML=(over?'<div class="stat bad">פספסת <b>'+over+'</b></div>':'')+
    '<div class="stat">נשאר להיום <b>'+leftToday+'</b></div><div class="stat">השבוע <b>'+week+'</b></div>'+
    (doneToday?'<div class="stat">בוצעו היום <b>'+doneToday+'</b> 🔥</div>':'');
  renderFCats();
}
function preNotify(i){
  if(NATIVE){toast('🔔 '+rel(i.at)+': '+i.title);return}
  try{if(permState()==='granted')new Notification('🔔 '+earlyTxt(i.early).replace('לפני','')+'עד: '+i.title,{body:fmtWhen(i.at),tag:i.id+'e'})}catch(e){}
  try{navigator.vibrate&&navigator.vibrate([200,100,200])}catch(e){}
  toast('🔔 '+rel(i.at)+': '+i.title);
}

/* ---------- confetti ---------- */
function confetti(){
  try{
    const cv=$('#confetti'),cx=cv.getContext('2d');cv.width=innerWidth;cv.height=innerHeight;
    const cols=['#7c6cff','#ff6ca8','#3ddc97','#ffb648','#3e8ef7'];
    const ps=Array.from({length:90},()=>({x:innerWidth/2,y:innerHeight*.35,vx:(Math.random()-.5)*12,vy:Math.random()*-11-3,s:Math.random()*6+4,c:cols[Math.floor(Math.random()*cols.length)],r:Math.random()*6,vr:(Math.random()-.5)*.3}));
    let f=0;(function step(){
      cx.clearRect(0,0,cv.width,cv.height);
      ps.forEach(p=>{p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.vx*=.99;p.r+=p.vr;cx.save();cx.translate(p.x,p.y);cx.rotate(p.r);cx.fillStyle=p.c;cx.fillRect(-p.s/2,-p.s/4,p.s,p.s/2);cx.restore()});
      if(++f<90)requestAnimationFrame(step);else cx.clearRect(0,0,cv.width,cv.height);
    })();
  }catch(e){}
}
function banner(){
  const b=$('#banner');let seen=false;try{seen=localStorage.getItem('rem_tip2')==='1'}catch(e){}
  if(seen)return;
  b.style.display='block';
  b.innerHTML=(NATIVE?'👋 ברוך הבא! לפני שמתחילים — וודא שההתראות מוגדרות נכון. ':'💡 איך לוודא שהטלפון יצלצל גם כשהאפליקציה סגורה? ')+'<button id="tipBtn">ככה ←</button> &nbsp; <button id="tipX" style="color:#9a9cc2">הסתר</button>';
  $('#tipBtn').onclick=()=>$('#sheet').classList.add('show');
  $('#tipX').onclick=()=>{b.style.display='none';try{localStorage.setItem('rem_tip2','1')}catch(e){}};
}

/* ---------- native (Android) ---------- */
function nstatus(){try{return JSON.parse(window.AndroidApp.status())}catch(e){return {}}}
function nativeOk(){const st=nstatus();return st.notifications!==false&&st.exact!==false}
/* ---------- native extras: triggers, places, voice, multi, share, settings ---------- */
let trigMode='time';
const PLACE_PRESETS=['בית','עבודה','סופר','הורים','חדר כושר'];
function lsGet(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function places(){return lsGet('places',[])}
function carDev(){return lsGet('carDev',null)}
function speakOn(){return lsGet('speak',true)}

function trigLabel(i){
  const t=i.trig;if(!t)return '';
  if(t.type==='car')return '🚗 כשתיכנס לאוטו';
  if(t.type==='call')return '📞 אחרי השיחה הבאה';
  if(t.type==='place')return '📍 כשתגיע ל'+(t.name||'מקום');
  return '';
}
function placeOptions(){
  const saved=places(), names=saved.map(p=>p.name);
  const all=names.concat(PLACE_PRESETS.filter(n=>!names.includes(n)));
  const cur=$('#place').value;
  $('#place').innerHTML=all.map(n=>'<option value="'+esc(n)+'">'+(names.includes(n)?'📍 ':'➕ ')+esc(n)+(names.includes(n)?'':' (עוד לא שמור)')+'</option>').join('')+'<option value="__new">✏️ מקום אחר…</option>';
  if(cur&&[...$('#place').options].some(o=>o.value===cur))$('#place').value=cur;
  updatePlaceBtn();
}
function updatePlaceBtn(){
  const n=$('#place').value, saved=places().some(p=>p.name===n);
  $('#savePlace').textContent=n==='__new'?'✏️ תן שם…':(saved?'🔄 עדכן מיקום':'📍 אני שם עכשיו — שמור');
}
function setTrig(t){
  trigMode=t;
  document.querySelectorAll('#trig .tg').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  const timeOnly=t==='time';
  $('#rowDT').style.display=timeOnly?'':'none';
  $('#chips').style.display=timeOnly?'':'none';
  $('#repeat').parentElement.style.display=timeOnly?'':'none';
  $('#early').parentElement.style.display=timeOnly?'':'none';
  $('#placeRow').style.display=t==='place'?'flex':'none';
  if(t==='place')placeOptions();
  renderCtxNote();
}
function renderCtxNote(){
  const el=$('#ctxNote');if(trigMode==='time'){el.style.display='none';return}
  const st=nstatus();let msg='';
  if(trigMode==='car'){
    if(!st.bt)msg='כדי לזהות כניסה לאוטו צריך הרשאת Bluetooth. <button data-perm="bt">לאשר</button>';
    else if(!carDev())msg='טיפ: בחר את הבלוטות׳ של האוטו בהגדרות (🔔 למעלה), אחרת אזכיר בכל חיבור בלוטות׳.';
  }else if(trigMode==='call'){
    if(!st.phone)msg='כדי לזהות סוף שיחה צריך הרשאה לטלפון. <button data-perm="phone">לאשר</button>';
  }else if(trigMode==='place'){
    if(!st.location)msg='כדי לזהות הגעה למקום צריך הרשאת מיקום. <button data-perm="location">לאשר</button>';
    else if(!st.bglocation)msg='כדי שזה יעבוד גם כשהאפליקציה סגורה — בחר "לאפשר כל הזמן" במיקום. <button data-perm="bglocation">לאשר</button>';
  }
  el.innerHTML=msg;el.style.display=msg?'block':'none';
}
function buildTrig(t){
  if(t==='car'){const d=carDev();return {type:'car',device:d?d.addr:'',devName:d?d.name:''}}
  if(t==='call')return {type:'call'};
  if(t==='place'){
    const n=$('#place').value, p=places().find(x=>x.name===n);
    if(!p){toast('קודם שמור את המיקום של "'+(n==='__new'?'המקום':n)+'" — כשתהיה שם לחץ "אני שם עכשיו"');return null}
    return {type:'place',name:p.name,lat:p.lat,lng:p.lng};
  }
  return null;
}
let pendingPlaceName=null;
function saveCurrentPlace(){
  let n=$('#place').value;
  if(n==='__new'){
    const v=$('#txt').value.trim();
    toast('כתוב את שם המקום בשדה "שם מקום" שנפתח');
    $('#placeName').style.display='block';$('#placeName').focus();return;
  }
  if(!nstatus().location){AndroidApp.requestPerm('location');return}
  pendingPlaceName=n;toast('📡 מאתר מיקום…');
  AndroidApp.currentLocation();
}
window.onLocation=function(loc,err){
  if(!pendingPlaceName)return;
  const n=pendingPlaceName;pendingPlaceName=null;
  if(!loc){toast(err==='no_permission'?'צריך הרשאת מיקום':'לא הצלחתי לאתר מיקום — נסה שוב בחוץ / עם GPS');return}
  const ps=places().filter(p=>p.name!==n);ps.push({id:newId(),name:n,lat:loc.lat,lng:loc.lng});lsSet('places',ps);
  placeOptions();$('#place').value=n;updatePlaceBtn();
  toast('✅ שמרתי את "'+n+'" (דיוק ~'+Math.round(loc.acc||0)+' מ׳)');
  renderCtxNote();
};

/* ---- smart context phrases ---- */
function parseCtx(text){
  let t=' '+text+' ', type=null, place=null, nag=false;
  const rm=re=>{t=t.replace(re,' ')};
  let m;
  if((m=t.match(/ו?כש(?:אני\s+)?(?:א?כנס|נכנס|אעלה|עולה)\s+(?:ל|אל\s+ה)?(?:אוטו|רכב|מכונית)/))){type='car';rm(m[0])}
  else if((m=t.match(/ו?(?:אחרי|כש(?:אני\s+)?(?:אסיים|מסיים|גומר|אגמור))\s+(?:את\s+)?ה?שיחה(?:\s+הבאה)?/))){type='call';rm(m[0])}
  else if((m=t.match(/ו?כש(?:אני\s+)?(?:אגיע|מגיע|אהיה|נמצא|חוזר|אחזור)\s+(?:ל|ב|אל\s+)?ה?([א-ת"׳' ]{2,20}?)(?=\s|$|,)/))){
    let n=m[1].trim();
    if(/^בית|^ביתה|^הביתה/.test(n)||n==='בית')n='בית';
    if(/^סופר/.test(n))n='סופר';
    if(/^עבודה/.test(n))n='עבודה';
    if(/^הורים/.test(n))n='הורים';
    type='place';place=n;rm(m[0]);
  }
  else if((m=t.match(/הביתה/))&&/כש/.test(t)){type='place';place='בית';rm(/ו?כש\S*\s+(?:\S+\s+)?הביתה/)}
  if((m=t.match(/(?:אל\s+תיתן\s+לי\s+(?:לשכוח|לברוח)|דחוף|חשוב\s+מאוד|בלי\s+תירוצים)/))){nag=true;rm(m[0])}
  return {type,place,nag,clean:t.replace(/\s{2,}/g,' ').trim().replace(/^ו\s+/,'')};
}

/* ---- multi-reminder splitting ---- */
function splitMulti(text){
  return text.split(/\s*(?:[,.;!?\n]|\s(?:וגם|ואז|ובנוסף|ותזכיר\s+לי|ותזכירי\s+לי)\s)\s*/).map(x=>x.replace(/^(?:וגם|ואז|ובנוסף|ו?תזכירי?\s+לי|גם)\s+/,'').replace(/^(?:וגם|ואז|ובנוסף|ו?תזכירי?\s+לי|גם)\s+/,'').trim()).filter(x=>x.length>1);
}
function draftFrom(seg){
  const pc=parseCtx(seg), p=parse(pc.clean);
  let title=((p.clean&&p.clean.length>1)?p.clean:pc.clean||seg).replace(/^ו(?=[לבמהכש])/,'').trim();
  const d={title,raw:seg,cat:guessCat(seg)||'personal',repeat:p.rep||'none',nag:pc.nag};
  if(pc.type){
    d.trigType=pc.type;d.placeName=pc.place;
  }else if(p.when){d.at=p.when.getTime()}
  else{d.at=Date.now()+36e5;d.guessed=true}
  return d;
}
function draftLabel(d){
  if(d.trigType==='car')return '🚗 כשתיכנס לאוטו';
  if(d.trigType==='call')return '📞 אחרי השיחה הבאה';
  if(d.trigType==='place'){const ok=places().some(p=>p.name===d.placeName);return '📍 כשתגיע ל'+d.placeName+(ok?'':' ⚠️ (המקום לא שמור — אזכיר בעוד שעה)')}
  return '⏰ '+fmtWhen(d.at)+(d.guessed?' (לא אמרת מתי — שמתי בעוד שעה)':'')+(d.repeat!=='none'?' · 🔁 '+REP[d.repeat]:'');
}
let drafts=[];
function showMulti(list){
  drafts=list;
  $('#multiN').textContent=list.length;
  $('#multiList').innerHTML=list.map((d,k)=>'<label class="mrow"><input type="checkbox" checked data-k="'+k+'"><div><div class="mt">'+(CATMAP[d.cat]||CATMAP.personal).e+' '+esc(d.title)+(d.nag?' 🔥':'')+'</div><div class="mw">'+draftLabel(d)+'</div></div></label>').join('');
  $('#multi').classList.add('show');
}
function addDraft(d){
  const i={id:newId(),title:d.title,at:d.at||9e15,repeat:d.repeat||'none',pri:d.nag?'high':'normal',cat:d.cat,early:0,done:false,fired:false,created:Date.now()};
  if(d.nag)i.nag=true;
  if(d.trigType){
    if(d.trigType==='place'){
      const p=places().find(x=>x.name===d.placeName);
      if(p)i.trig={type:'place',name:p.name,lat:p.lat,lng:p.lng};
      else{i.at=Date.now()+36e5;i.title+=' ('+d.placeName+')'}
    }else if(d.trigType==='car'){const c=carDev();i.trig={type:'car',device:c?c.addr:'',devName:c?c.name:''}}
    else i.trig={type:d.trigType};
    if(i.trig)i.at=9e15;
  }
  items.push(i);put(i);
  return i;
}

/* ---- voice ---- */
let voiceFinal='';
function startListening(){
  voiceFinal='';$('#listenTxt').textContent='מקשיב… דבר חופשי';$('#listen').classList.add('show');
  try{AndroidApp.startVoice()}catch(e){$('#listen').classList.remove('show')}
}
function stopListening(){try{AndroidApp.stopVoice()}catch(e){}$('#listen').classList.remove('show')}
window.onVoiceState=function(s){if(s==='processing')$('#listenTxt').textContent=($('#listenTxt').textContent||'')+' …'};
window.onVoice=function(text,fin,err){
  if(text&&!fin){$('#listenTxt').textContent=text;return}
  $('#listen').classList.remove('show');
  if(!text){
    if(err==='no_permission')toast('צריך הרשאת מיקרופון 🎙️');
    else if(err==='unavailable')toast('אין בטלפון זיהוי דיבור — אפשר להקליד');
    else if(err&&err!=='cancel'&&err!=='err7')toast('לא שמעתי טוב — נסה שוב');
    else if(err==='err7')toast('לא שמעתי כלום — נסה שוב');
    return;
  }
  const segs=splitMulti(text);
  if(segs.length<=1){
    $('#txt').value=text;$('#txt').dispatchEvent(new Event('input'));
    const pc=parseCtx(text);if(pc.type)applyCtxToComposer(pc);if(pc.nag){$('#nag').checked=true;$('#buddy').style.display='block'}
    toast('✨ בדוק ולחץ "הוסף תזכורת"');
  }else showMulti(segs.map(draftFrom));
};
function applyCtxToComposer(pc){
  if(!pc.type)return;
  setTrig(pc.type);
  if(pc.type==='place'&&pc.place){
    placeOptions();
    if(![...$('#place').options].some(o=>o.value===pc.place)){const o=document.createElement('option');o.value=pc.place;o.textContent='➕ '+pc.place+' (עוד לא שמור)';$('#place').insertBefore(o,$('#place').lastChild)}
    $('#place').value=pc.place;updatePlaceBtn();
  }
}

/* ---- share (WhatsApp) ---- */
function shareItem(i){
  const when=i.trig?trigLabel(i).replace(/^\S+\s/,''):fmtWhen(i.at);
  const msg='⏰ תזכורת: '+i.title+'\n🗓️ '+when+'\n\n(נשלח מאפליקציית "תזכורות")';
  location.href='https://wa.me/?text='+encodeURIComponent(msg);
}

/* ---- settings sheet ---- */
function renderNativeSheet(){
  const st=nstatus();
  const row=(ok,txt,btn,fn)=>'<div class="chk"><span>'+(ok?'✅':'⚠️')+' '+txt+'</span>'+(ok?'':'<button class="act" data-fix="'+fn+'">'+btn+'</button>')+'</div>';
  const prow=(ok,txt,perm)=>'<div class="chk"><span>'+(ok?'✅':'⚪')+' '+txt+'</span>'+(ok?'':'<button class="act" data-perm="'+perm+'">לאשר</button>')+'</div>';
  const cd=carDev(), ps=places();
  let carHtml='';
  if(st.bt){
    let devs=[];try{devs=JSON.parse(AndroidApp.btDevices())}catch(e){}
    carHtml='<div class="chk"><span>🚗 האוטו שלי:</span><select id="carSel" style="max-width:55%;background:#14152b;color:#fff;border:1px solid #33355f;border-radius:8px;padding:6px"><option value="">כל מכשיר בלוטות׳</option>'+devs.map(d=>'<option value="'+esc(d.addr)+'"'+(cd&&cd.addr===d.addr?' selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></div>';
  }
  $('#sheet .box').innerHTML='<h3>⚙️ הגדרות</h3>'+
    '<p><b>צלצול בזמן</b> — גם כשהאפליקציה סגורה והמסך כבוי:</p>'+
    row(st.notifications!==false,'התראות מותרות','לאשר','notif')+
    row(st.exact!==false,'שעונים מדויקים','לאשר','exact')+
    row(!!st.battery,'בלי הגבלת סוללה (מומלץ)','לשחרר','battery')+
    '<button class="add" id="testBtn" style="margin-top:6px">🔔 בדיקת צלצול (בעוד 5 שניות)</button>'+
    '<p style="margin-top:16px"><b>🗣️ קול</b></p>'+
    '<div class="chk"><span>להקריא תזכורות בקול</span><input type="checkbox" id="speakT" '+(speakOn()?'checked':'')+' style="width:20px;height:20px;accent-color:#7c6cff"></div>'+
    (st.tts===false?'<div class="chk"><span>⚠️ אין קול עברי בטלפון</span><button class="act" data-fix="tts">להתקין</button></div>':'')+
    prow(!!st.mic,'מיקרופון (להכתבה)','mic')+
    '<p style="margin-top:16px"><b>🧭 תזכורות לפי מצב</b></p>'+
    prow(!!st.bt,'בלוטות׳ — לזהות כניסה לאוטו','bt')+carHtml+
    prow(!!st.phone,'טלפון — לזהות סוף שיחה','phone')+
    prow(!!st.location,'מיקום — לזהות הגעה למקום','location')+
    (st.location?prow(!!st.bglocation,'מיקום ברקע ("כל הזמן")','bglocation'):'')+
    (ps.length?'<div style="margin:8px 0;font-size:13px;color:#cfd0ec">מקומות שמורים: '+ps.map(p=>'<span class="tag" style="margin:2px;display:inline-block">📍 '+esc(p.name)+' <button class="act del" data-delplace="'+esc(p.name)+'" style="padding:0 4px">✕</button></span>').join('')+'</div>':'')+
    '<p style="margin-top:16px"><b>🔥 לא נותן לברוח</b></p>'+
    prow(!!st.sms,'SMS — לשלוח לאיש קשר אם לא ביצעת','sms')+
    '<p style="margin-top:12px;font-size:12.5px">בחלק מהטלפונים (שיאומי, סמסונג, אופו) כדאי גם: הגדרות ← אפליקציות ← תזכורות ← לאפשר "הפעלה אוטומטית" ו"פעילות ברקע".</p>'+
    '<button class="close" id="sheetClose2">סגור</button>';
  const box=$('#sheet .box');
  box.onclick=e=>{
    const f=e.target.closest('[data-fix]');
    if(f){const k=f.dataset.fix;try{k==='notif'?AndroidApp.openNotificationSettings():k==='exact'?AndroidApp.openExactSettings():k==='tts'?AndroidApp.openTtsSettings():AndroidApp.openBatterySettings()}catch(x){}}
    const pm=e.target.closest('[data-perm]');if(pm){try{AndroidApp.requestPerm(pm.dataset.perm)}catch(x){}}
    const dp=e.target.closest('[data-delplace]');if(dp){lsSet('places',places().filter(p=>p.name!==dp.dataset.delplace));renderNativeSheet()}
    if(e.target.id==='testBtn'){try{AndroidApp.testAlarm('בדיקה — הכל עובד!')}catch(x){}toast('🔔 נעל את המסך — עוד 5 שניות יצלצל');if(speakOn())setTimeout(()=>{try{AndroidApp.speak('בדיקה. הכל עובד')}catch(x){}},5200)}
    if(e.target.id==='sheetClose2')$('#sheet').classList.remove('show');
  };
  const sp=$('#speakT');if(sp)sp.onchange=()=>{lsSet('speak',sp.checked);if(sp.checked){try{AndroidApp.speak('אני אקריא לך את התזכורות')}catch(x){}}};
  const cs=$('#carSel');if(cs)cs.onchange=()=>{const o=cs.options[cs.selectedIndex];lsSet('carDev',cs.value?{addr:cs.value,name:o.textContent}:null);toast(cs.value?'🚗 האוטו נשמר: '+o.textContent:'אזכיר בכל חיבור בלוטות׳')};
}
window.onPermsChanged=function(){renderNativeSheet();renderCtxNote();updateBell()};

function initNativeUI(){
  $('#mic').style.display='block';
  $('#mic').addEventListener('click',startListening);
  $('#listenStop').addEventListener('click',()=>{try{AndroidApp.stopVoice()}catch(e){}$('#listenTxt').textContent='מעבד…'});
  $('#trig').addEventListener('click',e=>{const b=e.target.closest('.tg');if(b)setTrig(b.dataset.t)});
  $('#ctxNote').addEventListener('click',e=>{const b=e.target.closest('[data-perm]');if(b)AndroidApp.requestPerm(b.dataset.perm)});
  $('#place').addEventListener('change',()=>{updatePlaceBtn();$('#placeName').style.display=$('#place').value==='__new'?'block':'none'});
  const pn=document.createElement('input');pn.id='placeName';pn.placeholder='שם המקום (למשל: הגן של הילדים)';pn.style.cssText='display:none;width:100%;margin-top:8px;background:#14152b;border:1px solid #33355f;color:#fff;border-radius:12px;padding:10px;font-size:15px;font-family:inherit';
  $('#placeRow').after(pn);
  pn.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();savePlaceNamed()}});
  $('#savePlace').addEventListener('click',()=>{if($('#place').value==='__new'){if(pn.style.display==='block'&&pn.value.trim())savePlaceNamed();else{pn.style.display='block';pn.focus()}}else saveCurrentPlace()});
  function savePlaceNamed(){
    const n=pn.value.trim();if(!n){pn.focus();return}
    const o=document.createElement('option');o.value=n;o.textContent='➕ '+n;$('#place').insertBefore(o,$('#place').lastChild);$('#place').value=n;
    pn.value='';pn.style.display='none';saveCurrentPlace();
  }
  $('#nag').addEventListener('change',()=>{$('#buddy').style.display=$('#nag').checked?'block':'none'});
  $('#txt').addEventListener('input',()=>{
    const pc=parseCtx($('#txt').value);
    if(pc.type&&pc.type!==trigMode)applyCtxToComposer(pc);
    if(pc.nag&&!$('#nag').checked){$('#nag').checked=true;$('#buddy').style.display='block'}
  });
  $('#multiAdd').addEventListener('click',()=>{
    const ks=[...$('#multiList').querySelectorAll('input:checked')].map(x=>+x.dataset.k);
    ks.forEach(k=>addDraft(drafts[k]));
    $('#multi').classList.remove('show');render();
    toast('✅ נוספו '+ks.length+' תזכורות');confetti();
    if(speakOn()){try{AndroidApp.speak('הוספתי '+ks.length+' תזכורות')}catch(e){}}
  });
  $('#multiCancel').addEventListener('click',()=>$('#multi').classList.remove('show'));
  $('#txt').placeholder='כתוב או לחץ 🎙️ ודבר:\n"מחר ב-9 לרופא, וכשאגיע לסופר לקנות חלב"';
}
window.onNativeEvents=function(){
  if(!NATIVE)return;
  let evs=[];try{evs=JSON.parse(AndroidApp.takeEvents())}catch(e){}
  let ch=false;
  evs.forEach(ev=>{
    const i=items.find(x=>x.id===ev.id);if(!i)return;ch=true;
    if(ev.type==='fired'){i.fired=true}
    else if(ev.type==='moved'){i.at=ev.at;i.fired=false}
    else if(ev.type==='done'){if(i.trig&&!i.done){complete(i)}else if(!i.done&&!(i.repeat&&i.repeat!=='none'&&i.at>Date.now())){complete(i)}else if(i.repeat&&i.repeat!=='none'){i.lastDone=Date.now()}}
    else if(ev.type==='ctxFired'){i.fired=true;i.firedAt=ev.at}
    else if(ev.type==='smsSent'){toast('📩 נשלח SMS ל'+(i.buddy||'איש הקשר'))}
    else if(ev.type==='snooze'){if(!i.repeat||i.repeat==='none'){i.at=ev.at;i.fired=false}toast('⏰ נדחה — אזכיר שוב '+rel(ev.at))}
  });
  if(ch){saveLocal();render()}
  updateBell();
};
window.onNativeOpen=function(id){
  window.onNativeEvents();
  const i=items.find(x=>x.id===id);
  if(i&&!i.done)showAlarm(i);
};
window.onNativeBack=function(){
  if($('#listen').classList.contains('show')){stopListening();return true}
  for(const s of ['#alarm','#multi','#sheet']){if($(s).classList.contains('show')){$(s).classList.remove('show');return true}}
  return false;
};

loadLocal();if(NATIVE)window.onNativeEvents();renderCats();render();banner();tick();updateBell();
if(NATIVE){
  setSync('on','📱 נשמר בטלפון · עובד גם בלי אינטרנט');
  document.querySelector('#sync').style.display='flex';
  document.body.classList.add('native');initNativeUI();
  renderNativeSheet();
  $('#bell').addEventListener('click',renderNativeSheet,true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderNativeSheet();updateBell()}});
  window.onNativeEvents();syncAlarms();
}
else if(window.claude&&window.claude.use){initCloud();initGcal().then(updateBell);initMic()}
else setSync('','שמור במכשיר הזה בלבד');
})();
