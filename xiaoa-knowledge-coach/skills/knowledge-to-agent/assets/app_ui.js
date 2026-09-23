/* ============================================================
   「小A」知识游戏化引擎 v2 · 交互 / UI 层
   依赖 app_core.js（KB / SCENES / RANKS 由 index.html 注入）
   ============================================================ */

/* ---------------- DOM 引用 & 工具 ---------------- */
const app = document.getElementById('app');
const fx  = document.getElementById('fx');
const $ = s => app.querySelector(s);
function esc(t){ return (t==null?'':String(t)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),1600); }
function closeModal(){ document.getElementById('mask').classList.remove('show'); }
function openModal(html){ document.getElementById('modal').innerHTML=html; document.getElementById('mask').classList.add('show'); }

/* ---------------- 音效 ---------------- */
let audioCtx=null, soundOn = localStorage.getItem('xiaoA_sound')!=='0';
function initAudio(){ if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume(); }
function beep(freq,dur,type='sine',vol=0.12,when=0){
  if(!soundOn||!audioCtx) return;
  const t0=audioCtx.currentTime+when, o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type=type; o.frequency.setValueAtTime(freq,t0); g.gain.setValueAtTime(vol,t0);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+dur); o.connect(g); g.connect(audioCtx.destination); o.start(t0); o.stop(t0+dur);
}
const Sound={
  tap(){ beep(660,0.05,'triangle',0.06); },
  correct(){ beep(880,0.09); beep(1180,0.11,'sine',0.08,0.07); },
  wrong(){ beep(220,0.16,'sawtooth',0.06); },
  win(){ [660,830,990,1320].forEach((f,i)=>beep(f,0.13,'sine',0.09,i*0.09)); }
};
function toggleSound(){ soundOn=!soundOn; localStorage.setItem('xiaoA_sound',soundOn?'1':'0'); initAudio(); const b=document.getElementById('soundBtn'); if(b)b.textContent=soundOn?'🔊':'🔇'; toast(soundOn?'🔊 音效已开启':'🔇 音效已关闭'); }
function confetti(){
  const cols=['#6c5ce7','#00b894','#fdcb6e','#e17055','#74b9ff','#a29bfe'];
  for(let i=0;i<46;i++){
    const d=document.createElement('div'); d.className='conf';
    d.style.left=Math.random()*100+'%'; d.style.background=cols[i%cols.length];
    d.style.animationDuration=(1.5+Math.random()*1.4)+'s'; d.style.animationDelay=(Math.random()*0.5)+'s';
    fx.appendChild(d); setTimeout(()=>d.remove(),3200);
  }
}

/* ---------------- 语音朗读：页级调度 ----------------
   任何带 data-tts-text 的元素都会自动加入「整段朗读」序列，
   点它则单独朗读该句。这样新增页面无需改动朗读逻辑。 */
