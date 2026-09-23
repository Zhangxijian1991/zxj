/* ============================================================
   「小A」知识游戏化引擎 · v2
   Layer1 交互 / Layer2 游戏化引擎 / Layer3 智能决策(可插拔AI)
   Layer4 知识库(可替换) / Layer5 存储 / Layer6 会话与日志
   ============================================================ */

/* ---------------- 常量 ---------------- */
const AGE_TIERS = {
  '6-12':  {label:'6-12岁 · 儿童', emoji:'🧒', greet:'嗨！我是小A，我们一起去闯关吧！', font:1.05, hint:'大字大按钮，慢慢来'},
  '13-18': {label:'13-18岁 · 少年', emoji:'🧑', greet:'准备好了吗？今天冲几个段位？', font:1.0, hint:'挑战模式，段位与成就优先'},
  '19-40': {label:'19-40岁 · 成人', emoji:'🙂', greet:'欢迎回来，我们继续。', font:1.0, hint:'效率导向，进度可追踪'},
  '40+':   {label:'40岁以上 · 长辈', emoji:'🧓', greet:'您好，我是小A，我慢慢讲给您听。', font:1.12, hint:'字号放大，节奏放缓'}
};
const AVATARS = ['🐱','🐶','🐼','🦊','🐯','🦁','🐸','🐵','🐨','🐰','🦄','🐲'];
const ACHIEVEMENTS = [
  {id:'first',    name:'初次点亮',   icon:'🌟', desc:'通关第 1 关',           check:s=>s.totals.done>=1},
  {id:'ten',      name:'小有所成',   icon:'🔟', desc:'累计通关 10 关',        check:s=>s.totals.done>=10},
  {id:'fifty',    name:'知识猎手',   icon:'🎯', desc:'累计通关 50 关',        check:s=>s.totals.done>=50},
  {id:'perfect',  name:'完美主义',   icon:'👑', desc:'拿到 5 次完美通关',     check:s=>s.totals.perfect>=5},
  {id:'allscene', name:'跨界学者',   icon:'🌈', desc:'在 3 个不同场景通关',   check:s=>Object.values(s.scenes).filter(x=>x.completed.length>0).length>=3},
  {id:'reviewer', name:'温故知新',   icon:'🔁', desc:'完成 5 次复习',         check:s=>s.totals.review>=5},
  {id:'streak3',  name:'三日不断',   icon:'🔥', desc:'连续学习 3 天',         check:s=>s.streak.max>=3},
  {id:'xp1000',   name:'千分强者',   icon:'💎', desc:'累计获得 1000 XP',      check:s=>s.totals.xp>=1000}
];
const DAY = 86400000;

/* ---------------- 存储层：多用户档案 ---------------- */
const K_USERS = 'xiaoA_users_v2', K_CUR = 'xiaoA_cur_v2', K_AI = 'xiaoA_ai_v2';
let USERS = [], CUR = null, ST = null;

