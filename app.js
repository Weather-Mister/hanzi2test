const BASE = location.pathname.replace(/\/[^/]*$/, '/');
const DATA = BASE + 'data/';
const app = document.getElementById('app');
const sheet = document.getElementById('sheet');
const overlay = document.getElementById('overlay');
const toast = document.getElementById('toast');

const state = {
  catalog:null,
  readings:[],
  listening:{items:[],scenes:[]},
  view:'course',
  subview:'learn',
  unit:null,
  lesson:null,
  stepIndex:0,
  selectedBook:'book-1',
  pinyin:true,
  progress:{lessons:{},attempts:{},studyDays:[]},
  unitCache:new Map(),
  quiz:null,
  reading:null,
  readingPinyin:false,
  readingChecked:false,
  search:'',
};

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,'').trim();}
function numberedPinyin(v){
  const toneMap={'ā':'a1','á':'a2','ǎ':'a3','à':'a4','ē':'e1','é':'e2','ě':'e3','è':'e4','ī':'i1','í':'i2','ǐ':'i3','ì':'i4','ō':'o1','ó':'o2','ǒ':'o3','ò':'o4','ū':'u1','ú':'u2','ǔ':'u3','ù':'u4','ǖ':'v1','ǘ':'v2','ǚ':'v3','ǜ':'v4','ü':'v'};
  return String(v||'').toLowerCase().split('').map(c=>toneMap[c]||c).join('').replace(/\s+/g,'');
}
function samePinyin(input,target){
  const a=norm(input).replace(/u:/g,'v').replace(/ü/g,'v');
  const b=norm(target).replace(/u:/g,'v').replace(/ü/g,'v');
  return a===b || input.toLowerCase().replace(/\s+/g,'')===numberedPinyin(target);
}
function shuffle(arr){
  const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;
}
function today(){return new Date().toISOString().slice(0,10);}
function save(){
  try{localStorage.setItem('hanzi2test-progress-v3',JSON.stringify(state.progress));localStorage.setItem('hanzi2test-settings-v2',JSON.stringify({pinyin:state.pinyin,book:state.selectedBook}));}catch{}
  updateStreak();
}
function loadLocal(){
  try{
    const p=JSON.parse(localStorage.getItem('hanzi2test-progress-v3')||'null');
    if(p&&typeof p==='object')state.progress={lessons:p.lessons||{},attempts:p.attempts||{},studyDays:Array.isArray(p.studyDays)?p.studyDays:[]};
    const s=JSON.parse(localStorage.getItem('hanzi2test-settings-v2')||'null');
    if(s){state.pinyin=s.pinyin!==false; if(s.book)state.selectedBook=s.book;}
  }catch{}
}
function markStudy(){
  const d=today(); if(!state.progress.studyDays.includes(d)){state.progress.studyDays.push(d);save();}
}
function updateStreak(){
  const days=new Set(state.progress.studyDays||[]);let n=0;let d=new Date();
  for(;;){const key=d.toISOString().slice(0,10);if(days.has(key)){n++;d.setDate(d.getDate()-1);}else break;}
  const el=document.getElementById('streakCount');if(el)el.textContent=String(n);
}
function ping(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(ping.t);ping.t=setTimeout(()=>toast.classList.remove('show'),1500);}
function speak(text,rate=1){
  if(!('speechSynthesis' in window)){ping('Speech is unavailable in this browser.');return;}
  speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='zh-TW';u.rate=rate;speechSynthesis.speak(u);
}
async function getJSON(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error('Could not load '+path);return r.json();}
async function loadUnit(id){
  if(state.unitCache.has(id))return state.unitCache.get(id);
  const data=await getJSON(DATA+'units/'+id+'.json');state.unitCache.set(id,data);return data;
}
function completedLesson(id){return !!state.progress.lessons[id]?.complete;}
function lessonProgress(id){return state.progress.lessons[id]||{index:0,complete:false};}
function unitDone(meta){
  const p=state.progress.lessons;
  return meta && meta.reviewLessonId && p[meta.reviewLessonId]?.complete;
}
function orderedUnits(book){return state.catalog.units.filter(u=>u.book===book);}
function unitUnlocked(meta){
  const list=orderedUnits(meta.book),i=list.findIndex(u=>u.id===meta.id);
  if(i<=0)return true;
  return unitDone(list[i-1]);
}
function firstCurrentUnit(){
  const all=orderedUnits(state.selectedBook);
  return all.find(u=>!unitDone(u))||all[all.length-1];
}
function wordsForUnit(id){return state.catalog.vocabulary.filter(w=>w.unitId===id || (!w.unitId && id==='unit-1'));}

