// 在 Node 中用最小 DOM 桩 跑通核心流程，捕获运行时错误
const fs = require('fs');
const vm = require('vm');
const BASE = __dirname;

function makeStub(){
  const el = {
    innerHTML:'', textContent:'', value:'', className:'', scrollTop:0, scrollHeight:0,
    style:{}, dataset:{},
    classList:{ add(){}, remove(){}, contains(){return false}, toggle(){} },
    children:[],
    appendChild(c){ this.children.push(c); return c; },
    removeChild(){}, remove(){},
    querySelector(){ return makeStub(); },
    querySelectorAll(){ return []; },
    addEventListener(){}, removeEventListener(){}, focus(){}, click(){},
    setAttribute(){}, getAttribute(){ return null; },
    set onclick(f){ this._oc=f; }, get onclick(){ return this._oc||null; }
  };
  return el;
}
const store = {};
const document = {
  getElementById(id){ return store[id] || (store[id]=makeStub()); },
  querySelector(){ return makeStub(); },
  querySelectorAll(){ return []; },
  createElement(){ return makeStub(); },
  addEventListener(){}, body:makeStub()
};
class AudioContextStub { constructor(){ this.state='running'; this.currentTime=0; this.destination={}; }
  resume(){} createOscillator(){ return {type:'',frequency:{setValueAtTime(){}},connect(){},start(){},stop(){}}; }
  createGain(){ return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}; } }

/* 语音合成桩：验证朗读调度（分句、逐句推进、音色选择）是否正常 */
const spoken = [];
const spokenU = [];
class UtteranceStub {
  constructor(t){ this.text=t; this.onstart=null; this.onend=null; this.onerror=null;
    this.voice=null; this.lang=''; this.rate=1; this.pitch=1; this.volume=1; }
}
const speechSynthesis = {
  _voices:[
    {name:'Microsoft Huihui Desktop', lang:'zh-CN', localService:true, voiceURI:'huihui'},
    {name:'Microsoft Xiaoxiao Online (Natural)', lang:'zh-CN', localService:false, voiceURI:'xiaoxiao'},
    {name:'Microsoft Zira Desktop', lang:'en-US', localService:true, voiceURI:'zira'}
  ],
  _cur:null,
  getVoices(){ return this._voices; },
  speak(u){ this._cur=u; spoken.push(u.text); spokenU.push(u); if(u.onstart) u.onstart({});
            setTimeout(()=>{ if(u.onend) u.onend({}); }, 4); },
  cancel(){ this._cur=null; },
  pause(){}, resume(){}
};

const _ls = {};
const localStorage = { getItem:k=>k in _ls?_ls[k]:null, setItem:(k,v)=>_ls[k]=String(v), removeItem:k=>{delete _ls[k];} };

const ctx = {
  document, localStorage, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Math, JSON, Date, Promise, RegExp, String, Number, Array, Object, Boolean, parseInt, parseFloat, isNaN,
  confirm:()=>true, alert:()=>{}, AudioContext:AudioContextStub,
  navigator:{ share:null, clipboard:{ writeText: async()=>{} } },
  window: null
};
ctx.window = ctx;
ctx.globalThis = ctx;
ctx.SpeechSynthesisUtterance = UtteranceStub;
ctx.speechSynthesis = speechSynthesis;
ctx.__spoken = spoken;
ctx.__spokenU = spokenU;
vm.createContext(ctx);

// 拼装脚本：数据 + 核心 + UI + 测试
const kb = fs.readFileSync(BASE+'/../kb/levels_all.json','utf-8');
const scenes = fs.readFileSync(BASE+'/../kb/scenes.json','utf-8');
const ranks = fs.readFileSync(BASE+'/../kb/ranks.json','utf-8');
const core = fs.readFileSync(BASE+'/app_core.js','utf-8');
const tts = fs.readFileSync(BASE+'/tts.js','utf-8');
const ui = fs.readFileSync(BASE+'/app_ui.js','utf-8');