let TTS_PAGE={els:[]};
function esca(t){ return esc(t).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function ttsCollect(){ TTS_PAGE.els=[].slice.call(document.querySelectorAll('#app [data-tts-text]')); return TTS_PAGE.els; }
function ttsSyncBtns(){
  const b=document.getElementById('ttsMain');
  if(b){ const on=!!TTS._speaking; b.classList.toggle('playing',on); b.textContent=on?'⏹ 停止朗读':'🔊 听小A讲这一关'; }
}
/* 整段朗读：before/after 是开场白与结束语 */
function ttsPlayPage(before,after){
  if(!TTS.supported||!TTS.on) return;
  const els=ttsCollect();
  if(!els.length&&!(before&&before.length)) return;
  const seq=[];
  (before||[]).forEach(t=>seq.push({t:t,p:680,el:null}));
  els.forEach(el=>seq.push({t:el.getAttribute('data-tts-text')||el.textContent,p:null,el:el}));
  (after||[]).forEach(t=>seq.push({t:t,p:520,el:null}));
  TTS_HL=seq.map(x=>x.el);
  ttsSpeak(seq,{ onLine:i=>ttsMark(i), onDone:()=>{ ttsMark(-1); ttsSyncBtns(); } });
  ttsSyncBtns();
}
/* 点读单句（不在整段序列里的元素也能读） */
function ttsPlayOne(el){
  if(!TTS.supported||!TTS.on||!el) return;
  const i=TTS_PAGE.els.indexOf(el);
  const k=i>=0?i:0;
  TTS_HL=i>=0?TTS_PAGE.els:[el];
  ttsSpeak([{t:el.getAttribute('data-tts-text')||el.textContent}],
           { onLine:n=>ttsMark(n===0?k:-1), onDone:()=>{ ttsMark(-1); ttsSyncBtns(); } });
  ttsSyncBtns();
}

/* ---------------- 人设 / 段位 ---------------- */
function persona(sceneId){
  const c = sget(sceneId).completed.length;
  const u = curUser();
  const tier = u ? (AGE_TIERS[u.age]||AGE_TIERS['19-40']) : AGE_TIERS['19-40'];
  if(c>=31) return {name:'知己小A', emoji:'😎', mood:'我们，已经很默契了 🙌'};
  if(c>=11) return {name:'伙伴小A', emoji:'😄', mood:'走！咱们继续闯 🚀'};
  return {name:'导师小A', emoji:'🧑‍🏫', mood:tier.greet};
}
function rankOf(xp){ let r=RANKS[0]; for(const x of RANKS) if(xp>=x.xp) r=x; return r; }
function totalXp(){ let x=ST.bonusXp||0; for(const k in ST.scenes) x+=ST.scenes[k].xp; return x; }
function totalDone(){ let n=0; for(const k in ST.scenes) n+=ST.scenes[k].completed.length; return n; }
function totalPerfect(){ let n=0; for(const k in ST.scenes) n+=ST.scenes[k].perfect.length; return n; }
function disclaimerHTML(){ return '<div class="foot">讲解、题目与解析均由 AI 辅助整理生成，仅供课后练习，不作为教学评价或考试依据；如与教材或老师讲解不一致，请以教材和老师为准。<br>适度使用益智，沉迷屏幕伤身 —— 每天 10~15 分钟，学完就休息 🌱</div>'; }
function syncTotals(){ ST.totals.done=totalDone(); ST.totals.perfect=totalPerfect(); ST.totals.xp=totalXp(); }

/* ---------------- 顶栏 ---------------- */
function topbar(){
  const u=curUser();
  const av=u?u.avatar:'👤', nm=u?u.name:'未登录';
  const r=rankOf(totalXp());
  return '<div class="topbar">'+
    '<div class="logo">🤖 小A</div>'+
    '<div class="spacer"></div>'+
    '<div class="chip">'+r.icon+' '+r.name+'</div>'+
    '<div class="chip" onclick="renderMe()">'+av+' '+esc(nm)+'</div>'+
    '<button class="iconbtn" id="soundBtn" onclick="toggleSound()">'+(soundOn?'🔊':'🔇')+'</button>'+
  '</div>';
}
function topbarLite(){
  return '<div class="topbar"><div class="logo">🤖 小A</div><div class="spacer"></div>'+
    '<button class="iconbtn" id="soundBtn" onclick="toggleSound()">'+(soundOn?'🔊':'🔇')+'</button></div>';
}

/* ---------------- 知情同意（首次进入的门禁） ---------------- */
const CONSENT_KEY='xiaoA_consent_v1';
function hasConsent(){ try{ return localStorage.getItem(CONSENT_KEY)==='1'; }catch(e){ return true; } }
function markConsent(){ try{ localStorage.setItem(CONSENT_KEY,'1'); }catch(e){} }
function consentItem(icon,title,text,cls){
  return '<div class="item'+(cls?' '+cls:'')+'"><span class="ci">'+icon+'</span><div><h3>'+title+'</h3><p>'+text+'</p></div></div>';
}
/* 未点「我已知晓」之前不渲染应用主体，避免内容先于授权被看到 */
function renderConsent(onOk){
  if(document.getElementById('consent')) return;
  const el=document.createElement('div');
  el.id='consent';
  el.innerHTML='<div class="card">'+
    '<div class="brand"><span>🤖 小A · 知识闯关</span></div>'+
    '<h2>使用前请知悉</h2>'+
    '<div class="sub">这是一款给小朋友用的学习工具，请家长陪同阅读</div>'+
    consentItem('🤖','关于内容来源','本应用的讲解、题目与解析均由 <strong>AI 辅助整理生成</strong>，可能存在疏漏或不准确之处。仅供课后练习与兴趣培养，<strong>不作为教学评价或考试依据</strong>；如与教材或老师的讲解不一致，请以教材和老师为准。','key f1')+
    consentItem('⏰','适度使用，不要沉迷','建议每天陪孩子闯 <strong>2~3 关（约 10 分钟）</strong>，单次不超过 20 分钟，到点就停、休息眼睛。闯关是学习工具，不是游戏——<strong>别让它占掉睡觉、运动和玩耍的时间</strong>。','key f2')+
    consentItem('👨‍👩‍👧','请家长陪同使用','低年级孩子识字有限，有人陪着读题、解释，效果会好很多；答错时多鼓励，错题比满分更有价值。')+
    consentItem('🔒','关于你的数据','学习进度只存在这台设备的浏览器里，不上传服务器、不收集任何个人信息。')+
    consentItem('🔊','关于语音朗读','由设备自带的中文语音合成完成，不联网、不发送内容；若听不到声音，请在系统设置里添加中文语音。')+
    '<div class="cbar">'+
      '<button class="ok" id="consentOk">我已知晓，开始使用</button>'+
      '<div class="tiny">点击即表示你已阅读并同意以上说明；如不同意，请直接关闭本页面</div>'+
    '</div>'+
  '</div>';
  document.body.appendChild(el);
  document.getElementById('consentOk').onclick=function(){
    markConsent();
    if(el.parentNode) el.parentNode.removeChild(el);
    if(typeof onOk==='function') onOk();
  };
}

/* ---------------- 初始化 / 引导 ---------------- */
function initApp(){
  loadUsers();
  ttsLoad(); ttsPickVoice(); ttsBindUnlock();
  if(TTS.supported){
    try{ speechSynthesis.onvoiceschanged=function(){ ttsPickVoice(); }; }catch(e){}
    setTimeout(ttsPickVoice,500);          // 部分浏览器语音列表是异步到达的
  }
  // #app 被整体替换 = 页面切换 → 立刻停止朗读，避免读到一半跳页
  if(window.MutationObserver && app){
    new MutationObserver(function(){ if(TTS._speaking){ ttsHalt(); ttsSyncBtns(); } })
      .observe(app,{childList:true});
  }
  document.addEventListener('click', initAudio, {once:true});
  function boot(){
    if(!CUR || !USERS.length){ OB={step:0,name:'',avatar:'🐱',age:'19-40'}; renderOnboard(); }
    else { renderHome(); }
  }
  if(hasConsent()) boot();
  else renderConsent(boot);                // 确认后才放行
}
let OB={step:0,name:'',avatar:'🐱',age:'19-40'};
function renderOnboard(){
  if(OB.step===0){
    app.innerHTML=topbarLite()+'<div class="screen onboard"><div class="ob-hero">🤖<h1>我是小A</h1><p>你的知识游戏化伙伴。<br>先告诉我，怎么称呼你？</p></div>'+
      '<input class="ob-input" id="obName" placeholder="你的名字 / 昵称" maxlength="12" onkeydown="if(event.key===\'Enter\')obNext()">'+
      '<div class="btn primary" onclick="obNext()">下一步</div></div>';
    setTimeout(()=>{const e=document.getElementById('obName'); if(e)e.focus();},50);
  } else if(OB.step===1){
    let av=''; AVATARS.forEach(a=>av+='<div class="av '+(a===OB.avatar?'on':'')+'" onclick="OB.avatar=\''+a+'\';renderOnboard()">'+a+'</div>');
    app.innerHTML=topbarLite()+'<div class="screen onboard"><div class="ob-hero"><h1>挑个头像吧</h1></div><div class="av-grid">'+av+'</div><div class="btn primary" onclick="OB.step=2;renderOnboard()">下一步</div></div>';
  } else {
    let tg='';
    for(const k in AGE_TIERS){ const t=AGE_TIERS[k]; tg+='<div class="tier '+(k===OB.age?'on':'')+'" onclick="OB.age=\''+k+'\';renderOnboard()"><div class="te">'+t.emoji+' '+t.label+'</div><div class="th">'+t.hint+'</div></div>'; }
    app.innerHTML=topbarLite()+'<div class="screen onboard"><div class="ob-hero"><h1>你是哪个年龄段？</h1><p>这会影响字号和讲解节奏</p></div><div class="tier-grid">'+tg+'</div><div class="btn primary" onclick="finishOnboard()">开始闯关 🚀</div></div>';
  }
}
function obNext(){ const e=document.getElementById('obName'); OB.name=(e?e.value:'').trim(); if(!OB.name){ toast('起个名字吧～'); return; } OB.step=1; renderOnboard(); }
function finishOnboard(){
  const u={uid:uid(), name:OB.name, avatar:OB.avatar, age:OB.age};
  USERS.push(u); saveUsers(); CUR=u.uid; ST=defState(); saveState();
  ttsApplyAge(u.age);          // 儿童档自动用更慢的语速，家长不用手动调
  renderHome();
}
function switchUser(id){ CUR=id; localStorage.setItem('xiaoA_cur_v2',id); ST=loadState(id); renderHome(); }

/* ---------------- 首页 ---------------- */
function renderHome(){
  syncTotals(); touchStreak();
  let totalLv=0; for(const id in SCENES) SCENES[id].maps.forEach(x=>totalLv+=x.range[1]-x.range[0]+1);
  let totalQ=0; for(const k in KB) totalQ+=(KB[k].questions||[]).length;
  const realLv=Object.keys(KB).length;
  const u=curUser(); const tier=u?AGE_TIERS[u.age]:null;
  const p=persona(firstSceneId());
  let list='';
  for(const id in SCENES){
    const m=SCENES[id], sd=sget(id);
    const tot=m.maps.reduce((a,x)=>a+x.range[1]-x.range[0]+1,0);
    const fade=fadeCount(id);
    list+='<div class="scene" style="border-left-color:'+m.color+'" onclick="renderScene(\''+id+'\')">'+
      '<div class="emoji">'+m.emoji+'</div>'+
      '<div class="meta"><h3>'+m.name+'</h3><p>'+m.maps.length+'张地图 · '+tot+'关 · 已通关 '+sd.completed.length+'/'+tot+
      (fade>0?' <span class="badge2">'+fade+' 待复习</span>':'')+'</p></div>'+
      '<div class="arrow">›</div></div>';
  }
  const rv=nextReview();
  /* 顶部标签从 SCENES 生成：换学科/年级时不用改代码。
     场景名形如「语文 · 一年级」→ 标签「语文 / 数学 / 英语 · 一年级」 */
  const _sn=Object.keys(SCENES).map(k=>String((SCENES[k]||{}).name||k));
  const _badge=[_sn.map(x=>x.split(' · ')[0]).filter(Boolean).join(' / '),
                String((_sn[0]||'').split(' · ')[1]||'').trim()].filter(Boolean).join(' · ');
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="hero"><div class="badge">'+esc(_badge)+'</div>'+
      '<h1>'+p.emoji+' 嗨，'+esc(u?u.name:'朋友')+'</h1>'+
      '<p class="mood">'+p.mood+'</p>'+
      '<div class="stat">'+
        '<div><b>'+Object.keys(SCENES).length+'</b><span>知识场景</span></div>'+
        '<div><b>'+realLv+'</b><span>可玩关卡</span></div>'+
        '<div><b>'+totalQ+'</b><span>闯关题目</span></div>'+
      '</div></div>'+
    (rv?'<div class="adaptive" onclick="reviewLevel(\''+rv+'\')"><div class="t">🔁 该复习了</div><div class="c">'+esc((KB[rv]&&KB[rv].name)||rv)+' —— 星星快暗了，点我温习一下</div></div>':'')+
    '<div class="sec-title">📚 选择科目</div>'+list+
    '<div class="sec-title">🧭 快捷入口</div>'+
    '<div class="stat-row">'+
      '<div class="stat-card" onclick="renderMe()"><b>'+ST.badges.length+'</b><span>🏆 成就墙</span></div>'+
      '<div class="stat-card" onclick="renderSettings()"><b>'+(activePlugin().online?'在线':'离线')+'</b><span>🤖 智能体</span></div>'+
      '<div class="stat-card" onclick="renderMe()"><b>'+ST.streak.cur+'</b><span>🔥 连续天数</span></div>'+
    '</div>'+
    '<div class="sec-title">🧠 智能体为你推荐</div>'+
    '<div class="stat-row">'+
      '<div class="stat-card" onclick="openDiagPicker()"><b>🩺</b><span>智能诊断</span></div>'+
      '<div class="stat-card" onclick="renderPath()"><b>🧭</b><span>学习路径</span></div>'+
    '</div>'+
    pathChipsHTML()+
    '<div class="foot">共 '+realLv+' 个关卡 · '+totalQ+' 道题目 · '+Object.keys(SCENES).length+' 大知识场景（'+totalLv+' 关完整地图）。<br>每天闯 3 关，坚持一周就能看到进步 🚀</div>'+
    disclaimerHTML()+'</div>';
}
function pathChipsHTML(){
  const path=recommendPath(); if(!path.length) return '';
  let chips=path.map(o=>{ const lv=KB[o.key]; if(!lv) return '';
    const [id,n]=o.key.split(':');
    if(isLocked(id,+n)) return '';          // 未解锁不推荐，避免点进去被拦
    return '<div class="chip2" onclick="openLevel(\''+id+'\','+n+')">'+esc(lv.name)+' <span class="rc">'+o.reason+'</span></div>';
  }).join('');
  if(!chips) return '';
  return '<div class="path-box"><h4>🧭 今天建议先学这些</h4>'+chips+'</div>';
}
function firstSceneId(){ const k=Object.keys(SCENES); return k[0]||'chinese'; }

/* ---------------- 场景：关卡地图 / 生命化星图 ---------------- */
let sceneTab={};
function renderScene(id){
  Sound.tap();
  const m=SCENES[id], sd=sget(id);
  if(!sceneTab[id]) sceneTab[id]='map';
  const tab=sceneTab[id];
  let inner='';
  if(tab==='map'){
    let maps='';
    const tot=m.maps.reduce((a,x)=>a+x.range[1]-x.range[0]+1,0);
    const np=nextPlayable(id);
    m.maps.forEach(mp=>{
      let nodes='';
      for(let n=mp.range[0];n<=mp.range[1];n++){
        const key=id+':'+n, lv=KB[key];
        const st=lvState(id,n);
        let cls='lv';
        if(st==='perfect') cls+=' perfect'; else if(st==='done') cls+=' done';
        else if(st==='locked'||st==='nokb') cls+=' locked';
        const curN=(n===np)?' cur':'';
        const nm=lv?lv.name:('第'+n+'关');
        if(st==='nokb'){
          nodes+='<div class="'+cls+'" onclick="toast(\'该关卡内容持续上线中 ✨\')"><div class="n">🔒</div><div class="t">'+esc(nm)+'</div></div>';
        } else if(st==='locked'){
          nodes+='<div class="'+cls+curN+'" onclick="toast(\'先通过第 '+(n-1)+' 关，就能解锁这一关啦 🔒\')"><div class="n">🔒</div><div class="t">'+esc(nm)+'</div></div>';
        } else {
          nodes+='<div class="'+cls+curN+'" onclick="openLevel(\''+id+'\','+n+')"><div class="n">'+n+'</div><div class="t">'+esc(nm)+'</div></div>';
        }
      }
      maps+='<div class="map-block"><div class="map-name">'+mp.name+'</div><div class="lvgrid">'+nodes+'</div></div>';
    });
    maps='<div class="mapguide">🔓 闯关按顺序解锁 · 已通关 <b>'+sd.completed.length+'</b>/'+tot+
      '　·　'+(sd.completed.length>=tot?'全部通关，太厉害了！':'下一关：第 '+np+' 关')+'</div>'+maps;
    inner='<div class="tabs"><div class="tab on" onclick="sceneTab[\''+id+'\']=\'map\';renderScene(\''+id+'\')">🗺️ 关卡地图</div>'+
      '<div class="tab" onclick="sceneTab[\''+id+'\']=\'star\';renderScene(\''+id+'\')">🌟 生命化星图</div></div>'+maps;
  } else {
    let stars=''; let lvCount=0; m.maps.forEach(x=>lvCount+=x.range[1]-x.range[0]+1);
    for(let n=1;n<=lvCount;n++){
      const s=starLevel(id,n);
      const icon=s>=3?'★':(s>=0.5?'☆':'☆');
      const dim=(s<3&&s>0)?' style="filter:grayscale(.6) opacity(.7)"':(s===0.5?' style="opacity(.4)"':'');
      stars+='<div class="star '+(s>=3?'lit':'')+'"'+dim+' title="'+n+'" onclick="'+(s>0?'reviewLevel(\''+id+':'+n+'\')':'toast(\'先去点亮这颗星吧\')')+'">'+icon+'</div>';
    }
    const r=rankOf(sd.xp), fade=fadeCount(id);
    inner='<div class="tabs"><div class="tab" onclick="sceneTab[\''+id+'\']=\'map\';renderScene(\''+id+'\')">🗺️ 关卡地图</div>'+
      '<div class="tab on" onclick="sceneTab[\''+id+'\']=\'star\';renderScene(\''+id+'\')">🌟 生命化星图</div></div>'+
      '<div class="stat-row">'+
        '<div class="stat-card"><b>'+sd.xp+'</b><span>场景 XP</span></div>'+
        '<div class="stat-card"><b>'+sd.completed.length+'</b><span>已点亮</span></div>'+
        '<div class="stat-card"><b>'+fade+'</b><span>待复习</span></div>'+
      '</div>'+
      '<div class="starwrap"><h3>🌟 段位 '+r.icon+' '+r.name+' · 复习让星星重新璀璨</h3><div class="stars">'+stars+'</div></div>'+
      '<div class="foot">星星会随天数变暗：1 天内璀璨 ★★★ · 3 天内稳定 ★★ · 7 天内微暗 ★ · 超过 7 天熄灭 ☆ 待复习。点击暗星即可温习。</div>';
  }
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderHome()">‹</button>'+
      '<div><div style="font-weight:800;font-size:17px">'+m.emoji+' '+m.name+'</div>'+
      '<div style="font-size:11px;color:var(--sub)">来源：'+esc(m.source||'')+'</div></div></div>'+inner+'</div>';
}
/* 关卡状态：perfect 三星 / done 已通过 / open 可进入 / locked 未解锁 / nokb 内容缺失
   规则：必须按顺序闯关 —— 通过第 N 关，才能解锁第 N+1 关 */
function lvState(id,n){
  if(!KB[id+':'+n]) return 'nokb';
  const sd=sget(id);
  if(sd.perfect.includes(n)) return 'perfect';
  if(sd.completed.includes(n)) return 'done';
  if(n<=1 || sd.completed.includes(n-1)) return 'open';
  return 'locked';
}
function isLocked(id,n){ return lvState(id,n)==='locked'; }
function nextPlayable(id){
  const sd=sget(id);
  for(let n=1;n<=400;n++){ if(KB[id+':'+n] && !sd.completed.includes(n)) return n; }
  for(let n=1;n<=400;n++){ if(KB[id+':'+n]) return n; }
  return 1;
}
function reviewLevel(key){ const [id,n]=key.split(':'); markReviewed(id,+n); openLevel(id,+n,true); }

/* ---------------- 关卡：LEARN → QUIZ → FEEDBACK ---------------- */
let CUR_LV=null, qstate=null;
function openLevel(id,n,isReview){
  Sound.tap();
  const lv=KB[id+':'+n]; if(!lv){ toast('该关卡内容持续上线中 ✨'); return; }
  if(lvState(id,n)==='locked'){ toast('先通过第 '+(n-1)+' 关，就能解锁这一关啦 🔒'); return; }
  TTS.scene = lv.scene || 'zh';   // 让朗读引擎知道当前场景：语文/数学关拼音按拼音读，英语关按英文读
  CUR_LV=lv; qstate={id,n,lv,phase:'learn',answers:[],idx:0,wrong:[]};
  renderLearn();
}
/* 学习页：一句话一张卡，不把整段文字糊在屏幕上。
   原文的 story 本就是按短句写的（中位 17 字），只是被排成了一整段；
   这里把它拆回句子，逐句成卡，配合语音点读。 */
function renderLearn(){
  const {id,n,lv}=qstate;
  const p=persona(id);
  const body=ttsSplit(ttsStripSummary(lv.story||''));
  const sum=((String(lv.story||'').match(/小结[：:]\s*([^。！？]*[。！？]?)/)||[])[1]||'').trim();
  const exs=lv.examples||[];
  const canSay=!!TTS.supported;
  const A=canSay?' onclick="ttsPlayOne(this)"':'';

  let says='';
  body.forEach((s,i)=>{
    says+='<div class="say"'+A+' data-tts-text="'+esca(s)+'">'+
      '<span class="sn">'+(i+1)+'</span><span class="st">'+esc(s)+'</span>'+
      (canSay?'<span class="spk">🔊</span>':'')+'</div>';
  });
  if(sum){
    says+='<div class="say sum"'+A+' data-tts-text="'+esca(sum)+'">'+
      '<span class="sn">✨</span><span class="st">'+esc(sum)+'</span>'+
      (canSay?'<span class="spk">🔊</span>':'')+'</div>';
  }
  const chips=exs.map(e=>'<span class="chip2"'+A+' data-tts-text="'+esca(e)+'">'+esc(e)+
      (canSay?' <b class="rc">🔊</b>':'')+'</span>').join('');

  const isEn=(id==='english');
  let hint='点任意一句话，可以单独听～';
  if(isEn) hint=TTS.enOk?'点任意一句可以单独听～英文用英语音色读，跟着念一遍吧':'这台设备没装英文语音包，英语句子会用中文音色读';
  const ttsBar=canSay?(
    '<div class="ttsbar">'+
      '<button class="ttsbtn main" id="ttsMain" onclick="ttsLearnToggle()">🔊 听小A讲这一关</button>'+
      '<div class="ttshint">'+(TTS.zhOk||TTS.enOk?hint:'这台设备没装语音包，可能读不出来')+'</div>'+
    '</div>'
  ):'';
  /* 英语关卡 + 设备没有英文语音包：光提示"会用中文音色读"没用，
     要给出可以照做的下一步。手机上系统自带英文语音，扫码打开即可。 */
  const voWarn=(canSay&&isEn&&!TTS.enOk)?(
    '<div class="vowarn"><b>⚠️ 这台电脑没装英文语音，英语会念得不准</b>'+
    'Windows：<code>设置 → 时间和语言 → 语音 → 添加语音 → English (United States)</code><br>'+
    'Mac：<code>系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音 → 英语</code>'+
    '<div class="ok">📱 手机上系统自带英文语音 —— 扫码用手机打开，英语发音就是正常的</div></div>'
  ):'';

  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderScene(\''+id+'\')">‹</button>'+
      '<div><div style="font-weight:800;font-size:17px">第 '+n+' 关 · '+esc(lv.name)+'</div>'+
      '<div style="font-size:11px;color:var(--sub)">'+esc(p.name)+' '+p.emoji+' 陪你学</div></div></div>'+
    '<div class="level">'+
      ttsBar+
      voWarn+
      '<div class="keyline"'+A+' data-tts-text="'+esca('记住这一句。'+lv.one)+'">'+
        '<div class="ktag">📌 记住这一句</div><div class="ktext">'+esc(lv.one)+'</div>'+
        (canSay?'<span class="kspk">🔊</span>':'')+
      '</div>'+
      (says?'<div class="says">'+says+'</div>':'')+
      (chips?'<div class="exwrap"><div class="extitle">🎈 生活里找一找</div><div class="examples">'+chips+'</div></div>':'')+
      '<div class="explain-area" id="explainArea"></div>'+
      '<div class="lv-actions">'+
        '<div class="btn ghost" onclick="explainMore()">🔄 换个说法</div>'+
        '<div class="btn primary" onclick="startQuiz()">开始闯关 ▶</div>'+
      '</div>'+
    '</div></div>';
  ttsCollect();
}
function ttsLearnToggle(){
  if(!TTS.supported) return;
  if(TTS._speaking){ ttsHalt(); ttsSyncBtns(); return; }
  if(!TTS.on){ TTS.on=true; ttsSave(); }
  const {lv,n}=qstate;
  ttsPlayPage(['小朋友，我们一起来学第 '+n+' 关，'+lv.name+'。'],
              ['这一关你学会了吗？我们来做三道小题，试试看！']);
}
let EXP_ATT=0;
async function explainMore(){
  EXP_ATT++;
  const area=document.getElementById('explainArea'); if(!area)return;
  area.style.display='block'; area.innerHTML='<div class="explain loading">小A正在换种讲法…</div>';
  const r=await ai('explain',CUR_LV,EXP_ATT-1);
  area.innerHTML='<div class="explain"><span class="tag">'+esc(r.tag)+'</span>'+esc(r.text).replace(/\n/g,'<br>')+'</div>';
}
function startQuiz(){
  EXP_ATT=0; qstate.phase='quiz'; qstate.idx=0; qstate.answers=[]; qstate.wrong=[];
  renderQuestion();
}
function renderQuestion(){
  const {lv,idx}=qstate;
  if(DIAG && DIAG.paper[idx]) CUR_LV=DIAG.paper[idx].lv;
  const q=lv.questions[idx];
  const ci='ABCD'.indexOf(q.correct);
  const canSay=!!TTS.supported;
  let opts='';
  q.opts.forEach((o,i)=>{ opts+='<div class="opt" data-i="'+i+'" onclick="chooseOpt('+i+')"><span class="lab">'+'ABCD'[i]+'</span><span class="txt">'+esc(o)+'</span></div>'; });
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderScene(\''+qstate.id+'\')">‹</button>'+
      '<div><div style="font-weight:800;font-size:15px">第 '+(idx+1)+' / '+lv.questions.length+' 题</div>'+
      '<div style="font-size:11px;color:var(--sub)">'+esc(lv.name)+'</div></div>'+
      (canSay?'<button class="ttsbtn sm gap" onclick="ttsReadQ()">🔊 读题</button>':'')+
    '</div>'+
    '<div class="level"><div class="qcard">'+
      '<div class="qt" data-tts-text="'+esca(q.q)+'">'+esc(q.q)+'</div><div class="opts" id="opts">'+opts+'</div>'+
    '<div id="qfb"></div>'+
    '<div class="lv-actions" id="qact" style="display:none"><div class="btn ghost" onclick="openChat(CUR_LV,'+idx+')">💬 问小A</div><div class="btn primary" id="nextBtn" onclick="nextQ()">下一题 ▶</div></div>'+
    '</div></div></div>';
  // 手机端首次自动朗读必须等音频被用户手势解锁，否则会静默失败
  if(canSay && TTS.on && TTS.autoQ && TTS_UNLOCKED){
    clearTimeout(renderQuestion._t);                 // 渲染后 #app 会被整体替换，等一拍再读
    renderQuestion._t=setTimeout(ttsReadQ,480);
  } else ttsSyncBtns();
}
/* 读题：逐个选项读出来并高亮，不识字的孩子也能自己答题 */
function ttsReadQ(){
  if(!TTS.supported||!TTS.on) return;
  const {lv,idx}=qstate;
  const q=lv.questions[idx];
  if(!q) return;
  const isTF=q.opts.length===2&&q.opts[0]==='对';
  const seq=[{t:'题目是：'+q.q, el:document.querySelector('#app .qt')}];
  if(isTF){
    seq.push({t:'这句话，是对，还是错呢？', el:null});
  }else{
    [].forEach.call(document.querySelectorAll('#app .opts .opt'),(el,i)=>{
      seq.push({t:'第 '+(i+1)+' 个：'+q.opts[i], el:el});
    });
    seq.push({t:'想一想，哪一个才是对的呢？', el:null});
  }
  TTS_HL=seq.map(x=>x.el);
  ttsSpeak(seq,{ onLine:i=>ttsMark(i), onDone:()=>{ ttsMark(-1); ttsSyncBtns(); } });
  ttsSyncBtns();
}
/* 讲解析 */
function ttsReadFb(picked,ci){
  if(!TTS.supported||!TTS.on) return;
  const {lv,idx}=qstate; const q=lv.questions[idx];
  if(!q) return;
  TTS_HL=[];
  ttsSpeak(ttsFeedbackLines(q,picked,ci),{ onLine:()=>{}, onDone:()=>{ ttsMark(-1); ttsSyncBtns(); } });
  ttsSyncBtns();
}
function chooseOpt(i){
  const {lv,idx}=qstate; const q=lv.questions[idx]; const ci='ABCD'.indexOf(q.correct);
  if(qstate.answers[idx]!=null) return;
  Sound.tap();
  qstate.answers[idx]=i;
  const box=document.getElementById('opts');
  box.querySelectorAll('.opt').forEach(el=>{
    const oi=+el.dataset.i;
    el.onclick=null;
    if(oi===ci) el.classList.add('correct');
    else if(oi===i) el.classList.add('wrong');
    else el.classList.add('dim');
  });
  if(i===ci){ Sound.correct(); } else { Sound.wrong(); qstate.wrong.push(idx); }
  const fb=document.getElementById('qfb');
  const ofb=(q.optFb&&q.optFb[i])?q.optFb[i]:'';
  fb.innerHTML='<div class="qfb '+(i===ci?'ok':'no')+'">'+
    (i===ci?'✅ 答对了！':('❌ 正确答案：'+q.correct+'. '+esc(q.opts[ci])))+
    (q.ex?('<div class="ex">'+esc(q.ex)+'</div>'):'')+
    (ofb?('<div class="ofb">'+esc(ofb)+'</div>'):'')+'</div>';
  document.getElementById('qact').style.display='flex';
  if(idx===lv.questions.length-1) document.getElementById('nextBtn').textContent='查看结果 🎉';
  // 没听完题就作答时先掐掉读题，再讲这道题为什么
  ttsHalt(); ttsSyncBtns();
  if(TTS.supported && TTS.on && TTS.autoEx && TTS_UNLOCKED){
    clearTimeout(chooseOpt._t);
    chooseOpt._t=setTimeout(()=>ttsReadFb(i,ci),620);
  }
}
function nextQ(){
  qstate.idx++;
  if(qstate.idx>=qstate.lv.questions.length) renderFeedback();
  else renderQuestion();
}
function renderFeedback(){
  if(qstate.isDiag){ renderDiagFeedback(); return; }
  const {id,n,lv,answers,wrong}=qstate;
  const total=lv.questions.length, correct=total-wrong.length;
  const sd=sget(id);
  const firstTime=!sd.completed.includes(n);
  let gained=0;
  if(firstTime){ sd.completed.push(n); gained+=15; }
  if(wrong.length===0 && !sd.perfect.includes(n)){ sd.perfect.push(n); gained+=20; }
  const sb=streakBonus(); if(sb) gained+=sb;
  sd.xp+=gained;
  if(!qstate.isReview){ if(!sd.reviews) sd.reviews={}; sd.reviews[n]=Date.now(); }
  updateProfile(id,n,correct,total,!firstTime);
  const got=checkBadges();
  syncTotals(); saveState();
  if(firstTime||wrong.length===0) Sound.win(); else Sound.correct();
  if(wrong.length===0) confetti();
  const r=rankOf(sd.xp);
  const p=persona(id);
  let wl='';
  if(wrong.length){
    wl+='<div class="wrong-list"><h4>🤔 这几题再巩固一下</h4>';
    wrong.forEach(wi=>{
      const q=lv.questions[wi];
      wl+='<div class="wq"><div class="wq-q">'+esc(q.q)+'</div>'+
        '<div class="wq-a">正确答案：'+q.correct+'. '+esc(q.opts['ABCD'.indexOf(q.correct)])+'</div>'+
        (q.ex?('<div class="wq-ex">'+esc(q.ex)+'</div>'):'')+
        '<div class="wq-act">'+
          (TTS.supported?('<div class="btn ghost sm" onclick="ttsPlayOne(this)" data-tts-text="'+
            esca('题目是：'+q.q+'。正确答案是'+q.opts['ABCD'.indexOf(q.correct)]+'。'+(q.ex||''))+'">🔊 听一遍</div>'):'')+
          '<div class="btn ghost sm" onclick="openChat(CUR_LV,'+wi+')">💬 问小A为什么</div>'+
        '</div></div>';
    });
    wl+='</div>';
  }
  const nextN=nextPlayableAfter(id,n);
  const justUnlock=(firstTime && nextN && lvState(id,nextN)==='open');
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderScene(\''+id+'\')">‹</button>'+
      '<div><div style="font-weight:800;font-size:15px">第 '+n+' 关 完成</div>'+
      '<div style="font-size:11px;color:var(--sub)">'+esc(lv.name)+'</div></div></div>'+
    '<div class="level result">'+
      '<div class="result-emoji">'+(wrong.length===0?'🎉':'💪')+'</div>'+
      '<div class="result-title">'+esc(p.name)+'：'+(wrong.length===0?'完美通关！这一关你全懂了 👍':('不错！答对 '+correct+' / '+total+'，错的有'+wrong.length+'题，我们再看一眼'))+'</div>'+
      '<div class="xp">+'+(gained)+' XP · '+r.icon+' '+r.name+(sb?' · 🔥连续学习+'+sb:'')+'</div>'+
      (justUnlock?'<div class="unlock-tip">🎉 第 '+nextN+' 关已解锁！</div>':'')+
      (got.length?'<div class="new-badge">🏆 新成就：'+got.map(g=>g.icon+g.name).join('、')+'</div>':'')+
      wl+
      '<div class="lv-actions">'+
        (wrong.length?'<div class="btn ghost" onclick="reviewLevel(\''+id+':'+n+'\')">🔁 再练一次</div>':'')+
        '<div class="btn ghost" onclick="shareAchievement()">📤 分享 +5</div>'+
        (nextN?'<div class="btn primary" onclick="openLevel(\''+id+'\','+nextN+')">下一关 ▶</div>':'<div class="btn primary" onclick="renderScene(\''+id+'\')">返回地图</div>')+
      '</div>'+
    '</div></div>';
  if(got.length) got.forEach((g,i)=>setTimeout(()=>toast('🏆 解锁成就：'+g.name),400+i*400));
  ttsCollect();
  if(TTS.supported && TTS.on && TTS.autoEx && wrong.length===0)
    setTimeout(()=>ttsSay('太棒了，这一关全部答对！'),700);
}
function renderDiagFeedback(){
  const {lv,wrong}=qstate;
  const total=lv.questions.length, correct=total-wrong.length;
  const got=markWeakFromDiag(DIAG.src, wrong);
  syncTotals(); saveState();
  if(wrong.length===0){ Sound.win(); confetti(); }
  let wl='';
  if(wrong.length){
    wl+='<div class="wrong-list"><h4>🤔 这些来源知识需巩固（已加入复习队列）</h4>';
    wrong.forEach(wi=>{
      const it=DIAG.paper[wi], q=lv.questions[wi];
      wl+='<div class="wq"><div class="wq-q">'+esc(q.q)+'</div>'+
        '<div class="wq-a">正确答案：'+q.correct+'. '+esc(q.opts['ABCD'.indexOf(q.correct)])+'</div>'+
        (q.ex?('<div class="wq-ex">'+esc(q.ex)+'</div>'):'')+
        '<div class="btn ghost sm" onclick="openLevel(\''+it.key.split(':')[0]+'\','+it.key.split(':')[1]+')">去「'+esc(it.lv.name)+'」复习 →</div></div>';
    });
    wl+='</div>';
  }
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderHome()">‹</button><div><div style="font-weight:800;font-size:15px">🩺 智能诊断完成</div></div></div>'+
    '<div class="level result">'+
      '<div class="result-emoji">'+(wrong.length===0?'🎉':'💪')+'</div>'+
      '<div class="result-title">'+(wrong.length===0?'太棒了！这份诊断你全对 👍':('答对 '+correct+' / '+total+'，已把错题加入你的复习队列'))+'</div>'+
      (got.length?'<div class="new-badge">🏆 新成就：'+got.map(g=>g.icon+g.name).join('、')+'</div>':'')+
      wl+
      '<div class="lv-actions">'+
        '<div class="btn ghost" onclick="openDiagPicker()">🔄 再来一份诊断</div>'+
        '<div class="btn primary" onclick="renderHome()">返回首页 ▶</div>'+
      '</div>'+
    '</div></div>';
}
let DIAG=null;
function openDiagPicker(){
  let list='';
  for(const id in SCENES){ const m=SCENES[id];
    list+='<div class="scene" style="border-left-color:'+m.color+'" onclick="openDiagnosis(\''+id+'\')"><div class="emoji">'+m.emoji+'</div><div class="meta"><h3>'+m.name+'</h3><p>针对你的薄弱点动态出题</p></div><div class="arrow">›</div></div>';
  }
  openModal('<div class="modal-h">🩺 智能诊断 · 选场景</div><div class="modal-list">'+list+'</div><div class="btn ghost" onclick="closeModal()">取消</div>');
}
function openDiagnosis(id){
  const paper=generatePaper(id,{count:5});
  if(!paper.length){ toast('该场景暂无可出题，先去闯几关吧'); return; }
  closeModal();
  DIAG={id, paper, src:paper.map(it=>it.key)};
  CUR_LV=paper[0].lv;
  const syn={name:'智能诊断 · 教练出题', one:'根据你的薄弱点和遗忘规律动态生成', story:'', examples:[], alt:'', questions: paper.map(it=>it.q)};
  qstate={id,n:0,lv:syn,phase:'learn',answers:[],idx:0,wrong:[],isDiag:true};
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderHome()">‹</button><div><div style="font-weight:800;font-size:17px">🩺 智能诊断</div><div style="font-size:11px;color:var(--sub)">教练按你的薄弱点出的卷</div></div></div>'+
    '<div class="level"><div class="one">💡 这 5 题是根据你的学习画像动态生成的，覆盖「待加强」与「未学」知识点。做完后错题会自动进复习队列。</div>'+
    '<div class="lv-actions"><div class="btn primary" onclick="startQuiz()">开始诊断 ▶</div></div></div></div>';
}
function renderPath(){
  const path=recommendPath(); const p=profile();
  let cards=path.map(o=>{ const [id,n]=o.key.split(':'); const lv=KB[o.key]; if(!lv)return'';
    if(isLocked(id,+n)) return '';
    const col=(SCENES[id]&&SCENES[id].color)||'#ccc';
    return '<div class="scene" style="border-left-color:'+col+'" onclick="openLevel(\''+id+'\','+n+')"><div class="emoji">📍</div><div class="meta"><h3>'+esc(lv.name)+'</h3><p>'+o.reason+'</p></div><div class="arrow">›</div></div>';
  }).join('');
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderHome()">‹</button><div style="font-weight:800">🧭 学习路径</div></div>'+
    '<div class="note">小A 根据你的画像为你推荐：擅长 <b>'+p.strengths.length+'</b> 关 · 待加强 <b>'+p.weaknesses.length+'</b> 关 · 复习队列 <b>'+p.reviewQueue.length+'</b> · 偏好难度 <b>L'+p.preferredDifficulty+'</b></div>'+
    (cards||'<div class="note">先去闯几关，我才能更懂你～</div>')+
    '<div class="btn ghost sm" onclick="openDiagPicker()">🩺 立即做一份智能诊断</div>'+
    '</div>';
}
/* 微信内置浏览器识别：iOS 走 WKWebView、安卓走 X5，
   两者都会屏蔽 navigator.share，网页也无法直接唤起"分享给朋友"
   （要 JS-SDK 签名才行）。所以在微信里只能引导用户点右上角 ···。 */
function isWeChat(){ return /micromessenger/i.test((navigator&&navigator.userAgent)||''); }
async function shareAchievement(){
  const u=curUser(); const r=rankOf(totalXp());
  const text='我在「小A」知识游戏化引擎已通关 '+ST.totals.done+' 关，段位 '+r.icon+r.name+'，复习 '+ST.totals.review+' 次！一起来闯关吧～';
  let copied=false;
  try{
    if(isWeChat()){
      try{ if(navigator.clipboard){ await navigator.clipboard.writeText(text); copied=true; } }catch(e){}
      openModal('<div class="modal-h">📤 分享给好友</div>'
        +'<div class="note" style="margin:4px 20px 10px">微信里请点右上角 <b>···</b> → 发送给朋友</div>'
        +'<div style="margin:0 20px 14px;font-size:13px;line-height:1.7;color:#4a5568;word-break:break-all;background:#f6f5fb;border-radius:12px;padding:12px">'+text+'</div>'
        +'<div class="btn primary" onclick="closeModal()">'+(copied?'文案已复制，去粘贴':'知道了')+'</div>');
    } else if(navigator.share){
      await navigator.share({title:'小A · 我的成就', text});
    } else if(navigator.clipboard){
      await navigator.clipboard.writeText(text);
    }
  }catch(e){ /* 用户取消分享不算失败，不打断奖励流程 */ }
  ST.bonusXp=(ST.bonusXp||0)+5; saveState(); syncTotals();
  if(!isWeChat()) toast('📤 已分享，+5 XP');
  if(typeof renderMe==='function') renderMe();
}
function nextPlayableAfter(id,n){
  const sd=sget(id);
  for(let x=n+1;x<=n+5;x++){ if(KB[id+':'+x] && !sd.completed.includes(x)) return x; }
  for(let x=1;x<=400;x++){ if(KB[id+':'+x] && !sd.completed.includes(x)) return x; }
  return null;
}

/* ---------------- 智能体对话面板 ---------------- */
let CHAT=[], CHAT_LV=null, CHAT_FOCUS=null, CHAT_KEY=null;
function openChat(lv, focusIdx){
  CHAT_LV=lv; CHAT_KEY=Object.keys(KB).find(k=>KB[k]===lv)||null; CHAT_FOCUS=(focusIdx!=null)?lv.questions[focusIdx]:null; CHAT=[];
  let init='';
  if(CHAT_FOCUS) init='<div class="msg ai"><div class="bubble">这道题卡住了？我帮你看看～ 你选错的那个选项为什么不对，我讲给你听。也可以直接问我哦。</div></div>';
  openModal('<div class="chat"><div class="chat-head">💬 问小A · 「'+esc(lv.name)+'」<button class="x" onclick="closeModal()">×</button></div>'+
    '<div class="chat-body" id="chatBody">'+init+'</div>'+
    '<div class="chat-input"><input id="chatInput" placeholder="不懂就问，例如：为什么选'+('ABCD'[lv.questions[0].correct==='A'?1:0])+'？" onkeydown="if(event.key===\'Enter\')chatSend()"><button onclick="chatSend()">发送</button></div></div>');
}
async function chatSend(){
  const inp=document.getElementById('chatInput'); if(!inp)return;
  const v=inp.value.trim(); if(!v)return; inp.value='';
  CHAT.push({me:true,text:v}); renderChat();
  const b=document.getElementById('chatBody');
  const loading=document.createElement('div'); loading.className='msg ai'; loading.innerHTML='<div class="bubble">小A思考中…</div>'; b.appendChild(loading); b.scrollTop=b.scrollHeight;
  const r=await ai('chat',CHAT_LV,v);
  loading.remove();
  const msg={me:false,text:r.text,tag:r.tag};
  if(r.jump){ const [jid,jn]=r.jump.split(':'); const jlv=KB[r.jump]; msg.jump=r.jump; }
  CHAT.push(msg); renderChat();
}
function renderChat(){
  const b=document.getElementById('chatBody'); if(!b)return;
  b.innerHTML=CHAT.map(m=>'<div class="msg '+(m.me?'me':'ai')+'"><div class="bubble">'+esc(m.text).replace(/\n/g,'<br>')+(m.tag?'<div class="tag">'+esc(m.tag)+'</div>':'')+
    (m.jump?'<div class="jump" onclick="openLevel(\''+m.jump.split(':')[0]+'\','+m.jump.split(':')[1]+')">去「'+esc((KB[m.jump]&&KB[m.jump].name)||'相关关卡')+'」那关 →</div>':'')+
    '</div></div>').join('');
  b.scrollTop=b.scrollHeight;
}

/* ---------------- 我的 / 成就墙 ---------------- */
function renderMe(){
  syncTotals();
  const u=curUser(); if(!u){ renderOnboard(); return; }
  const tier=AGE_TIERS[u.age]; const r=rankOf(totalXp());
  let badges='';
  ACHIEVEMENTS.forEach(a=>{ const got=ST.badges.includes(a.id);
    badges+='<div class="badge-card '+(got?'on':'')+'"><div class="bi">'+(got?a.icon:'🔒')+'</div><div class="bn">'+a.name+'</div><div class="bd">'+(got?a.desc:'未解锁')+'</div></div>';
  });
  // 复习队列
  let rq='';
  if(profile().reviewQueue.length){
    rq='<div class="rq"><h4>🔁 待复习队列</h4>';
    profile().reviewQueue.slice(0,6).forEach(k=>{ const lv=KB[k]; if(lv) rq+='<div class="chip2" onclick="reviewLevel(\''+k+'\')">'+esc(lv.name)+'</div>'; });
    rq+='</div>';
  }
  const others=USERS.filter(x=>x.uid!==CUR);
  let sw=others.length?'<div class="sec-title">👥 切换账号</div><div class="av-grid">'+others.map(x=>'<div class="av" onclick="switchUser(\''+x.uid+'\')">'+x.avatar+' '+esc(x.name)+'</div>').join('')+'</div>':'';
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderHome()">‹</button><div style="font-weight:800">我的</div></div>'+
    '<div class="me-card"><div class="me-av">'+u.avatar+'</div><div><div class="me-name">'+esc(u.name)+'</div><div class="me-sub">'+tier.emoji+' '+tier.label+' · 连续学习 '+ST.streak.cur+' 天</div></div>'+
      '<div class="me-rank">'+r.icon+' '+r.name+'</div></div>'+
    '<div class="stat-row">'+
      '<div class="stat-card"><b>'+ST.totals.done+'</b><span>🎯 通关</span></div>'+
      '<div class="stat-card"><b>'+ST.totals.perfect+'</b><span>👑 完美</span></div>'+
      '<div class="stat-card"><b>'+totalXp()+'</b><span>💎 XP</span></div>'+
    '</div>'+
    '<div class="sec-title">📊 我的诊断</div>'+
    '<div class="diag-box">'+
      '<div class="diag-item"><b>'+profile().strengths.length+'</b><span>🌟 擅长关卡</span></div>'+
      '<div class="diag-item"><b>'+profile().weaknesses.length+'</b><span>💡 待加强</span></div>'+
      '<div class="diag-item"><b>'+profile().reviewQueue.length+'</b><span>🔁 复习队列</span></div>'+
      '<div class="diag-item"><b>L'+profile().preferredDifficulty+'</b><span>🎚️ 偏好难度</span></div>'+
    '</div>'+
    '<div class="lv-actions" style="margin:6px 0 4px"><div class="btn primary" onclick="renderPath()">🧭 看学习路径</div><div class="btn ghost" onclick="openDiagPicker()">🩺 做智能诊断</div></div>'+
    '<div class="btn ghost sm" style="margin-bottom:10px" onclick="shareAchievement()">📤 分享成就 +5 XP</div>'+
    rq+
    '<div class="sec-title">🏆 成就墙（'+ST.badges.length+'/'+ACHIEVEMENTS.length+'）</div><div class="badge-grid">'+badges+'</div>'+
    '<div class="sec-title">⚙️ 设置</div><div class="scene" onclick="renderSettings()"><div class="emoji">🤖</div><div class="meta"><h3>智能体与偏好</h3><p>'+(activePlugin().online?'在线大模型已接入':'当前为离线智能体')+'</p></div><div class="arrow">›</div></div>'+
    sw+
    '<div class="btn ghost sm" style="margin-top:12px" onclick="renderOnboard2()">＋ 添加新账号</div>'+
    disclaimerHTML()+'</div>';
}
function renderOnboard2(){ OB={step:0,name:'',avatar:'🐱',age:'19-40'}; renderOnboard(); }

/* ---------------- 设置：智能体 / 偏好 ---------------- */
function renderSettings(){
  const u=curUser();
  const prov=AIConfig.provider;
  const online=AIConfig.provider!=='pregen' && AIConfig.provider!=='';
  const tiers=Object.keys(AGE_TIERS).map(k=>{ const t=AGE_TIERS[k]; return '<div class="tier '+(u&&u.age===k?'on':'')+'" onclick="setAge(\''+k+'\')"><div class="te">'+t.emoji+' '+t.label+'</div><div class="th">'+t.hint+'</div></div>'; }).join('');
  app.innerHTML=topbar()+'<div class="screen">'+
    '<div class="play-head"><button class="back" onclick="renderHome()">‹</button><div style="font-weight:800">设置</div></div>'+
    '<div class="sec-title">🤖 智能体模式</div>'+
    '<div class="set-card">'+
      '<label class="rad '+(prov==='pregen'?'on':'')+'"><input type="radio" name="prov" value="pregen" '+(prov==='pregen'?'checked':'')+' onclick="setProv(\'pregen\')"> 离线智能体（预生成）· 零延迟零风险</label>'+
      '<label class="rad '+(prov==='llm'?'on':'')+'"><input type="radio" name="prov" value="llm" '+(prov==='llm'?'checked':'')+' onclick="setProv(\'llm\')"> 在线大模型（OpenAI 兼容接口）· 真对话</label>'+
      '<label class="rad '+(prov==='coze'?'on':'')+'"><input type="radio" name="prov" value="coze" '+(prov==='coze'?'checked':'')+' onclick="setProv(\'coze\')"> 扣子 Coze · 工作流编排</label>'+
      '<div id="aiForm" style="'+(online?'':'display:none')+'">'+
        '<div class="fld"><span>接口地址</span><input id="aiUrl" placeholder="https://api.your-provider.com/v1/chat/completions" value="'+esc(AIConfig.baseUrl)+'"></div>'+
        '<div class="fld"><span>API Key</span><input id="aiKey" type="password" placeholder="sk-...（仅在本地浏览器使用，勿公开分享）" value="'+esc(AIConfig.key)+'"></div>'+
        '<div class="fld"><span>模型名</span><input id="aiModel" placeholder="model-name" value="'+esc(AIConfig.model)+'"></div>'+
        '<div class="btn primary" onclick="saveAI()">保存并启用</div>'+
        '<div class="note">⚠️ 浏览器直连会暴露 Key，仅适合演示/自用。正式部署建议加一层服务端代理。</div>'+
      '</div>'+
    '</div>'+
    '<div class="sec-title">👤 年龄段偏好</div><div class="tier-grid">'+tiers+'</div>'+
    '<div class="sec-title">🔊 音效</div><div class="set-card"><label class="rad '+(soundOn?'on':'')+'" onclick="toggleSound();renderSettings()"><input type="checkbox" '+(soundOn?'checked':'')+'> 开启音效</label></div>'+
    ttsSettingsHTML()+
    '<div class="sec-title">🗑️ 数据安全</div><div class="btn ghost sm" onclick="resetAll()">清空我的全部进度</div>'+
    '<div class="foot">智能体三实现（预生成 / 在线大模型 / 扣子）共用同一 AIPlugin 接口，任一步失败 2 秒内自动降级到离线兜底，永不白屏。</div>'+
    '</div>';
}
function setProv(p){ AIConfig.provider=p; saveAIConfig(); renderSettings(); }

/* ---------------- 语音设置 ---------------- */
const TTS_RATES=[
  {r:0.7,e:'🐢',l:'很慢',h:'一个字一个字，刚学认字的孩子'},
  {r:0.8,e:'🐰',l:'慢速 · 推荐',h:'读完一句停一停，孩子跟得上'},
  {r:1.0,e:'🐦',l:'正常',h:'接近平时说话的速度'}
];
const TTS_EN_RATES=[
  {r:0.6,e:'🐢',l:'很慢',h:'一个词一个词，刚接触英语的孩子'},
  {r:0.72,e:'🐰',l:'慢速 · 英语推荐',h:'跟着念得清楚，不会含糊带过'},
  {r:0.88,e:'🐦',l:'正常',h:'接近课本录音的速度'}
];
function ttsSettingsHTML(){
  if(!TTS.supported){
    return '<div class="sec-title">🔊 语音朗读</div><div class="set-card"><div class="sub-note">当前浏览器不支持语音朗读。</div></div>';
  }
  const rates=TTS_RATES.map(x=>'<div class="tier '+(Math.abs(TTS.rate-x.r)<0.02?'on':'')+'" onclick="setTTSRate('+x.r+')"><div class="te">'+x.e+' '+x.l+'</div><div class="th">'+x.h+'</div></div>').join('');
  const hasEn=(typeof SCENES!=='undefined')&&!!SCENES.english;
  const enRates=hasEn?TTS_EN_RATES.map(x=>'<div class="tier '+(Math.abs(TTS.enRate-x.r)<0.02?'on':'')+'" onclick="setTTSEnRate('+x.r+')"><div class="te">'+x.e+' '+x.l+'</div><div class="th">'+x.h+'</div></div>').join(''):'';
  const enBlock=hasEn?(
    '<div class="sub-title">英语朗读速度</div>'+enRates+
    (TTS.enOk?'':'<div class="sub-note warn">这台设备没检测到英文语音包，英语句子会退回中文音色，发音可能不准。可在系统「设置 → 时间和语言 → 语音」里添加 English 语音后再试。</div>')
  ):'';
  return '<div class="sec-title">🔊 语音朗读</div><div class="set-card">'+
    '<label class="rad '+(TTS.on?'on':'')+'" onclick="toggleTTS(\'on\');renderSettings()"><input type="checkbox" '+(TTS.on?'checked':'')+'> 开启语音朗读（小A读题、讲解析）</label>'+
    '<label class="rad '+(TTS.autoQ?'on':'')+'" onclick="toggleTTS(\'autoQ\');renderSettings()"><input type="checkbox" '+(TTS.autoQ?'checked':'')+'> 进入题目时自动读题</label>'+
    '<label class="rad '+(TTS.autoEx?'on':'')+'" onclick="toggleTTS(\'autoEx\');renderSettings()"><input type="checkbox" '+(TTS.autoEx?'checked':'')+'> 答完自动讲「为什么」</label>'+
    '<div class="sub-title">中文朗读速度</div>'+rates+
    enBlock+
    '<div class="tts-try"><button class="ttsbtn" onclick="ttsTry()">🔊 试听一下</button>'+
    (hasEn?'<button class="ttsbtn" onclick="ttsTryEn()">🔤 试听英语</button>':'')+'</div>'+
    (TTS.zhOk?'':'<div class="sub-note warn">这台设备没检测到中文语音包。可在系统「设置 → 时间和语言 → 语音」里添加中文语音后再试。</div>')+
  '</div>';
}
function toggleTTS(k){ TTS[k]=!TTS[k]; if(k==='on'&&!TTS.on) ttsHalt(); ttsSave(); toast(TTS[k]?'已开启':'已关闭'); }
function setTTSRate(r){ TTS.rate=r; ttsSave(); toast('中文朗读速度已调整'); }
function setTTSEnRate(r){ TTS.enRate=r; ttsSave(); toast('英语朗读速度已调整'); }
function ttsTry(){ TTS.on=true; ttsSave(); ttsSay('小朋友你好呀，我是小A，我们一起来闯关吧！'); }
function ttsTryEn(){ TTS.on=true; ttsSave(); ttsSay('Hello! I have a new bag. 你好！我有一个新书包。'); }

function saveAI(){
  AIConfig.baseUrl=document.getElementById('aiUrl').value.trim();
  AIConfig.key=document.getElementById('aiKey').value.trim();
  AIConfig.model=document.getElementById('aiModel').value.trim()||'model-name';
  saveAIConfig();
  toast(activePlugin().ready()?'✅ 已启用在线智能体':'⚠️ 缺少 Key，仍走离线模式');
  renderSettings();
}
function setAge(k){ const u=curUser(); if(u){ u.age=k; saveUsers(); } ttsApplyAge(k); toast('已更新年龄段'); renderSettings(); }
/* 年龄段 → 朗读语速/音调：越小越慢，越像老师讲故事 */
function ttsApplyAge(age){
  const m={'6-12':[0.7,1.12],'13-18':[0.78,1.08],'19-40':[0.85,1.05],'40+':[0.78,1.02]};
  const v=m[age]; if(!v) return;
  TTS.rate=v[0]; TTS.pitch=v[1]; ttsSave();
}
/* ⚠️ 这里**不能**用原生 confirm 弹窗：iOS 微信的 WKWebView 会静默屏蔽它
   （不报错、直接返回 false），结果就是用户点「清空进度」后什么都没发生，
   而且没有任何提示。改为应用内两步确认弹层。 */
function resetAll(){
  openModal('<div class="modal-h">⚠️ 清空进度</div>'
    +'<div class="note" style="margin:4px 20px 16px">确定清空当前账号的全部进度？此操作不可恢复。</div>'
    +'<div class="btn danger" onclick="resetAllConfirmed()">确定清空</div>'
    +'<div class="btn ghost" style="margin-top:8px" onclick="closeModal()">取消</div>');
}
function resetAllConfirmed(){
  closeModal();
  const id=CUR; USERS=USERS.filter(u=>u.uid!==id); saveUsers();
  localStorage.removeItem('xiaoA_st_'+id);
  CUR=null; ST=null; loadUsers();
  if(!CUR||!USERS.length){ OB={step:0,name:'',avatar:'🐱',age:'19-40'}; renderOnboard(); } else renderHome();
}