function tabs(active){
  return '<div class="tabs">'+
   '<button class="tab '+(active==='learn'?'active':'')+'" data-sub="learn"><span>學</span>Learn</button>'+
   '<button class="tab '+(active==='practice'?'active':'')+'" data-sub="practice"><span>練</span>Practice</button>'+
   '<button class="tab '+(active==='reading'?'active':'')+'" data-sub="reading"><span>讀</span>Read</button>'+
   '<button class="tab '+(active==='listening'?'active':'')+'" data-sub="listening"><span>聽</span>Listen</button>'+
  '</div>';
}
function render(){
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.view));
  if(state.view==='course')renderCourse();
  else if(state.view==='practice')renderPractice();
  else if(state.view==='reading')renderReadingList();
  else if(state.view==='listening')renderListeningList();
  else if(state.view==='search')renderSearch();
}
function setView(v){
  state.view=v;if(v==='course')state.subview='learn';
  window.scrollTo({top:0,behavior:'instant'});render();
}
function renderCourse(){
  if(state.lesson){renderLesson();return;}
  const current=firstCurrentUnit(); if(!state.unit)state.unit=current;
  const chosen=state.unit||current;
  const units=orderedUnits(state.selectedBook);
  const visible=units;
  const titleBook=state.selectedBook==='book-1'?'Book 1':'Book 2';
  app.innerHTML=tabs('learn')+
   '<section class="banner">'+
    '<div class="kicker">'+esc(titleBook)+' · '+esc(chosen.label||'Course unit')+'</div>'+
    '<h1 lang="zh-Hant-TW">'+esc(chosen.goal?.text||chosen.banner?.text||chosen.title)+'</h1>'+
    (state.pinyin?'<div class="py">'+esc(chosen.goal?.pinyin||chosen.banner?.pinyin||'')+'</div>':'')+
    '<p>'+esc(chosen.description||'')+'</p>'+
    '<div class="bannerline"></div>'+
    '<div class="bannerbottom"><div class="progresscopy">UNIT '+esc(chosen.displayNumber)+' · '+esc(unitDone(chosen)?'COMPLETE':'IN PROGRESS')+'</div>'+
    '<button class="inkbutton red" data-open-unit="'+esc(chosen.id)+'">'+(unitDone(chosen)?'Review':'Continue')+'</button></div>'+
   '</section>'+
   '<div class="book-switch"><button class="'+(state.selectedBook==='book-1'?'active':'')+'" data-book="book-1">第一冊 · Book 1</button><button class="'+(state.selectedBook==='book-2'?'active':'')+'" data-book="book-2">第二冊 · Book 2</button></div>'+
   '<div class="section-title"><h2>學習之路 · Learning Path</h2><div class="small">'+esc(units.length)+' units</div></div>'+
   '<div class="path">'+visible.map((u,i)=>unitRow(u,i)).join('')+'</div>'+
   '<div class="divider"></div>'+
   '<div class="sidecards">'+
     '<div class="sidecard"><div class="sidehead"><b>本單元 · Characters</b><span>'+esc(chosen.chars?.length||0)+' characters</span></div><div class="chars">'+(chosen.chars||[]).slice(0,10).map(c=>'<button class="char" data-char="'+esc(c)+'">'+esc(c)+'</button>').join('')+'</div></div>'+
     '<div class="sidecard"><div class="sidehead"><b>今日目標 · Goal</b><span>'+esc(chosen.lessonCount)+' lessons</span></div><div class="goal"><div class="goalhan">'+esc(chosen.banner?.text?.[0]||chosen.chars?.[0]||'學')+'</div><div class="goalcopy"><b>'+esc(chosen.goal?.text||chosen.title)+'</b>'+(state.pinyin?'<span>'+esc(chosen.goal?.pinyin||'')+'</span>':'')+'<span>'+esc(chosen.goal?.meaning||chosen.description)+'</span></div></div></div>'+
   '</div>';
  bindCommon();
}
function unitRow(u,i){
  const done=unitDone(u),unlocked=unitUnlocked(u),current=!done&&unlocked;
  const c=u.chars?.[0]||u.banner?.text?.[0]||'學';
  return '<div class="row '+(done?'done':current?'current':'locked')+'">'+
   '<div class="nodewrap"><button class="node" '+(unlocked?'data-unit="'+esc(u.id)+'"':'disabled')+'>'+esc(c)+'</button></div>'+
   '<div class="card">'+(done?'<span class="completedmark">✓</span>':'')+
    '<div class="step">'+(u.book==='book-1'?'Unit ':'Book 2 · Unit ')+esc(u.displayNumber)+(done?' · Complete':current?' · Current':' · Locked')+'</div>'+
    '<h3>'+esc(u.title)+'</h3><p>'+esc(u.description)+'</p>'+
    '<div class="meta"><span>'+esc(u.lessonCount)+' lessons</span><span>'+esc(u.chars?.length||0)+' characters</span></div>'+
    (unlocked?'<button class="inkbutton '+(current?'red':'')+'" data-open-unit="'+esc(u.id)+'">'+(done?'Review':'Open unit')+'</button>':'')+
   '</div></div>';
}
async function openUnit(id){
  state.unit=state.catalog.units.find(u=>u.id===id)||state.unit;
  const data=await loadUnit(id);
  openSheet('<div class="sheet-handle"></div><div class="sheet-kicker">UNIT '+esc(state.unit.displayNumber)+'</div><h2>'+esc(state.unit.title)+'</h2><p class="sheet-desc">'+esc(state.unit.description)+'</p>'+
    '<div class="lesson-list">'+data.lessons.map((l,i)=>{
      const p=lessonProgress(l.id),done=p.complete;
      const previous=i===0 || data.lessons.slice(0,i).every(x=>completedLesson(x.id));
      const unlocked=previous;
      return '<button class="lesson-line '+(done?'done':'')+'" '+(unlocked?'data-lesson="'+esc(l.id)+'"':'disabled')+'><span class="lesson-number">'+(done?'✓':String(i+1))+'</span><span><b>'+esc(l.title)+'</b><small>'+esc(l.subtitle)+' · '+esc(l.minutes)+'</small></span><i>'+(unlocked?'›':'鎖')+'</i></button>';
    }).join('')+'</div>');
}
async function startLesson(id){
  closeSheet();
  const data=await loadUnit(state.unit.id);
  state.lesson=data.lessons.find(l=>l.id===id);
  if(!state.lesson)return;
  const p=lessonProgress(id);
  state.stepIndex=Math.min(p.index||0,Math.max(0,state.lesson.steps.length-1));
  markStudy();renderLesson();
}
function renderLesson(){
  const l=state.lesson,step=l.steps[state.stepIndex];
  if(!step){finishLesson();return;}
  const pct=Math.round((state.stepIndex/l.steps.length)*100);
  app.innerHTML='<section class="lesson-shell">'+
   '<div class="lesson-top"><button class="backbtn" data-exit-lesson>‹</button><div><div class="lesson-label">'+esc(l.title)+'</div><div class="progress-track"><i style="width:'+pct+'%"></i></div></div><span>'+esc(state.stepIndex+1)+'/'+esc(l.steps.length)+'</span></div>'+
   '<div id="exercise"></div>'+
  '</section>';
  renderStep(step);
  bindCommon();
}
async function renderStep(step){
  const data=await loadUnit(state.unit.id);
  const char=step.char?data.characters[step.char]||state.catalog.characters[step.char]:null;
  const phrase=step.phrase?data.phrases[step.phrase]:null;
  const grammar=step.grammar?data.grammarRules[step.grammar]||state.catalog.grammar[step.grammar]:null;
  let html='';
  if(step.type==='intro'&&char){
    html='<div class="exercise-kind">新字 · New character</div><div class="char-intro"><div class="big-char">'+esc(char.hanzi)+'</div><div class="char-copy"><span class="micro">TRADITIONAL</span><h1>'+esc(char.hanzi)+'</h1>'+(state.pinyin?'<div class="pinyin">'+esc(char.pinyin)+' · '+esc(char.zhuyin||'')+'</div>':'')+'<h2>'+esc(char.meaning)+'</h2><p>'+esc(char.note||'')+'</p><button class="inkbutton" data-speak="'+esc(char.hanzi)+'">聽 · Listen</button></div></div>'+
    (char.parts?.length?'<div class="paper-panel"><b>Inside the character</b><div class="part-list">'+char.parts.map(p=>'<div><strong>'+esc(p.label)+'</strong><span>'+esc(p.role)+'</span><p>'+esc(p.description)+'</p></div>').join('')+'</div><p class="memory-note">'+esc(char.memory||'')+'</p></div>':'')+
    '<div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
  }else if(['trace','complete','memory'].includes(step.type)&&char){
    const title=step.type==='trace'?'Trace the character':step.type==='complete'?'Finish the character':'Write from memory';
    html='<div class="exercise-kind">寫 · Handwriting</div><h1 class="exercise-title">'+esc(title)+'</h1><div class="writing-cue"><strong>'+esc(char.hanzi)+'</strong><span>'+(state.pinyin?esc(char.pinyin)+' · ':'')+esc(char.meaning)+'</span></div><div class="writer-box" id="writer"></div><div class="writer-status" id="writerStatus">Draw the strokes in order.</div><div class="writer-actions"><button class="inkbutton" data-writer-watch>Watch</button><button class="inkbutton" data-writer-hint>Hint</button></div><div class="lesson-actions"><button class="inkbutton red" id="writerContinue" data-next-step disabled>Continue</button></div>';
  }else if(step.type==='select'||step.type==='parts'){
    html=choiceStep(step,char,step.prompt||'Choose the answer.');
  }else if(step.type==='listen'){
    html='<div class="exercise-kind">聽 · Listening</div><h1 class="exercise-title">'+esc(step.prompt||'Which answer matches what you hear?')+'</h1><div class="listen-center"><button class="listen-orb" data-speak="'+esc(step.audioText||step.char||'')+'">聽</button><button class="text-link" data-slow="'+esc(step.audioText||step.char||'')+'">Slow</button></div>'+choiceStep(step,char,'',true);
  }else if(step.type==='phrase'&&phrase){
    html='<div class="exercise-kind">句 · Phrase</div><div class="phrase-card"><h1 lang="zh-Hant-TW">'+esc(phrase.text)+'</h1>'+(state.pinyin?'<div class="pinyin">'+esc(phrase.pinyin)+'</div>':'')+'<h2>'+esc(phrase.meaning)+'</h2><p>'+esc(phrase.note||'')+'</p><button class="inkbutton" data-speak="'+esc(phrase.text)+'">聽 · Listen</button></div><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
  }else if(step.type==='grammar'&&grammar){
    html='<div class="exercise-kind">文法 · Grammar</div><div class="grammar-card"><h1>'+esc(grammar.title)+'</h1><div class="formula">'+esc(grammar.pattern)+'</div><p>'+esc(grammar.explanation)+'</p><div class="examples">'+(grammar.examples||[]).map(e=>'<button class="example-line" data-speak="'+esc(e.text)+'"><b>'+esc(e.text)+'</b>'+(state.pinyin?'<span>'+esc(e.pinyin)+'</span>':'')+'<small>'+esc(e.meaning)+'</small></button>').join('')+'</div>'+(grammar.remember?'<div class="remember"><b>Keep in mind</b>'+esc(grammar.remember)+'</div>':'')+'</div><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
  }else if(step.type==='order'&&phrase){
    const bank=shuffle((step.tokens||[]).map((t,i)=>({text:t,id:i})));
    html='<div class="exercise-kind">排 · Build the sentence</div><h1 class="exercise-title">'+esc(phrase.meaning)+'</h1><div class="built" id="built">…</div><div class="token-bank">'+bank.map(t=>'<button data-token="'+esc(t.id)+'" data-text="'+esc(t.text)+'">'+esc(t.text)+'</button>').join('')+'</div><div class="writer-actions"><button class="inkbutton" data-order-undo>Undo</button><button class="inkbutton red" data-order-check>Check</button></div><div id="answerNote"></div>';
    setTimeout(()=>bindOrder(step,phrase,bank),0);
  }else if(step.type==='match'&&step.chars){
    html='<div class="exercise-kind">配 · Match</div><h1 class="exercise-title">Match each character to its meaning.</h1><div class="match-grid" id="matchGrid"></div>';
    setTimeout(()=>bindMatch(step.chars,data),0);
  }else if(step.type==='build'&&char){
    html='<div class="exercise-kind">組 · Build</div><h1 class="exercise-title">Build '+esc(char.hanzi)+' from its parts.</h1><div class="part-build" id="partBuild">'+(char.parts||[]).map((p,i)=>'<button data-part="'+i+'"><b>'+esc(p.label)+'</b><span>'+esc(p.name)+'</span></button>').join('')+'</div><div id="answerNote"></div>';
    setTimeout(()=>bindBuild(char),0);
  }else if(step.type==='visual'){
    html='<div class="exercise-kind">景 · Scene</div><h1 class="exercise-title">'+esc(step.prompt||'Look at the scene.')+'</h1><div class="visual-scene"><div class="scene-ink">'+esc(step.visualScene==='bed'?'床':step.visualScene==='throat'?'喉':'門')+'</div><p>'+esc(step.visualInstruction||step.visualCue||'')+'</p>'+(step.visualSuggestions?.length?'<ul>'+step.visualSuggestions.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+'</div><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
  }else{
    html='<div class="exercise-kind">習 · Practice</div><h1 class="exercise-title">Continue this lesson.</h1><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
  }
  document.getElementById('exercise').innerHTML=html;
  bindExercise(step,char);
  if(['trace','complete','memory'].includes(step.type)&&char)initWriter(char.hanzi,step.type);
}
function choiceStep(step,char,prompt,embedded=false){
  const options=shuffle(step.options||[]);
  return (embedded?'':'<div class="exercise-kind">選 · Choose</div><h1 class="exercise-title">'+esc(prompt)+'</h1>')+
   '<div class="choice-grid">'+options.map(o=>'<button class="choice" data-choice="'+esc(o)+'">'+esc(o)+'</button>').join('')+'</div><div id="answerNote"></div>';
}
function bindExercise(step,char){
  document.querySelectorAll('[data-next-step]').forEach(b=>b.addEventListener('click',nextStep));
  document.querySelectorAll('[data-speak]').forEach(b=>b.addEventListener('click',()=>speak(b.dataset.speak)));
  document.querySelectorAll('[data-slow]').forEach(b=>b.addEventListener('click',()=>speak(b.dataset.slow,.7)));
  document.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>{
    const val=b.dataset.choice,ok=val===step.answer;
    recordAttempt(step.id,ok);document.querySelectorAll('[data-choice]').forEach(x=>x.disabled=true);
    b.classList.add(ok?'correct':'wrong');
    const note=document.getElementById('answerNote');
    note.innerHTML='<div class="answer-note '+(ok?'good':'bad')+'"><b>'+(ok?'Correct':'Not quite')+'</b><p>'+esc(step.explanation||('Answer: '+step.answer))+'</p></div><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
    note.querySelector('[data-next-step]').addEventListener('click',nextStep);
  }));
}
function recordAttempt(id,ok){
  const a=state.progress.attempts[id]||{right:0,wrong:0,last:0}; if(ok)a.right++;else a.wrong++;a.last=Date.now();state.progress.attempts[id]=a;markStudy();save();
}
function bindOrder(step,phrase,bank){
  const picked=[];
  const built=document.getElementById('built');
  const draw=()=>{built.textContent=picked.length?picked.map(id=>bank.find(x=>x.id===id).text).join(' '):'…';};
  document.querySelectorAll('[data-token]').forEach(b=>b.addEventListener('click',()=>{const id=Number(b.dataset.token);if(picked.includes(id))return;picked.push(id);b.disabled=true;draw();}));
  document.querySelector('[data-order-undo]').addEventListener('click',()=>{const id=picked.pop();if(id!==undefined){const b=document.querySelector('[data-token="'+id+'"]');if(b)b.disabled=false;draw();}});
  document.querySelector('[data-order-check]').addEventListener('click',()=>{
    const answer=picked.map(id=>bank.find(x=>x.id===id).text).join('');
    const target=(phrase.tokens||[]).join('');
    const ok=answer===target;recordAttempt(step.id,ok);
    document.getElementById('answerNote').innerHTML='<div class="answer-note '+(ok?'good':'bad')+'"><b>'+(ok?'Correct':'Try the model')+'</b><p>'+esc(phrase.text)+' · '+esc(phrase.meaning)+'</p></div><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';
    document.querySelector('#answerNote [data-next-step]').addEventListener('click',nextStep);
  });
}
function bindMatch(chars,data){
  const meanings=shuffle(chars.map(c=>({c,meaning:(data.characters[c]||state.catalog.characters[c])?.meaning||''})));
  let left=null,right=null,matched=new Set();
  const grid=document.getElementById('matchGrid');
  function draw(){
    grid.innerHTML='<div>'+chars.map(c=>'<button class="match '+(matched.has(c)?'matched':'')+'" data-match-left="'+esc(c)+'" '+(matched.has(c)?'disabled':'')+'>'+esc(c)+'</button>').join('')+'</div><div>'+meanings.map(x=>'<button class="match text '+(matched.has(x.c)?'matched':'')+'" data-match-right="'+esc(x.c)+'" '+(matched.has(x.c)?'disabled':'')+'>'+esc(x.meaning)+'</button>').join('')+'</div>';
    grid.querySelectorAll('[data-match-left]').forEach(b=>b.onclick=()=>{left=b.dataset.matchLeft;b.classList.add('selected');check();});
    grid.querySelectorAll('[data-match-right]').forEach(b=>b.onclick=()=>{right=b.dataset.matchRight;b.classList.add('selected');check();});
  }
  function check(){
    if(!left||!right)return;
    if(left===right){matched.add(left);recordAttempt('match-'+left,true);left=right=null;draw();if(matched.size===chars.length){grid.insertAdjacentHTML('afterend','<div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>');document.querySelector('[data-next-step]').onclick=nextStep;}}
    else{recordAttempt('match-'+left,false);ping('Those do not match.');left=right=null;draw();}
  }
  draw();
}
function bindBuild(char){
  const order=[];document.querySelectorAll('[data-part]').forEach(b=>b.onclick=()=>{if(b.disabled)return;order.push(Number(b.dataset.part));b.disabled=true;if(order.length===char.parts.length){const ok=order.every((x,i)=>x===i);recordAttempt('build-'+char.hanzi,ok);document.getElementById('answerNote').innerHTML='<div class="answer-note '+(ok?'good':'bad')+'"><b>'+(ok?'Built correctly':'Study the component order')+'</b><p>'+esc(char.parts.map(p=>p.label).join(' + '))+'</p></div><div class="lesson-actions"><button class="inkbutton red" data-next-step>Continue</button></div>';document.querySelector('#answerNote [data-next-step]').onclick=nextStep;}}); 
}
function initWriter(char,mode){
  const host=document.getElementById('writer'),status=document.getElementById('writerStatus'),cont=document.getElementById('writerContinue');
  let writer=null;
  function start(){
    if(!window.HanziWriter){status.textContent='Handwriting engine is still loading…';setTimeout(start,250);return;}
    host.replaceChildren();
    writer=HanziWriter.create('writer',char,{width:Math.min(330,host.clientWidth||330),height:Math.min(330,host.clientWidth||330),padding:18,showCharacter:mode==='trace',showOutline:mode!=='memory',strokeColor:'#1b1713',outlineColor:'#cdbd9f',drawingColor:'#9f2f23',drawingWidth:10,highlightColor:'#9f2f23'});
    writer.quiz({leniency:1.3,showHintAfterMisses:2,onComplete:d=>{status.textContent=d.totalMistakes?'Complete with support.':'Character complete.';cont.disabled=false;recordAttempt('write-'+char,d.totalMistakes===0);}});
  }
  start();
  document.querySelector('[data-writer-watch]').onclick=()=>{if(writer){writer.cancelQuiz();writer.animateCharacter({onComplete:()=>writer.quiz({leniency:1.3,showHintAfterMisses:2,onComplete:d=>{status.textContent='Character complete.';cont.disabled=false;recordAttempt('write-'+char,d.totalMistakes===0);}})});}};
  document.querySelector('[data-writer-hint]').onclick=()=>{if(writer)writer.highlightStroke(0);};
}
function nextStep(){
  const l=state.lesson;state.stepIndex++;
  state.progress.lessons[l.id]={index:state.stepIndex,complete:state.stepIndex>=l.steps.length,updatedAt:Date.now()};
  markStudy();save();
  if(state.stepIndex>=l.steps.length)finishLesson();else renderLesson();
}
function finishLesson(){
  const l=state.lesson;if(l)state.progress.lessons[l.id]={index:l.steps.length,complete:true,updatedAt:Date.now()};
  save();state.lesson=null;state.stepIndex=0;renderCourse();ping('Lesson complete');
}