function uid(){ return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function loadUsers(){
  try{ USERS = JSON.parse(localStorage.getItem(K_USERS)) || []; }catch(e){ USERS = []; }
  CUR = localStorage.getItem(K_CUR);
  if(!USERS.find(u=>u.uid===CUR)) CUR = USERS[0] ? USERS[0].uid : null;
  if(CUR) ST = loadState(CUR);
}
function saveUsers(){ localStorage.setItem(K_USERS, JSON.stringify(USERS)); }
function defState(){
  return {scenes:{}, totals:{done:0,perfect:0,review:0,xp:0}, streak:{cur:0,max:0,last:0}, bonusXp:0,
          badges:[], traj:[], profile:{strengths:[],weaknesses:[],reviewQueue:[],consecCorrect:0,consecWrong:0,totalCorrect:0,totalWrong:0,preferredDifficulty:3}};
}
function loadState(u){
  let s = null;
  try{ s = JSON.parse(localStorage.getItem('xiaoA_st_'+u)); }catch(e){}
  if(!s){ // 迁移旧版单用户数据
    try{ const old = JSON.parse(localStorage.getItem('xiaoA_demo_v1'));
      if(old && old.scenes){ s = defState(); s.scenes = old.scenes; } }catch(e){}
  }
  return s || defState();
}
function saveState(){ if(CUR) localStorage.setItem('xiaoA_st_'+CUR, JSON.stringify(ST)); }
function sget(sceneId){
  if(!ST.scenes[sceneId]) ST.scenes[sceneId] = {completed:[],perfect:[],xp:0,lives:5,reviews:{}};
  return ST.scenes[sceneId];
}
function curUser(){ return USERS.find(u=>u.uid===CUR) || null; }

/* ---------------- AI 插件层（可插拔 + 自动降级） ---------------- */
const AIConfig = (()=>{ try{ return JSON.parse(localStorage.getItem(K_AI)) || {}; }catch(e){ return {}; } })();
Object.assign(AIConfig, {provider:AIConfig.provider||'pregen', baseUrl:AIConfig.baseUrl||'', key:AIConfig.key||'', model:AIConfig.model||'model-name'});
function saveAIConfig(){ localStorage.setItem(K_AI, JSON.stringify(AIConfig)); }

/* ---------------- 离线 RAG 知识检索（防幻觉 / 来源可验证） ----------------
   对 411 关的 name/one/story/examples/题目/解析 做字符 bigram 倒排索引，
   问答时跨关检索最相关知识点并引用来源，兑现技术方案书"来源权威可验证"。 */
const RAG = {
  ready:false, inv:{}, sentenceMap:{}, tokenize:null,
  _tok(s){
    s=(s||'').toLowerCase();
    const toks=new Set();
    const cn=s.replace(/[^\u4e00-\u9fa5]/g,'');
    for(let i=0;i<cn.length-1;i++) toks.add(cn.slice(i,i+2));
    const en=(s.match(/[a-z0-9]{2,}/g)||[]);
    en.forEach(w=>toks.add(w));
    return toks;
  },
  build(){
    if(this.ready) return;
    const inv={}, sentenceMap={};
    for(const key in KB){
      const lv=KB[key];
      const parts=[lv.name,lv.one,lv.story,(lv.examples||[]).join(' '),lv.alt];
      (lv.questions||[]).forEach(q=>{ parts.push(q.q); parts.push((q.opts||[]).join(' ')); parts.push(q.ex||''); });
      const full=parts.filter(Boolean).join(' ');
      this._tok(full).forEach(t=>{ (inv[t]=inv[t]||[]).push(key); });
      const sents=(lv.story||lv.one||'').split(/[。！？!?；;]/).map(x=>x.trim()).filter(x=>x.length>4);
      sentenceMap[key]=sents.length?sents:[lv.one||lv.story||''];
    }
    this.inv=inv; this.sentenceMap=sentenceMap; this.ready=true;
  },
  retrieve(query, k=4, exclude=null){
    this.build();
    const q=this._tok(query); const score={};
    q.forEach(t=>{ (this.inv[t]||[]).forEach(key=>{ if(key!==exclude) score[key]=(score[key]||0)+1; }); });
    return Object.entries(score).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([key,s])=>({key,score:s,lv:KB[key]}));
  },
  bestSentence(query, key){
    const sents=this.sentenceMap[key]; if(!sents||!sents.length) return KB[key]?(KB[key].one||KB[key].story||''):'';
    const q=this._tok(query); let best='',bs=0;
    sents.forEach(s=>{ const sc=[...this._tok(s)].filter(t=>q.has(t)).length; if(sc>bs){bs=sc;best=s;} });
    return best||sents[0];
  }
};