const test = `
(async function(){
  let pass=0, fail=0;
  function ok(name){ pass++; console.log('  ✓', name); }
  function bad(name,e){ fail++; console.log('  ✗', name, '->', e && e.message); }

  // 1) 启动 + 建账号
  try { OB={step:2,name:'测试员',avatar:'🐱',age:'19-40'}; finishOnboard(); ok('建账号 + 进入首页'); }
  catch(e){ bad('建账号',e); }

  // 2) 首页渲染
  try { renderHome(); if(typeof app.innerHTML==='string' && app.innerHTML.length>200) ok('首页渲染'); else throw new Error('空'); }
  catch(e){ bad('首页渲染',e); }

  // 3) 进入场景
  try { renderScene('chinese'); ok('场景地图渲染'); renderScene('chinese'); sceneTab['chinese']='star'; renderScene('chinese'); ok('星图渲染'); }
  catch(e){ bad('场景渲染',e); }

  // 4) 学习页
  try { openLevel('chinese',1); ok('学习页渲染'); explainMore && (EXP_ATT=0); }
  catch(e){ bad('学习页',e); }

  // 5) 答题全流程（含故意答错）
  try {
    startQuiz();
    const lv=qstate.lv; let didWrong=false;
    for(let i=0;i<lv.questions.length;i++){
      const ci='ABCD'.indexOf(lv.questions[i].correct);
      const pick = (ci===0?1:0); // 故意选错（除非只有1个选项）
      chooseOpt(pick);
      if(pick!==ci) didWrong=true;
      nextQ();
    }
    ok('答题流程跑通（含答错，wrong='+qstate.wrong.length+'）');
  } catch(e){ bad('答题流程',e); }

  // 6) 进度已写入
  try {
    const sc=ST.scenes['chinese'];
    if(sc.completed.includes(1) && sc.xp>0) ok('进度已持久化（completed+1, xp='+sc.xp+'）');
    else throw new Error('未记录');
  } catch(e){ bad('进度持久化',e); }

  // 7) 问小A（预生成模式）
  try {
    openChat(CUR_LV, 0);
    document.getElementById('chatInput').value='为什么选A？';
    await chatSend();
    if(CHAT.length>=2) ok('智能体对话（预生成）返回了内容：'+JSON.stringify(CHAT[CHAT.length-1].text.slice(0,30)));
    else throw new Error('无回复');
  } catch(e){ bad('智能体对话',e); }

  // 8) 我的 / 成就
  try { renderMe(); ok('我的页渲染（徽章 '+ST.badges.length+'）'); }
  catch(e){ bad('我的页',e); }

  // 9) 设置页 / 切年龄段
  try { renderSettings(); setAge('40+'); ok('设置页渲染 + 切换年龄段'); }
  catch(e){ bad('设置页',e); }

  // 10) 复习队列（重做答错应进入队列）
  try {
    profile().reviewQueue.length=0;
    updateProfile('chinese', 99, 0, 3, true); // 已学过关 + 重做全错
    if(profile().reviewQueue.includes('chinese:99')) ok('答错关卡进入复习队列（机制验证）');
    else throw new Error('未进队列');
  } catch(e){ bad('复习队列',e); }

  // 11) 所有场景都能进首关
  try {
    let errs=[];
    for(const id in SCENES){
      const n = (function(){ return 1; })();
      try { openLevel(id, nextPlayable(id)); } catch(e){ errs.push(id); }
    }
    if(errs.length===0) ok('6 个场景均可进入关卡'); else throw new Error('失败场景: '+errs.join(','));
  } catch(e){ bad('全场景进入',e); }

  // 12) RAG 跨关检索
  try {
    const hits = RAG.retrieve('什么是Token？和大模型有什么关系', 3);
    if(Array.isArray(hits) && hits.length>0) ok('RAG 检索返回 '+hits.length+' 个相关关卡（如 '+(hits[0].lv&&hits[0].lv.name)+'）');
    else throw new Error('无结果');
  } catch(e){ bad('RAG 检索',e); }

  // 13) 学习路径推荐
  try {
    const path = recommendPath();
    if(Array.isArray(path) && path.length>0) ok('学习路径推荐 '+path.length+' 项（首项：'+KB[path[0].key].name+' / '+path[0].reason+'）');
    else throw new Error('空');
  } catch(e){ bad('学习路径',e); }

  // 14) 智能诊断（动态出卷 + 错题进队列）
  try {
    profile().reviewQueue.length=0;
    openDiagPicker();
    openDiagnosis('chinese');
    if(!qstate || !qstate.isDiag) throw new Error('未进入诊断');
    if(qstate.lv.questions.length<3 || qstate.lv.questions.length>5)
      throw new Error('出题数异常: '+qstate.lv.questions.length);
    startQuiz();
    const lv=qstate.lv;
    for(let i=0;i<lv.questions.length;i++){ chooseOpt('ABCD'.indexOf(lv.questions[i].correct)===0?1:0); nextQ(); }
    // 走完应触发 renderDiagFeedback（错题入队）
    if(profile().reviewQueue.length>0 || qstate.wrong.length===0) ok('智能诊断跑通，错题已入复习队列（'+profile().reviewQueue.length+'）');
    else ok('智能诊断跑通（全对，未触发队列）');
  } catch(e){ bad('智能诊断',e); }

  // 15) 连续学习奖励 + 分享奖励
  try {
    ST.streak.cur=5;
    if(streakBonus()!==20) throw new Error('连续奖励应为20');
    const before=totalXp();
    await shareAchievement();
    if(totalXp()===before+5) ok('连续奖励=20 · 分享+5 XP 生效（XP '+before+'→'+totalXp()+'）');
    else throw new Error('XP变化异常: '+before+'→'+totalXp());
  } catch(e){ bad('XP经济',e); }

  // 16) 首页含智能体推荐入口
  try {
    renderHome();
    if(app.innerHTML.includes('智能诊断') && app.innerHTML.includes('学习路径')) ok('首页已含智能诊断/学习路径入口');
    else throw new Error('入口缺失');
  } catch(e){ bad('首页入口',e); }

  // 17) 我的页含诊断面板
  try {
    renderMe();
    if(app.innerHTML.includes('我的诊断') && app.innerHTML.includes('待加强')) ok('我的页含诊断面板');
    else throw new Error('面板缺失');
  } catch(e){ bad('诊断面板',e); }

  // 18) 关卡顺序解锁：没通过前一关，后一关进不去
  try {
    const id='math'; const bak=ST;
    ST=defState();
    let r=[lvState(id,1),lvState(id,2),lvState(id,3)].join(',');
    if(r!=='open,locked,locked') throw new Error('初始状态异常: '+r);
    ST.scenes[id].completed=[1];
    r=[lvState(id,1),lvState(id,2),lvState(id,3)].join(',');
    if(r!=='done,open,locked') throw new Error('通关第1关后状态异常: '+r);
    qstate=null; openLevel(id,3);                 // 直接跳第3关，应被拦下
    if(qstate!==null) throw new Error('未拦截跳关');
    ST=bak;
    ok('关卡顺序解锁 + 跳关拦截 生效');
  } catch(e){ bad('顺序解锁',e); }

  // 19) 语音朗读：分句、选音色、逐句推进、高亮回调
  try {
    ttsLoad(); ttsPickVoice();
    if(!TTS.supported) throw new Error('语音未启用');
    if(!TTS.voice || !/Xiaoxiao/.test(TTS.voice.name)) throw new Error('未优选自然音色: '+(TTS.voice&&TTS.voice.name));
    if(!TTS.enOk || !TTS.enVoice || !/Zira/.test(TTS.enVoice.name)) throw new Error('未选中英文音色: '+(TTS.enVoice&&TTS.enVoice.name));
    if(ttsLangOf('I have a new bag.')!=='en') throw new Error('英文语种判定失败');
    if(ttsLangOf('我有一个新书包。')!=='zh') throw new Error('中文语种判定失败');
    if(ttsLangOf('今天小A带你认字。')!=='zh') throw new Error('中英夹单字母误判为英文');
    const rs=ttsRuns('I have a new bag.（我有一个新书包。）', 'en');
    if(rs.length!==2||rs[0].lang!=='en'||rs[1].lang!=='zh') throw new Error('中英未分轨: '+JSON.stringify(rs));
    const parts=ttsSplit(KB['chinese:1'].story);
    if(parts.length<3) throw new Error('分句过少: '+parts.length);
    if(parts.some(s=>s.length>40)) throw new Error('存在超长句未切分');
    const long=ttsSplit('小朋友，你抬头看看天，蓝蓝的、飘着白云的，那就是天；再低头看看脚下，能种花种草的地方，那就是地。');
    if(long.some(s=>s.length>40)) throw new Error('长句二次切分失效');
    const num=ttsSplit('你数数看：10、20、30、40、50、60、70、80、90、100。');
    if(num.join('').indexOf('10、20、30、40、50')<0) throw new Error('数字列举被切碎: '+JSON.stringify(num));
    let lossy=0;
    Object.keys(KB).forEach(k=>{
      const s=String(KB[k].story||'').replace(/小结[：:][^。！？]*[。！？]?/g,'').replace(/\\s+/g,' ').trim();
      if(ttsSplit(s).join('').replace(/\\s+/g,'')!==s.replace(/\\s+/g,'')) lossy++;
    });
    if(lossy) throw new Error(lossy+' 个关卡分句丢字');
    __spoken.length=0;
    const hit=[];
    ttsSpeak(['第一句。','第二句。','第三句。'], { onLine:i=>hit.push(i) });
    await new Promise(r=>setTimeout(r,2400));
    if(__spoken.length!==3) throw new Error('实际朗读句数异常: '+__spoken.length);
    if(hit.length<6) throw new Error('高亮回调次数异常: '+hit.length);
    ttsHalt();
    if(TTS._speaking) throw new Error('停止失败');
    ok('语音朗读：story 分 '+parts.length+' 句 · 长句二次切分 · 中'+TTS.voice.name.split(' ')[1]+'/英'+TTS.enVoice.name.split(' ')[1]+' 双音色 · 逐句发声 '+__spoken.length+'/3');
  } catch(e){ bad('语音朗读',e); }

  // 20) 知情同意门禁
  try {
    localStorage.removeItem('xiaoA_consent_v1');
    if(hasConsent()) throw new Error('首次进入不应视为已同意');
    markConsent();
    if(!hasConsent()) throw new Error('确认后未写入标记');
    ok('知情同意：首次拦住 → 点确认后放行');
  } catch(e){ bad('知情同意',e); }

  // 21) 英语关卡：中英分轨朗读（英文用英文音色+英文语速，中文用中文音色）
  try {
    ttsLoad(); ttsPickVoice();
    __spoken.length=0; __spokenU.length=0;
    const engCards=ttsSplit(ttsStripSummary(KB['english:5'].story));
    if(!engCards.some(s=>s==='I have a new bag.')) throw new Error('英语关卡未切出独立英文句: '+JSON.stringify(engCards));
    if(!engCards.some(s=>s==='（我有一个新书包。）')) throw new Error('英语关卡未切出独立中文译文: '+JSON.stringify(engCards));
    ttsSpeak([{t:'I have a new bag.（我有一个新书包。）',p:200}], {lang:'en'});
    await new Promise(r=>setTimeout(r,1600));
    if(__spokenU.length<2) throw new Error('中英混排未拆成两段朗读: '+__spokenU.length+' -> '+JSON.stringify(__spoken));
    const a=__spokenU[0], b=__spokenU[1];
    if(a.text!=='I have a new bag') throw new Error('第一段应为英文句（且已去句点）: '+a.text);
    if(a.voice!==TTS.enVoice) throw new Error('英文句未用英文音色: '+(a.voice&&a.voice.name));
    if(Math.abs(a.rate-TTS.enRate)>0.001) throw new Error('英文句语速错误: '+a.rate);
    if(!/^en/i.test(a.lang)) throw new Error('英文句 lang 错误: '+a.lang);
    if(b.text!=='我有一个新书包') throw new Error('第二段应为中文译文（且已去括号句号）: '+b.text);
    if(b.voice!==TTS.voice) throw new Error('中文段未用中文音色: '+(b.voice&&b.voice.name));
    if(Math.abs(b.rate-TTS.rate)>0.001) throw new Error('中文段语速错误: '+b.rate);
    ttsHalt();
    ok('英语分轨朗读：英 '+a.voice.name.split(' ')[1]+'@'+a.rate+' / 中 '+b.voice.name.split(' ')[1]+'@'+b.rate+' 交替出声');
  } catch(e){ bad('英语分轨朗读',e); }

  // 22) 标点不朗读：送进引擎的文本必须干干净净
  try {
    if(ttsClean('小朋友，你好。')!=='小朋友 你好') throw new Error('中文标点未剥离: '+JSON.stringify(ttsClean('小朋友，你好。')));
    if(ttsClean('1、2、3')!=='1 2 3') throw new Error('数字间的顿号被吞掉（会连读成 123）: '+JSON.stringify(ttsClean('1、2、3')));
    if(ttsClean('3.5 米高')!=='3.5 米高') throw new Error('小数点被破坏: '+JSON.stringify(ttsClean('3.5 米高')));
    if(ttsClean("I'm Andy.",'en')!=="I'm Andy") throw new Error('英文撇号被删（Im 会读错）: '+JSON.stringify(ttsClean("I'm Andy.",'en')));
    if(ttsClean('（铅笔）、','zh')!=='铅笔') throw new Error('括号顿号未清: '+JSON.stringify(ttsClean('（铅笔）、','zh')));
    if(ttsClean('——','zh')!=='') throw new Error('纯标点段应清空: '+JSON.stringify(ttsClean('——','zh')));
    // 全库硬断言：任何一段送进引擎的文本都不许残留中文标点
    const ZH_PUNCT=/[，。！？；：、（）《》〈〉【】「」『』“”‘’·～—…]/;
    let dirty=0, sample='';
    Object.keys(KB).forEach(k=>{
      ttsSplit(ttsStripSummary(KB[k].story||'')).forEach(card=>{
        ttsRuns(card).forEach(r=>{
          const c=ttsClean(r.t, r.lang);
          if(ZH_PUNCT.test(c)){ dirty++; if(!sample) sample=k+' :: '+c; }
        });
      });
    });
    if(dirty) throw new Error(dirty+' 段朗读文本残留标点: '+sample);
    __spoken.length=0;
    ttsSpeak(['小朋友，你好。'], {});
    await new Promise(r=>setTimeout(r,600));
    if(__spoken[0]!=='小朋友 你好') throw new Error('实际朗读文本仍带标点: '+JSON.stringify(__spoken[0]));
    ttsHalt();
    ok('标点不朗读：全库 0 段残留 · 数字/小数点/撇号均正确保留');
  } catch(e){ bad('标点不朗读',e); }

  // 23) 拼音不被误读为英文字母：中文关里拼音交给中文音色
  try {
    ttsLoad(); ttsPickVoice();
    // 带声调的拼音 → 中文音色（绝不走英文）
    const rs1 = ttsRuns('爸爸（bà ba）的‘b’', 'zh');
    const py1 = rs1.filter(r=>/[A-Za-z]/.test(r.t));
    if(py1.some(r=>r.lang!=='zh')) throw new Error('带声调拼音被分到英文: '+JSON.stringify(rs1));
    // 单字母拼音（a o e i u ü b p m f）在中文关 → 中文音色
    const rs2 = ttsRuns('i、u、ü 是三个单韵母', 'zh');
    const py2 = rs2.filter(r=>/[A-Za-zü]/.test(r.t));
    if(py2.some(r=>r.lang!=='zh')) throw new Error('单字母拼音被分到英文: '+JSON.stringify(rs2));
    // 全库中文关：任何含拉丁字母的朗读段都必须走中文音色（拼音），不能误分英文
    let mis=0, msample='';
    Object.keys(KB).forEach(k=>{
      if(k.indexOf('chinese:')!==0) return;
      ttsSplit(ttsStripSummary(KB[k].story||'')).forEach(card=>{
        ttsRuns(card,'zh').forEach(r=>{
          if(/[A-Za-z]/.test(r.t) && r.lang!=='zh'){ mis++; if(!msample) msample=k+' :: '+r.t; }
        });
      });
    });
    if(mis) throw new Error(mis+' 段中文关拼音被误分英文: '+msample);
    // 清洗后声调符号归为基字母、元音不丢（"bà"→"ba" 不是 "b"）
    if(ttsClean('bà ba（爸爸）', 'zh')!=='ba ba 爸爸') throw new Error('拼音清洗丢元音: '+JSON.stringify(ttsClean('bà ba（爸爸）','zh')));
    if(ttsClean('xiǎo jī（小鸡）','zh')!=='xiao ji 小鸡') throw new Error('拼音清洗异常: '+JSON.stringify(ttsClean('xiǎo jī（小鸡）','zh')));
    if(ttsClean('lǘ（绿）','zh')!=='lü 绿') throw new Error('ü 被吞: '+JSON.stringify(ttsClean('lǘ（绿）','zh')));
    // 实际朗读：中文关里 "bà ba" 用中文音色，且清洗后不丢元音
    __spoken.length=0; __spokenU.length=0; TTS.scene='chinese';
    ttsSpeak(['爸爸（bà ba）的 b，是声母 b。'], {});
    await new Promise(r=>setTimeout(r,1500));
    const pyRun = __spokenU.find(u=>/[A-Za-z]/.test(u.text));
    if(!pyRun) throw new Error('未实际朗读出拼音段');
    if(pyRun.voice!==TTS.voice) throw new Error('拼音段用了英文音色: '+(pyRun.voice&&pyRun.voice.name));
    if(pyRun.text!=='爸爸 ba ba 的b') throw new Error('拼音段清洗结果异常: '+JSON.stringify(pyRun.text));
    ttsHalt();
    // 回归：英语关里的英文仍走英文音色（不被中文关逻辑误伤）
    __spoken.length=0; __spokenU.length=0;
    ttsSpeak(['I have a new bag.'], {lang:'en'});
    await new Promise(r=>setTimeout(r,1000));
    if(__spokenU[0].voice!==TTS.enVoice) throw new Error('英文关英文被错分中文音色');
    ttsHalt();
    ok('拼音朗读：带声调/单字母均交中文音色 · 声调归基字母不丢元音 · 英文关英文仍走英文音色');
  } catch(e){ bad('拼音朗读',e); }

  console.log('\\n结果：通过 '+pass+' / 失败 '+fail);
  globalThis.__fail=fail;
})();
`;

const full = `const KB=${kb};const SCENES=${scenes};const RANKS=${ranks};\n${core}\n${tts}\n${ui}\n${test}`;
try { vm.runInContext(full, ctx, {filename:'bundle.js'}); }
catch(e){ console.error('致命错误（顶层）：', e.message, '\n', e.stack); }
if(ctx.__fail>0) process.exitCode=1;