function renderPractice(){
  app.innerHTML=tabs('practice')+'<div class="simplepage"><div class="kicker ink">Practice Hall</div><h1>練習</h1><p>Everything runs locally. Search and handwriting are always unlocked.</p>'+
   '<div class="practice-grid">'+
    '<button class="practice" data-practice="mega"><b>Mega Challenge</b><span>Hanzi → meaning</span><i>大</i></button>'+
    '<button class="practice" data-practice="reverse"><b>Reverse Mega</b><span>Hanzi → pinyin input</span><i>音</i></button>'+
    '<button class="practice" data-practice="write"><b>Handwriting</b><span>All characters unlocked</span><i>寫</i></button>'+
    '<button class="practice" data-practice="review"><b>Smart Review</b><span>Prioritize misses</span><i>習</i></button>'+
   '</div></div>';
  bindCommon();document.querySelectorAll('[data-practice]').forEach(b=>b.onclick=()=>startPractice(b.dataset.practice));
}
function practicePool(){
  return Object.values(state.catalog.characters).filter(c=>c&&c.hanzi&&c.meaning);
}
function practiceWordPool(){
  const seen=new Set();
  return state.catalog.vocabulary.filter(w=>{
    if(!w?.text||!w?.meaning||!/[\u3400-\u9fff]/.test(w.text)||seen.has(w.text))return false;
    seen.add(w.text);return true;
  });
}
function meaningAccepted(input,meaning){
  const n=norm(input);if(!n)return false;
  const raw=String(meaning||'').replace(/\([^)]*\)/g,'');
  const alts=[raw,...raw.split(/\s*;\s*|\s+\/\s+|,\s+/)]
    .map(x=>norm(x.replace(/^to\s+/i,''))).filter(Boolean);
  return alts.includes(n)||alts.some(x=>x.length>=4&&n===x.replace(/^to/,''));
}
function startPractice(mode){
  if(mode==='write'){
    const pool=practicePool();
    openSheet('<div class="sheet-handle"></div><div class="sheet-kicker">HANDWRITING · ALL UNLOCKED</div><h2>Choose any character</h2><input id="practiceCharSearch" class="search" placeholder="Search character, pinyin, or meaning"><div id="practiceChars" class="char-pick-grid"></div>');
    const input=document.getElementById('practiceCharSearch'),box=document.getElementById('practiceChars');
    const draw=()=>{const q=norm(input.value);box.innerHTML=pool.filter(c=>!q||norm(c.hanzi+c.pinyin+c.meaning).includes(q)).slice(0,160).map(c=>'<button data-write-char="'+esc(c.hanzi)+'"><b>'+esc(c.hanzi)+'</b><span>'+esc(c.pinyin)+'</span></button>').join('');box.querySelectorAll('[data-write-char]').forEach(b=>b.onclick=()=>openWritingPractice(b.dataset.writeChar));};
    input.oninput=draw;draw();return;
  }
  let list=practiceWordPool();
  if(mode==='review'){
    list=[...list].sort((a,b)=>{
      const aa=state.progress.attempts['mega-word-'+a.text]||{},bb=state.progress.attempts['mega-word-'+b.text]||{};
      if(Boolean(aa.mastered)!==Boolean(bb.mastered))return aa.mastered?1:-1;
      return ((bb.wrong||0)-(bb.right||0))-((aa.wrong||0)-(aa.right||0));
    });
  }else list=shuffle(list);
  state.quiz={mode:mode==='review'?'mega':mode,review:mode==='review',list,index:0,right:0,wrong:0,revealed:false,lastResult:null};
  renderPracticeQuestion();
}
function renderPracticeQuestion(){
  const q=state.quiz;if(!q)return;
  if(q.index>=q.list.length){
    app.innerHTML='<div class="finish-screen"><div class="seal big">成</div><h1>Round complete</h1><p>'+q.right+' correct · '+q.wrong+' missed</p><button class="inkbutton red" data-back-practice>Back to practice</button></div>';
    document.querySelector('[data-back-practice]').onclick=()=>{state.quiz=null;renderPractice();};return;
  }
  const item=q.list[q.index],rec=state.progress.attempts['mega-word-'+item.text]||{};
  app.innerHTML='<div class="practice-session"><button class="backbtn" data-back-practice>‹</button><div class="practice-count">'+(q.index+1)+' / '+q.list.length+(q.review?' · SMART REVIEW':'')+'</div>'+
   '<div class="mega-char">'+esc(item.text)+'</div>'+
   '<div class="mega-meaning">'+(q.mode==='reverse'?esc(item.meaning):'What does this mean?')+'</div>'+
   (q.revealed?'<div class="paper-panel" style="text-align:center"><b>'+esc(item.pinyin)+'</b><p>'+esc(item.meaning)+'</p></div>':
    '<form id="megaForm"><input class="pinyin-input" id="megaInput" autocomplete="off" autocapitalize="off" placeholder="'+(q.mode==='reverse'?'Type pinyin: ni3 / nǐ / ni':'Type the English meaning')+'"><button class="inkbutton red">Check</button></form>')+
   '<div id="practiceFeedback">'+(q.lastResult?'<div class="answer-note '+(q.lastResult.ok?'good':'bad')+'"><b>'+esc(q.lastResult.title)+'</b><p>'+esc(q.lastResult.text)+'</p></div>':'')+'</div>'+
   '<div class="practice-actions mega-actions"><button class="ghostbutton" data-mega-skip>Skip</button><button class="ghostbutton" data-mega-giveup>Give up</button><button class="ghostbutton '+(rec.mastered?'mastered':'')+'" data-mega-mastered>'+(rec.mastered?'✓ Mastered':'Mastered')+'</button></div>'+
   ((q.revealed||q.lastResult)?'<button class="inkbutton red" style="width:100%;margin-top:9px" data-mega-next>Next</button>':'')+
   '</div>';
  document.querySelector('[data-back-practice]').onclick=()=>{state.quiz=null;renderPractice();};
  const form=document.getElementById('megaForm');
  if(form)form.onsubmit=e=>{e.preventDefault();const input=document.getElementById('megaInput').value;const ok=q.mode==='reverse'?samePinyin(input,item.pinyin):meaningAccepted(input,item.meaning);practiceResult(item,ok);};
  document.querySelector('[data-mega-skip]').onclick=()=>{q.index++;q.revealed=false;q.lastResult=null;renderPracticeQuestion();};
  document.querySelector('[data-mega-giveup]').onclick=()=>{recordAttempt('mega-word-'+item.text,false);q.wrong++;q.revealed=true;q.lastResult={ok:false,title:'Answer revealed',text:item.pinyin+' · '+item.meaning};renderPracticeQuestion();};
  document.querySelector('[data-mega-mastered]').onclick=()=>{
    const k='mega-word-'+item.text,a=state.progress.attempts[k]||{right:0,wrong:0,last:0};a.mastered=true;a.right=Math.max(a.right||0,3);a.last=Date.now();state.progress.attempts[k]=a;markStudy();save();
    q.revealed=true;q.lastResult={ok:true,title:'Marked mastered',text:item.pinyin+' · '+item.meaning};renderPracticeQuestion();
  };
  const next=document.querySelector('[data-mega-next]');if(next)next.onclick=()=>{q.index++;q.revealed=false;q.lastResult=null;renderPracticeQuestion();};
  setTimeout(()=>document.getElementById('megaInput')?.focus(),0);
}
function practiceResult(item,ok){
  const q=state.quiz;if(!q)return;
  q[ok?'right':'wrong']++;recordAttempt('mega-word-'+item.text,ok);
  q.revealed=true;q.lastResult={ok,title:ok?'Correct':'Answer',text:item.pinyin+' · '+item.meaning};
  renderPracticeQuestion();
}
function openWritingPractice(char){
  closeSheet();
  const c=state.catalog.characters[char];
  app.innerHTML='<div class="practice-session"><button class="backbtn" data-back-practice>‹</button><div class="writing-cue"><strong>'+esc(char)+'</strong><span>'+esc(c.pinyin)+' · '+esc(c.meaning)+'</span></div><div class="writer-box" id="writer"></div><div class="writer-status" id="writerStatus">Write from memory.</div><div class="writer-actions"><button class="inkbutton" data-writer-watch>Watch</button><button class="inkbutton" data-writer-hint>Hint</button></div><button class="inkbutton red" id="writerContinue" data-back-practice disabled>Done</button></div>';
  initWriter(char,'memory');document.querySelectorAll('[data-back-practice]').forEach(b=>b.onclick=()=>renderPractice());
}