const PregenPlugin = {
  id:'pregen', label:'离线智能体 · 预生成', online:false,
  ready(){ return true; },
  async explain(lv, attempt){
    if(attempt===0) return {text: lv.alt || lv.one, tag:'换个说法'};
    if(attempt===1) return {text: this._split(lv), tag:'拆开来讲'};
    return {text: this._fromQuiz(lv), tag:'从题目反推'};
  },
  _split(lv){
    const sents = (lv.story||'').split(/[。！？]/).filter(x=>x.trim().length>6);
    if(sents.length<2) return lv.one;
    return '我们把它拆成几句：\n① ' + sents[0].trim() + '。\n② ' + sents.slice(1).join('。').trim() + '。\n所以重点是——' + lv.one;
  },
  _fromQuiz(lv){
    const q = (lv.questions||[])[0]; if(!q) return lv.one;
    const ci = 'ABCD'.indexOf(q.correct);
    return '看这道题你就明白了：\n「' + q.q + '」\n答案是 ' + q.correct + '. ' + q.opts[ci] + (q.ex ? '\n' + q.ex : '');
  },
  async whyWrong(lv, q, chosen){
    return (q.optFb && q.optFb[chosen]) ? q.optFb[chosen]
         : ('再看看：正确答案是 ' + q.correct + '。' + (q.ex||''));
  },
  async chat(lv, msg){
    const m = (msg||'').trim();
    const curKey = (typeof CHAT_KEY!=='undefined' && CHAT_KEY) || null;
    if(/^(hi|hello|你好|在吗)/i.test(m)) return '我在呢！这一关讲的是「' + lv.name + '」，哪儿不明白尽管问我～';
    // 聚焦于某道题时，"为什么选错/不对"走逐选项反馈，比随机故事句更准
    if(CHAT_FOCUS && /为什么|原因|不对|选错|搞错|怎么会/.test(m)){
      const ci='ABCD'.indexOf(CHAT_FOCUS.correct);
      const pick=(ci+1)%4;
      const r=await ai('whyWrong', lv, CHAT_FOCUS, pick);
      return (typeof r==='string'?r:r.text);
    }
    // 跨关检索：先在全知识库里找最相关知识点（来源可验证）
    const hits = RAG.retrieve(m, 4, curKey);
    if(/为什么|咋|怎么回|原因|怎么会/.test(m) && curKey){
      const sent = RAG.bestSentence(m, curKey);
      if(sent) return '好问题——' + sent + (lv.ex ? '\n（' + lv.ex + '）' : '');
    }
    if(/例子|举例|比如|生活|用在哪/.test(m)) return '生活里就有：' + (lv.examples||[]).join('、') + '。这些背后都是「' + lv.name + '」。';
    if(/不懂|不会|还是|再讲|换个|听不明/.test(m)) return lv.alt || lv.one;
    if(/答案|选哪个|怎么做|哪一对/.test(m)) return this._fromQuiz(lv);
    if(/是什么|什么意思|啥意思|定义/.test(m)) return lv.one + (lv.examples&&lv.examples.length ? '\n比如：' + lv.examples[0] + '。' : '');
    // 命中其它关卡 → 直接调出该知识点，并可一键跳转
    if(hits.length && hits[0].key!==curKey && hits[0].score>=2){
      const h = hits[0];
      const sent = RAG.bestSentence(m, h.key);
      return {text: '这个在「' + h.lv.name + '」里也讲过，我帮你调出来：\n' + (sent || h.lv.one), jump: h.key};
    }
    // 命中本关素材
    const pool = [lv.one, ...(lv.story||'').split(/[。！？]/).filter(x=>x.trim().length>8), ...(lv.examples||[])];
    const kws = m.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g,'').slice(0,10);
    let best=null, bs=0;
    for(const p of pool){ if(!p) continue; const sc=[...kws].filter(c=>p.includes(c)).length; if(sc>bs){bs=sc;best=p;} }
    if(best && bs>=2) return best.trim() + '。\n（我基于知识库内容回答，想聊得更深可在设置里接入大模型）';
    // 终极兜底：引用最相关关卡
    if(hits.length){ const h=hits[0]; return '我找到相关知识：「' + h.lv.name + '」——' + (h.lv.one||'') + '\n（离线模式仅能基于已撰写内容回答）'; }
    return lv.one + '\n（我只能基于本关内容回答，想聊得更深可在设置里接入大模型）';
  }
};

const LLMPlugin = {
  id:'llm', label:'在线大模型', online:true,
  ready(){ return !!(AIConfig.key && AIConfig.baseUrl); },
  async _call(messages){
    const r = await fetch(AIConfig.baseUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+AIConfig.key},
      body: JSON.stringify({model:AIConfig.model, messages, temperature:0.7, max_tokens:500, stream:false})
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '（无返回）';
  },
  _sys(lv){
    return '你是「小A」，一个温柔耐心的知识讲解伙伴。规则：1) 只讲大白话，不用术语；2) 每次必给一个生活里的例子；3) 严格基于下面提供的知识点内容回答，不得编造；4) 回答控制在120字以内，语气亲切。\n\n【本关知识点】' + lv.name + '\n【一句话解释】' + lv.one + '\n【讲解】' + (lv.story||'') + '\n【生活案例】' + (lv.examples||[]).join('、');
  },
  async explain(lv, attempt){
    const t = ['请换一个全新的生活类比重新解释这个概念，不要重复已有说法。',
               '请把这个概念拆成3个极短的步骤来讲，每步不超过15字。',
               '请用一个具体的场景故事来讲这个概念，像讲给完全不懂的人听。'][Math.min(attempt,2)];
    return {text: await this._call([{role:'system',content:this._sys(lv)},{role:'user',content:t}]), tag:'小A换种讲法'};
  },
  async whyWrong(lv, q, chosen){
    const t = '题目：「'+q.q+'」 选项：'+q.opts.map((o,i)=>'ABCD'[i]+'.'+o).join(' / ')+' 正确答案：'+q.correct+'。用户选了 '+'ABCD'[chosen]+'.'+q.opts[chosen]+'。请用大白话解释为什么用户选的那个不对，再说清正确答案为什么对，80字以内。';
    return await this._call([{role:'system',content:this._sys(lv)},{role:'user',content:t}]);
  },
  async chat(lv, msg){
    return await this._call([{role:'system',content:this._sys(lv)},{role:'user',content:msg}]);
  }
};