function renderReadingList(){
  app.innerHTML=tabs('reading')+'<div class="simplepage"><div class="kicker ink">Reading Path · Fully unlocked</div><h1>讀 · Reading</h1><p>All comprehension checkpoints are available immediately. Progress is saved only on this device.</p><div class="reading-list">'+state.readings.map((r,i)=>'<button class="reading-item" data-reading="'+esc(r.id)+'"><span class="seal mini">讀</span><span><small>'+esc(r.unitId.replace('unit-','Unit '))+' · '+esc(r.kind)+'</small><b>'+esc(r.title)+'</b><em>'+esc(r.lines.length)+' lines · '+esc(r.questions.length)+' questions</em></span><i>›</i></button>').join('')+'</div></div>';
  bindCommon();document.querySelectorAll('[data-reading]').forEach(b=>b.onclick=()=>openReading(b.dataset.reading));
}
function openReading(id){
  state.reading=state.readings.find(r=>r.id===id);
  state.readingPinyin=false;
  state.readingChecked=false;
  renderReading();
}
function renderReading(){
  const r=state.reading;if(!r){renderReadingList();return;}
  app.innerHTML='<div class="reading-main"><button class="backbtn" data-reading-back>‹</button><div class="kicker ink">'+esc(r.kind)+' · '+esc(r.unitId)+'</div><h1>'+esc(r.title)+'</h1><p class="reading-setup">'+esc(r.setup||'')+'</p>'+
   '<div class="reading-tools"><button class="inkbutton" id="toggleReadingPinyin">'+(state.readingPinyin?'Hide':'Reveal')+' pinyin</button></div>'+
   '<div class="reading-passage">'+r.lines.map((l,i)=>'<article class="reading-line"><span class="reading-line-number">'+(i+1)+'</span><div>'+(l.speaker?'<small class="speaker">'+esc(l.speaker)+'</small>':'')+'<p class="reading-chinese">'+esc(l.text)+'</p>'+(state.readingPinyin?'<p class="reading-pinyin">'+esc(l.pinyin)+'</p>':'')+'<button class="text-link" data-speak="'+esc(l.text)+'">聽 · listen</button></div></article>').join('')+'</div>'+
   '<section class="reading-questions"><h2>Comprehension</h2>'+r.questions.map((q,qi)=>'<fieldset class="reading-question"><legend><span>'+(qi+1)+'</span>'+esc(q.prompt)+'</legend><div class="reading-options">'+q.options.map((o,oi)=>'<label class="reading-option"><input type="radio" name="rq'+qi+'" value="'+oi+'"><span>'+esc(o)+'</span></label>').join('')+'</div><div class="rq-feedback" id="rqf'+qi+'"></div></fieldset>').join('')+'<button class="inkbutton red" id="checkReading">Check answers</button></section>'+
   (state.readingChecked?'<section class="walkthrough open-walkthrough"><div class="sheet-kicker">AFTER THE QUESTIONS</div><h2>解讀 · Full explanation</h2><div class="translation-block">'+r.lines.map((l,i)=>'<article><b>'+esc(l.text)+'</b><p class="reading-pinyin">'+esc(l.pinyin)+'</p><p>'+esc(l.translation)+'</p><small>'+esc(l.note||'')+'</small></article>').join('')+'</div>'+(r.tips?.length?'<div class="reading-tips"><h3>Reading tips</h3><ul>'+r.tips.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul></div>':'')+(r.grammarFocus?.length?'<div class="reading-tips"><h3>Grammar focus</h3><p>'+esc(r.grammarFocus.join(' · '))+'</p></div>':'')+'</section>':'')+'</div>';
  document.querySelector('[data-reading-back]').onclick=()=>{state.reading=null;renderReadingList();};
  document.getElementById('toggleReadingPinyin').onclick=()=>{state.readingPinyin=!state.readingPinyin;renderReading();};
  document.querySelectorAll('[data-speak]').forEach(b=>b.onclick=()=>speak(b.dataset.speak));
  document.getElementById('checkReading').onclick=()=>checkReading(r);
}
function checkReading(r){
  let score=0;state.readingChecked=true;r.questions.forEach((q,qi)=>{const selected=document.querySelector('input[name="rq'+qi+'"]:checked');const val=selected?Number(selected.value):-1;const ok=val===q.answer;if(ok)score++;const box=document.getElementById('rqf'+qi);box.innerHTML='<div class="answer-note '+(ok?'good':'bad')+'"><b>'+(ok?'Correct':'Answer: '+esc(q.options[q.answer]))+'</b><p>'+esc(q.explanation||'')+'</p></div>';});
  markStudy();ping(score+' / '+r.questions.length+' correct');
}

function renderListeningList(){
  app.innerHTML=tabs('listening')+'<div class="simplepage"><div class="kicker ink">Listening Path · Fully unlocked</div><h1>聽 · Listening</h1><p>All listening items and scene transcripts are open immediately.</p><div class="listening-stage-grid">'+
   state.listening.items.map(x=>'<button class="listening-stage" data-listen-item="'+esc(x.id)+'"><span class="seal mini">聽</span><h3>'+esc(x.phrase?.meaning||x.id)+'</h3><p>'+esc(x.reason||'')+'</p><small>Meaning + pinyin</small></button>').join('')+'</div>'+
   '<div class="divider"></div><div class="section-title"><h2>場景 · Listening scenes</h2><div class="small">'+state.listening.scenes.length+' scenes</div></div><div class="reading-list">'+state.listening.scenes.map(s=>'<button class="reading-item" data-listen-scene="'+esc(s.id)+'"><span class="seal mini">聲</span><span><small>'+esc(s.kind)+' · '+esc(s.unitId)+'</small><b>'+esc(s.title)+'</b><em>'+s.lines.length+' clips</em></span><i>›</i></button>').join('')+'</div></div>';
  bindCommon();document.querySelectorAll('[data-listen-item]').forEach(b=>b.onclick=()=>openListenItem(b.dataset.listenItem));document.querySelectorAll('[data-listen-scene]').forEach(b=>b.onclick=()=>openListenScene(b.dataset.listenScene));
}
function openListenItem(id){
  const x=state.listening.items.find(i=>i.id===id);if(!x)return;
  const options=shuffle([x.phrase.meaning,...x.distractors.map(d=>d.text)]);
  app.innerHTML='<div class="listening-question"><button class="backbtn" data-listen-back>‹</button><div class="listen-center"><button class="listen-orb" id="playListening">聽</button><button class="text-link" id="slowListening">Slow</button></div><h1>What does the full sentence mean?</h1><div class="choice-grid">'+options.map(o=>'<button class="choice" data-listen-choice="'+esc(o)+'">'+esc(o)+'</button>').join('')+'</div><div id="listenFeedback"></div></div>';
  document.querySelector('[data-listen-back]').onclick=renderListeningList;document.getElementById('playListening').onclick=()=>speak(x.phrase.text);document.getElementById('slowListening').onclick=()=>speak(x.phrase.text,.7);
  document.querySelectorAll('[data-listen-choice]').forEach(b=>b.onclick=()=>{const ok=b.dataset.listenChoice===x.phrase.meaning;recordAttempt('listen-'+x.id,ok);document.querySelectorAll('[data-listen-choice]').forEach(y=>y.disabled=true);document.getElementById('listenFeedback').innerHTML='<div class="answer-note '+(ok?'good':'bad')+'"><b>'+(ok?'Correct':'Answer')+'</b><p lang="zh-Hant-TW">'+esc(x.phrase.text)+'</p>'+(state.pinyin?'<p>'+esc(x.phrase.pinyin)+'</p>':'')+'<p>'+esc(x.phrase.meaning)+'</p><small>'+esc(x.reason)+'</small></div>';});
}
function openListenScene(id){
  const s=state.listening.scenes.find(x=>x.id===id);if(!s)return;
  app.innerHTML='<div class="reading-main"><button class="backbtn" data-listen-back>‹</button><div class="kicker ink">'+esc(s.kind)+' · '+esc(s.unitId)+'</div><h1>'+esc(s.title)+'</h1><p class="reading-setup">Tap each line to hear it. Transcript and translation are available because listening is fully unlocked in this test build.</p><div class="listening-transcript">'+s.lines.map((l,i)=>'<article><button class="listen-line" data-speak="'+esc(l.text)+'"><span>'+(i+1)+'</span><div>'+(l.speaker?'<small>'+esc(l.speaker)+'</small>':'')+'<b>'+esc(l.text)+'</b>'+(state.pinyin?'<em>'+esc(l.pinyin)+'</em>':'')+'<p>'+esc(l.translation)+'</p></div><i>聽</i></button></article>').join('')+'</div></div>';
  document.querySelector('[data-listen-back]').onclick=renderListeningList;document.querySelectorAll('[data-speak]').forEach(b=>b.onclick=()=>speak(b.dataset.speak));
}

function renderSearch(){
  const q=norm(state.search);
  const chars=Object.values(state.catalog.characters).filter(c=>!q||norm(c.hanzi+c.pinyin+c.zhuyin+c.meaning+c.note).includes(q)).slice(0,80);
  const words=state.catalog.vocabulary.filter(w=>!q||norm(w.text+w.pinyin+w.meaning+w.note).includes(q)).slice(0,80);
  const grammar=Object.values(state.catalog.grammar).filter(g=>!q||norm(g.title+g.pattern+g.explanation).includes(q)).slice(0,25);
  app.innerHTML='<div class="simplepage"><div class="kicker ink">Always unlocked</div><h1>字庫 · Search</h1><p>Search the entire static course by Hanzi, pinyin, Zhuyin, English, or grammar.</p><input class="search" id="globalSearch" value="'+esc(state.search)+'" placeholder="Search Hanzi, pinyin, English…">'+
   (chars.length?'<h2 class="result-head">Characters <span>'+chars.length+'</span></h2><div class="search-grid">'+chars.map(c=>'<button class="search-char" data-char="'+esc(c.hanzi)+'"><b>'+esc(c.hanzi)+'</b><span>'+esc(c.pinyin)+'</span><small>'+esc(c.meaning)+'</small></button>').join('')+'</div>':'')+
   (words.length?'<h2 class="result-head">Words <span>'+words.length+'</span></h2><div class="word-results">'+words.map(w=>'<button class="word-result" data-word="'+esc(w.text)+'"><b>'+esc(w.text)+'</b><span>'+esc(w.pinyin)+'</span><small>'+esc(w.meaning)+'</small></button>').join('')+'</div>':'')+
   (grammar.length?'<h2 class="result-head">Grammar <span>'+grammar.length+'</span></h2><div class="word-results">'+grammar.map(g=>'<button class="word-result" data-grammar="'+esc(g.id)+'"><b>'+esc(g.title)+'</b><span>'+esc(g.pattern)+'</span><small>'+esc(g.explanation)+'</small></button>').join('')+'</div>':'')+'</div>';
  const input=document.getElementById('globalSearch');input.oninput=()=>{state.search=input.value;clearTimeout(renderSearch.t);renderSearch.t=setTimeout(renderSearch,100);};
  bindCommon();document.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>openWordCard(b.dataset.word));document.querySelectorAll('[data-grammar]').forEach(b=>b.onclick=()=>openGrammarCard(b.dataset.grammar));
}
function openCharacter(char){
  const c=state.catalog.characters[char];if(!c)return;
  const words=state.catalog.vocabulary.filter(w=>w.text.includes(char)).slice(0,30);
  openSheet('<div class="sheet-handle"></div><div class="char-sheet-head"><div class="sheet-char">'+esc(c.hanzi)+'</div><div><h2>'+esc(c.pinyin)+'</h2><p>'+esc(c.zhuyin||'')+'</p><b>'+esc(c.meaning)+'</b></div></div><p class="sheet-desc">'+esc(c.note||'')+'</p>'+
   (c.memory?'<div class="paper-panel"><b>Memory note</b><p>'+esc(c.memory)+'</p></div>':'')+
   (c.parts?.length?'<div class="paper-panel"><b>Components</b>'+c.parts.map(p=>'<div class="component-line"><strong>'+esc(p.label)+'</strong><span>'+esc(p.role)+' · '+esc(p.description)+'</span></div>').join('')+'</div>':'')+
   '<div class="sheet-actions"><button class="inkbutton" data-speak="'+esc(c.hanzi)+'">聽 Listen</button><button class="inkbutton red" data-sheet-write="'+esc(c.hanzi)+'">寫 Practice</button></div>'+
   (words.length?'<h3 class="sheet-subhead">Words containing '+esc(c.hanzi)+'</h3><div class="word-results">'+words.map(w=>'<button class="word-result" data-word="'+esc(w.text)+'"><b>'+esc(w.text)+'</b><span>'+esc(w.pinyin)+'</span><small>'+esc(w.meaning)+'</small></button>').join('')+'</div>':''));
  sheet.querySelectorAll('[data-speak]').forEach(b=>b.onclick=()=>speak(b.dataset.speak));sheet.querySelectorAll('[data-sheet-write]').forEach(b=>b.onclick=()=>openWritingPractice(b.dataset.sheetWrite));sheet.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>openWordCard(b.dataset.word));
}
function openWordCard(text){
  const w=state.catalog.vocabulary.find(x=>x.text===text);if(!w)return;
  openSheet('<div class="sheet-handle"></div><div class="sheet-kicker">WORD</div><h2 class="word-big">'+esc(w.text)+'</h2><div class="pinyin">'+esc(w.pinyin)+'</div><h3>'+esc(w.meaning)+'</h3><p class="sheet-desc">'+esc(w.note||'')+'</p><div class="sheet-actions"><button class="inkbutton" data-speak="'+esc(w.text)+'">聽 Listen</button></div>');
  sheet.querySelector('[data-speak]').onclick=()=>speak(w.text);
}
function openGrammarCard(id){
  const g=state.catalog.grammar[id];if(!g)return;
  openSheet('<div class="sheet-handle"></div><div class="sheet-kicker">GRAMMAR</div><h2>'+esc(g.title)+'</h2><div class="formula">'+esc(g.pattern)+'</div><p class="sheet-desc">'+esc(g.explanation)+'</p><div class="examples">'+(g.examples||[]).map(e=>'<button class="example-line" data-speak="'+esc(e.text)+'"><b>'+esc(e.text)+'</b><span>'+esc(e.pinyin)+'</span><small>'+esc(e.meaning)+'</small></button>').join('')+'</div>');
  sheet.querySelectorAll('[data-speak]').forEach(b=>b.onclick=()=>speak(b.dataset.speak));
}
function openSheet(html){sheet.innerHTML=html;sheet.hidden=false;overlay.hidden=false;requestAnimationFrame(()=>{sheet.classList.add('show');overlay.classList.add('show');});}
function closeSheet(){sheet.classList.remove('show');overlay.classList.remove('show');setTimeout(()=>{sheet.hidden=true;overlay.hidden=true;sheet.innerHTML='';},180);}
function openSettings(){
  openSheet('<div class="sheet-handle"></div><div class="sheet-kicker">SETTINGS</div><h2>Study preferences</h2><label class="setting-row"><span><b>Pinyin</b><small>Show pinyin throughout lessons and readings.</small></span><input type="checkbox" id="pinyinToggle" '+(state.pinyin?'checked':'')+'></label><div class="paper-panel"><b>Local-only test build</b><p>There is no account or backend. Progress, streak, review history, and preferences stay in this browser.</p></div><button class="inkbutton" id="resetProgress">Reset local progress</button>');
  document.getElementById('pinyinToggle').onchange=e=>{state.pinyin=e.target.checked;save();render();};
  document.getElementById('resetProgress').onclick=()=>{if(confirm('Reset local course progress on this device?')){state.progress={lessons:{},attempts:{},studyDays:[]};save();closeSheet();render();}};
}
function bindCommon(){
  document.querySelectorAll('[data-sub]').forEach(b=>b.onclick=()=>{const v=b.dataset.sub;if(v==='learn')setView('course');else setView(v);});
  document.querySelectorAll('[data-book]').forEach(b=>b.onclick=()=>{state.selectedBook=b.dataset.book;state.unit=null;save();renderCourse();});
  document.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>{state.unit=state.catalog.units.find(u=>u.id===b.dataset.unit);renderCourse();});
  document.querySelectorAll('[data-open-unit]').forEach(b=>b.onclick=()=>openUnit(b.dataset.openUnit));
  document.querySelectorAll('[data-char]').forEach(b=>b.onclick=()=>openCharacter(b.dataset.char));
  document.querySelectorAll('[data-speak]').forEach(b=>b.onclick=()=>speak(b.dataset.speak));
  document.querySelectorAll('[data-exit-lesson]').forEach(b=>b.onclick=()=>{state.lesson=null;state.stepIndex=0;renderCourse();});
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>setView(b.dataset.nav));
document.querySelector('[data-action="home"]').onclick=()=>setView('course');
document.querySelector('[data-action="settings"]').onclick=openSettings;
document.querySelector('[data-action="streak"]').onclick=()=>ping((state.progress.studyDays||[]).length+' study days saved locally');
overlay.onclick=closeSheet;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!sheet.hidden)closeSheet();});

(async function init(){
  loadLocal();updateStreak();
  try{
    const [catalog,readings,listening]=await Promise.all([getJSON(DATA+'catalog.json'),getJSON(DATA+'readings.json'),getJSON(DATA+'listening.json')]);
    state.catalog=catalog;state.readings=readings;state.listening=listening;
    if(!orderedUnits(state.selectedBook).length)state.selectedBook='book-1';
    state.unit=firstCurrentUnit();render();
  }catch(err){
    app.innerHTML='<section class="loading-state"><div class="ink-loader">誤</div><h1>Could not open the course.</h1><p>'+esc(err.message)+'</p><button class="inkbutton red" onclick="location.reload()">Reload</button></section>';
  }
})();