const CozePlugin = {
  id:'coze', label:'扣子 Coze', online:true,
  ready(){ return !!(AIConfig.key && AIConfig.baseUrl); },
  async _call(msg, lv){
    const r = await fetch(AIConfig.baseUrl, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+AIConfig.key},
      body: JSON.stringify({bot_id:AIConfig.model, user_id:(CUR||'anon'), stream:false,
        additional_messages:[{role:'user', content: (lv ? '【知识点】'+lv.name+'｜'+lv.one+'｜'+(lv.story||'')+'\n\n' : '') + msg, content_type:'text'}]})
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j = await r.json();
    const msgs = j.messages || [];
    const ans = msgs.filter(m=>m.type==='answer');
    return (ans.length ? ans[ans.length-1].content : (msgs[0]&&msgs[0].content)) || '（无返回）';
  },
  async explain(lv, attempt){ return {text: await this._call('请换一个全新的生活类比重新解释这个概念。', lv), tag:'小A换种讲法'}; },
  async whyWrong(lv, q, chosen){ return await this._call('用户这道题选错了，请解释为什么。', lv); },
  async chat(lv, msg){ return await this._call(msg, lv); }
};

const PLUGINS = {pregen:PregenPlugin, llm:LLMPlugin, coze:CozePlugin};
function activePlugin(){ return PLUGINS[AIConfig.provider] || PregenPlugin; }
let _aiFallbacks = 0;
async function ai(kind, ...args){
  const order = AIConfig.provider==='pregen' ? [PregenPlugin]
              : [activePlugin(), PregenPlugin];
  for(const p of order){
    if(!p.ready() || !p[kind]) continue;
    try{
      const r = await Promise.race([p[kind](...args), new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),8000))]);
      return {text: (typeof r==='string'? r : r.text), tag:(r&&r.tag)||p.label, by:p.id, jump:(r&&r.jump)||null};
    }catch(e){ _aiFallbacks++; console.warn('[AI]'+p.id+' 失败，降级', e.message); }
  }
  return {text:'（暂时无法生成讲解，先看看下面的内容）', tag:'离线兜底', by:'none'};
}

/* ---------------- 学习者画像 ---------------- */
function profile(){ return ST.profile; }
function updateProfile(sceneId, levelId, correctCount, total, alreadyDone){
  const p = profile();
  const key = sceneId + ':' + levelId;
  if(correctCount === total){
    p.consecCorrect++; p.consecWrong = 0; p.totalCorrect += correctCount;
    if(p.consecCorrect >= 3 && !p.strengths.includes(key)) p.strengths.push(key);
    const i = p.weaknesses.indexOf(key); if(i>=0) p.weaknesses.splice(i,1);
  } else {
    p.consecWrong++; p.consecCorrect = 0; p.totalWrong += (total - correctCount);
    p.preferredDifficulty = Math.max(1, p.preferredDifficulty - 1);
    // 已学过的关重做仍错 → 进复习队列；首次学习靠星图自然衰减提醒，不进队列
    if(alreadyDone){
      if(!p.weaknesses.includes(key)) p.weaknesses.push(key);
      if(!p.reviewQueue.includes(key)) p.reviewQueue.push(key);
    }
  }
  if(p.consecCorrect >= 5) p.preferredDifficulty = Math.min(5, p.preferredDifficulty + 1);
  saveState();
}
function nextReview(){
  const p = profile();
  return p.reviewQueue.length ? p.reviewQueue[0] : null;
}

/* ---------------- L3 自治智能体：动态出卷 / 学习路径 ---------------- */
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function generatePaper(sceneId, opts){
  opts=opts||{};
  const count=opts.count||5;
  const sd=sget(sceneId); const p=profile(); const items=[];
  // 关卡顺序解锁：先算出"已解锁上限"，超纲题一律不出
  let limit=1;
  for(let n=1;n<=300;n++){ if(KB[sceneId+':'+n] && !sd.completed.includes(n)){ limit=n; break; } }
  const okN = k => { const n=+(k.split(':')[1]||0); return n>=1 && (n<=limit || sd.completed.includes(n)); };
  // 1) 优先从薄弱项 + 复习队列出题（同一场景，且已解锁）
  const weak=[...new Set([...p.weaknesses, ...p.reviewQueue])]
    .filter(k=>k.indexOf(sceneId+':')===0 && KB[k] && okN(k));
  weak.forEach(k=>{ const lv=KB[k]; if(lv) (lv.questions||[]).forEach(q=>items.push({key:k,lv,q})); });
  // 2) 补充未学关卡的前置题，保证有"新内容"
  for(let n=1;n<=limit && items.length<count*3;n++){
    const k=sceneId+':'+n, lv=KB[k]; if(!lv) continue;
    if(!sd.completed.includes(n)) (lv.questions||[]).forEach(q=>items.push({key:k,lv,q}));
  }
  shuffle(items);
  return items.slice(0,count);
}
function recommendPath(){
  const p=profile(); const out=[]; const seen=new Set();
  // 先推薄弱 / 待复习
  [...new Set([...p.weaknesses, ...p.reviewQueue])].slice(0,3).forEach(k=>{ if(KB[k] && !seen.has(k)){ seen.add(k); out.push({key:k, reason:'待加强'}); } });
  // 再推各场景的下一未学关
  for(const id in SCENES){
    const sd=sget(id);
    for(let n=1;n<=300;n++){ const k=id+':'+n; if(KB[k] && !sd.completed.includes(n) && !seen.has(k)){ seen.add(k); out.push({key:k, reason:'新关卡'}); break; } }
  }
  return out.slice(0,4);
}
function markWeakFromDiag(srcKeys, wrongIdxs){
  const p=profile();
  wrongIdxs.forEach(wi=>{
    const k=srcKeys[wi]; if(!k) return;
    if(!p.weaknesses.includes(k)) p.weaknesses.push(k);
    if(!p.reviewQueue.includes(k)) p.reviewQueue.push(k);
  });
  const got=checkBadges(); if(got.length) saveState();
  return got;
}
function streakBonus(){ return ST.streak.cur>=3 ? 20 : 0; }

/* ---------------- 生命化星图：遗忘衰减 ---------------- */
function starLevel(sceneId, n){
  const sd = sget(sceneId);
  if(!sd.completed.includes(n)) return 0;      // 未点亮
  const last = (sd.reviews && sd.reviews[n]) || 0;
  const d = (Date.now() - last) / DAY;
  if(d <= 1) return 3;      // 璀璨
  if(d <= 3) return 2;      // 稳定
  if(d <= 7) return 1;      // 变暗
  return 0.5;               // 熄灭待复习
}
function markReviewed(sceneId, n){
  const sd = sget(sceneId);
  if(!sd.reviews) sd.reviews = {};
  sd.reviews[n] = Date.now();
  ST.totals.review++;
  const k = sceneId+':'+n, p = profile();
  const i = p.reviewQueue.indexOf(k); if(i>=0) p.reviewQueue.splice(i,1);
  saveState();
}
function fadeCount(sceneId){
  const sd = sget(sceneId); let c=0;
  for(const n of sd.completed) if(starLevel(sceneId,n) < 3) c++;
  return c;
}

/* ---------------- 连续学习 ---------------- */
function touchStreak(){
  const s = ST.streak, today = new Date().setHours(0,0,0,0);
  if(s.last === today) return;
  if(today - s.last <= DAY) s.cur++; else s.cur = 1;
  s.last = today; s.max = Math.max(s.max, s.cur);
  saveState();
}
function checkBadges(){
  const got = [];
  for(const a of ACHIEVEMENTS){
    if(!ST.badges.includes(a.id) && a.check(ST)){ ST.badges.push(a.id); got.push(a); }
  }
  if(got.length) saveState();
  return got;
}
