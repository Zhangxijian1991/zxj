/* ==================================================================
   小A 语音朗读引擎（TTS）
   ------------------------------------------------------------------
   面向对象：小学一年级学生（6-7 岁，识字量有限，靠"听"学）
   设计原则：
     1. 慢 —— 语速 0.8 倍，一句话一口气听完，孩子跟得上
     2. 断 —— 逐句朗读，句尾按标点停顿，像老师讲故事不像机器人播报
     3. 同步 —— 读到哪句哪句高亮，能"听音认字"
     4. 零依赖 —— 只用浏览器内置语音合成，不联网、不烧积分、离线可用
     5. 永不残废 —— 设备没有语音包时按钮自动隐藏，绝不出现"点了没反应"
   ================================================================== */

const TTS = {
  supported: (typeof window !== 'undefined') && !!window.speechSynthesis && !!window.SpeechSynthesisUtterance,
  on: true,            // 语音总开关
  autoQ: true,         // 进入题目自动读题
  autoEx: true,        // 答完自动读解析
  rate: 0.8,           // 中文语速（成人正常为 1.0）
  enRate: 0.72,        // 英文语速：再慢一点，方便孩子跟读
  pitch: 1.08,         // 音调略高，更接近儿童熟悉的语气
  voice: null,         // 中文音色
  enVoice: null,       // 英文音色（英语关卡必须是英文音色，否则发音很怪）
  scene: 'chinese',    // 当前关卡所属场景：'chinese' 里拉丁字母按拼音读，'english' 里按英文读
  cands: [], enCands: [],
  ci: 0, eci: 0,
  zhOk: true, enOk: false,
  _tok: 0, _lines: [], _opts: null, _i: 0, _timer: null, _wd: null, _fail: 0, _speaking: false, _paused: false
};

/* ---------- 配置持久化 ---------- */
function ttsLoad() {
  try {
    TTS.on    = localStorage.getItem('xiaoA_tts') !== '0';
    TTS.autoQ = localStorage.getItem('xiaoA_tts_autoq') !== '0';
    TTS.autoEx= localStorage.getItem('xiaoA_tts_autoex') !== '0';
    const r = parseFloat(localStorage.getItem('xiaoA_tts_rate'));
    if (r > 0.4 && r < 1.6) TTS.rate = r;
    const er = parseFloat(localStorage.getItem('xiaoA_tts_enrate'));
    if (er > 0.4 && er < 1.6) TTS.enRate = er;
    const p = parseFloat(localStorage.getItem('xiaoA_tts_pitch'));
    if (p > 0.5 && p < 2) TTS.pitch = p;
  } catch (e) { /* 隐私模式下 localStorage 可能不可用，忽略 */ }
}
function ttsSave() {
  try {
    localStorage.setItem('xiaoA_tts', TTS.on ? '1' : '0');
    localStorage.setItem('xiaoA_tts_autoq', TTS.autoQ ? '1' : '0');
    localStorage.setItem('xiaoA_tts_autoex', TTS.autoEx ? '1' : '0');
    localStorage.setItem('xiaoA_tts_rate', String(TTS.rate));
    localStorage.setItem('xiaoA_tts_enrate', String(TTS.enRate));
    localStorage.setItem('xiaoA_tts_pitch', String(TTS.pitch));
  } catch (e) {}
}

/* ---------- 选语音 ----------
   中文和英文各选一套：英语关卡里既有英文句子也有中文讲解，
   用中文音色念英文会非常难听（反之亦然），必须分开。 */
function ttsVoiceScore(v, want) {
  const n = ((v.name || '') + ' ' + (v.voiceURI || '')).toLowerCase();
  let s = 0;
  if (want === 'zh') {
    if (/xiaoxiao|xiaoyi|晓晓|晓伊/.test(n)) s += 120;          // Win11 自然语音，最像真人
    if (/natural|neural|online|自然/.test(n)) s += 70;
    if (/zh[-_]cn|zh[-_]hans/.test(v.lang || '')) s += 45;
    if (/huihui|kangkang|yaoyao|云希|云扬/.test(n)) s += 22;
  } else {
    if (/aria|jenny|emma|michelle|sonia|natural|neural|online/.test(n)) s += 100;
    if (/^en[-_]us/i.test(v.lang || '')) s += 50;
    else if (/^en[-_]gb/i.test(v.lang || '')) s += 38;
    if (/zira|samantha|karen|moira|google us english/.test(n)) s += 30;
  }
  if (v.localService) s += 8;                                  // 本地语音更稳，断网也能读
  return s;
}
function ttsPickVoice() {
  if (!TTS.supported) return;
  let vs = [];
  try { vs = speechSynthesis.getVoices() || []; } catch (e) { vs = []; }
  if (!vs.length) return;
  const zh = vs.filter(v => /^zh/i.test(v.lang || ''));
  const en = vs.filter(v => /^en/i.test(v.lang || ''));
  TTS.zhOk = zh.length > 0;
  TTS.enOk = en.length > 0;
  TTS.cands = zh.slice().sort((a, b) => ttsVoiceScore(b, 'zh') - ttsVoiceScore(a, 'zh'));
  TTS.enCands = en.slice().sort((a, b) => ttsVoiceScore(b, 'en') - ttsVoiceScore(a, 'en'));
  TTS.ci = 0; TTS.eci = 0;
  TTS.voice = TTS.cands[0] || null;
  TTS.enVoice = TTS.enCands[0] || null;
}
function ttsNextVoice(lang) {
  if (lang === 'en') {
    if (TTS.eci + 1 < TTS.enCands.length) { TTS.eci++; TTS.enVoice = TTS.enCands[TTS.eci]; return true; }
    if (TTS.enVoice !== TTS.voice && TTS.voice) { TTS.enVoice = TTS.voice; return true; }  // 退而求其次：借中文音色
    return false;
  }
  if (TTS.ci + 1 < TTS.cands.length) { TTS.ci++; TTS.voice = TTS.cands[TTS.ci]; return true; }
  return false;
}

/* ---------- 语种判定：中文 / 英文 / 拼音 ----------
   英语关卡是「中英混排」的：中文讲解 + 英文例句 +（中文翻译）。
   用中文音色念英文、或用英文音色念中文，都很难听，孩子还会学错发音。
   所以朗读前先把一段话切成"同语种小段"，再分别用对应音色读。

   拼音特例：语文关里的拉丁字母（尤其是带声调符号的 bà / mā / xiǎo）是拼音，
   不是英文。一旦错分给英文音色，会被念成 "bee / eye / ex"，
   一年级孩子刚学拼音就学歪了。所以"中文语境里的拉丁字母 → 中文音色"，
   中文 TTS 会按汉语拼音把它们读成 bo / po / ma / a，正好是孩子要学的。 */
function ttsHasTone(s) {
  return /[āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜüǹḿɡ]/.test(s || '');
}
/* 声调符号归一为基字母：否则清洗时会把元音整个删掉（"bà"→"b" 丢了 a）。
   归一后 "bà ba"→"ba ba"，中文音色才能读成完整拼音。 */
function ttsDetone(s) {
  return String(s == null ? '' : s)
    .replace(/[āáǎà]/g, 'a').replace(/[ōóǒò]/g, 'o')
    .replace(/[ēéěè]/g, 'e').replace(/[īíǐì]/g, 'i')
    .replace(/[ūúǔù]/g, 'u').replace(/[ǖǘǚǜ]/g, 'ü')
    .replace(/[ǹ]/g, 'n').replace(/[ḿ]/g, 'm').replace(/[ɡ]/g, 'g');
}
function ttsCharLang(c) {
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) return 'en';
  if (c >= '\u4e00' && c <= '\u9fff') return 'zh';
  return '';                                  // 标点 / 空格 / 数字：跟随当前语种
}
function ttsLangOf(s) {
  const t = String(s || '');
  let en = 0, zh = 0;
  for (let i = 0; i < t.length; i++) {
    const k = ttsCharLang(t[i]);
    if (k === 'en') en++; else if (k === 'zh') zh++;
  }
  if (!en && !zh) return 'zh';
  return en > zh ? 'en' : 'zh';
}
/* 把一句话切成 [{t,lang}]：同语种连续字符归为一段。
   defaultLang：内容主语种——'zh'（语文关）时拉丁字母当拼音读，'en'（英语关）时当英文读。 */
function ttsLetterCount(t) { return (String(t).match(/[A-Za-z\u4e00-\u9fff]/g) || []).length; }
function ttsRuns(seg, defaultLang) {
  const s = String(seg || '');
  defaultLang = defaultLang || 'zh';
  const parts = [];
  let pend = '';                              // 开头的标点，等语种定了再归属
  let cur = '', buf = '';
  const flush = () => { const t = buf.trim(); if (t) parts.push({ t: t, lang: cur }); buf = ''; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const k = ttsCharLang(c);
    if (!k) {                                 // 标点 / 空格 / 数字
      if (!cur) { pend += c; continue; }       // 还没定语种：先攒着（不能丢字符！）
      buf += c; continue;
    }
    if (!cur) { cur = k; buf = pend + c; pend = ''; continue; }
    if (k !== cur) { flush(); cur = k; buf = c; continue; }
    buf += c;
  }
  flush();
  if (pend.trim()) {
    if (parts.length) parts[parts.length - 1].t += pend.trim();
    else parts.push({ t: pend.trim(), lang: 'zh' });
  }
  if (!parts.length && s.trim()) parts.push({ t: s.trim(), lang: ttsLangOf(s) });
  /* 只剩标点、或只有一个字母/一个汉字的碎片，都不是真正的语种切换：
     「今天小A带你认字」里的 A 如果单独走英文音色，听起来会很突兀。
     所以把它们并进相邻段。 */
  const out = [];
  parts.forEach(p => {
    const last = out[out.length - 1];
    if (last && (ttsLetterCount(p.t) < 2 || last.lang === p.lang)) last.t += p.t;
    else out.push({ t: p.t, lang: p.lang });
  });
  /* 拼音识别：中文关里的拉丁字母（尤其带声调符号）是拼音，不是英文，
     必须交给中文音色读——否则会被当成英文字母，念成 "bee / eye"，
     一年级孩子刚学拼音就被带歪。英文关里则相反，拉丁字母就是英文。 */
  out.forEach(r => {
    if (ttsHasTone(r.t)) r.lang = 'zh';                                  // 带声调（mā / bà / xiǎo）一定是拼音
    else if (defaultLang === 'zh' && /[A-Za-z]/.test(r.t)) r.lang = 'zh'; // 中文关里的字母默认按拼音读
  });
  /* 重新合并相邻同语种段：上一步把 "bà" 标成中文后，
     "爸爸（" 和 "bà ba）" 和 "的" 要并回一段，避免读得支离破碎。 */
  const merged = [];
  out.forEach(r => {
    const last = merged[merged.length - 1];
    if (last && last.lang === r.lang) last.t += r.t;
    else merged.push({ t: r.t, lang: r.lang });
  });
  /* 「pencil（铅笔）」这类，前一段会多带一个左括号，
     读起来没影响，但看着别扭，挪到后一段去。 */
  for (let i = 0; i < merged.length - 1; i++) {
    const m = merged[i].t.match(/[（(]+$/);
    if (m) { merged[i].t = merged[i].t.slice(0, -m[0].length); merged[i + 1].t = m[0] + merged[i + 1].t; }
  }
  return merged.filter(r => ttsLetterCount(r.t) > 0 || r.t.trim());
}

/* ---------- 分句：切成"一口气能读完"的短句 ---------- */
const TTS_END = '。！？!?；;';
const TTS_TAIL = "’”'\"」』）)】";               // 句末标点后常跟着的收尾符号
/* 英文句号只在"确实是句末"时才断句：
   I have a bag.（我有一个书包。）→ 断；I'm... / 3.5 / No.1 → 不断 */
function ttsIsSentenceDot(s, i) {
  if (i > 0 && s[i - 1] === '.') return false;
  if (i + 1 < s.length && s[i + 1] === '.') return false;
  const prev = i > 0 ? s[i - 1] : '';
  if (!(ttsCharLang(prev) === 'en' || (prev >= '0' && prev <= '9'))) return false;
  let j = i + 1;
  while (j < s.length && TTS_TAIL.indexOf(s[j]) >= 0) j++;   // 跳过 ’ ） 等收尾符号
  const nx = j < s.length ? s[j] : '';
  if (nx === '' || nx === ' ' || nx === '\t') return true;
  if (ttsCharLang(nx) === 'zh') return true;
  if ('（(。！？，、；：'.indexOf(nx) >= 0) return true;
  return false;
}
function ttsSplit(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const rough = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {        // 不用 lookbehind，老 Safari 也安全
    const ch = s[i];
    buf += ch;
    const cut = TTS_END.indexOf(ch) >= 0 || (ch === '.' && ttsIsSentenceDot(s, i));
    if (cut) {
      let j = i + 1;                          // 把紧跟其后的 ’ ） 一并收进来
      while (j < s.length && TTS_TAIL.indexOf(s[j]) >= 0) { buf += s[j]; j++; }
      i = j - 1;
      rough.push(buf.trim()); buf = '';
    }
  }
  if (buf.trim()) rough.push(buf.trim());

  const out = [];
  for (const seg of rough) {
    if (seg.length <= 32) { out.push(seg); continue; }
    /* 长句在逗号/破折号处再切：先切出小片，再贪心拼到 ~22 字，
       这样每张卡都能"一口气读完"，且不会出现以逗号开头的卡。
       注意：顿号「、」不能当断点——数学里的「1、2、3、4、5」会被切碎。
       小片一律不 trim，免得把 "one, two" 里的空格吃掉。 */
    const pieces = [];
    let piece = '';
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      piece += ch;
      if (ch === '—' && seg[i + 1] === '—') {   // 破折号是两个字，一起收进上一片
        piece += '—'; i++;
        pieces.push(piece); piece = '';
        continue;
      }
      if (ch === '，' || ch === ',') { pieces.push(piece); piece = ''; continue; }
      // 顿号只在"每一项都比较长"时才断（词汇表 red（红色）、blue（蓝色）…），
      // 数学里的「1、2、3、4、5」「10、20、30」不能断，否则会读得支离破碎。
      if (ch === '、' && piece.length >= 6) { pieces.push(piece); piece = ''; }
    }
    if (piece) pieces.push(piece);
    let acc = '';
    const flushAcc = () => { const t = acc.replace(/\s+/g, ' ').trim(); if (t) out.push(t); acc = ''; };
    pieces.forEach(p => {
      if (acc && (acc + p).length > 22) flushAcc();
      acc += p;
    });
    flushAcc();
  }
  const merged = [];                          // 太短的碎句并回去，避免读得磕磕巴巴
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && seg.length < 5 && (last.length + seg.length) <= 34) merged[merged.length - 1] = last + seg;
    else merged.push(seg);
  }
  return merged.filter(Boolean);
}
/* 句尾停顿时长（毫秒）——低龄朗读的关键，宁可慢一点 */
function ttsGap(seg) {
  // 忽略结尾的引号/括号/省略号，看真正的句尾标点
  const s = String(seg || '').replace(/[’”"'‘「」『』（）()【】〔〕\[\]\s·…]+$/, '');
  if (/[。]$/.test(s)) return 400;
  if (/[！？!?]$/.test(s)) return 470;
  if (/[；;]$/.test(s)) return 280;
  if (/\.$/.test(s)) return 420;                 // 英文句末：先读完再听译文
  if (/[，,、]$/.test(s) || /——$/.test(s)) return 200;
  return 220;
}

/* ---------- 移动端音频解锁 ----------
   iOS Safari / Android Chrome 都要求语音合成必须由用户手势"唤醒"过，
   之后的自动朗读（比如进入题目自动读题）才发得出声。
   做法：首次任意触摸/点击时，在手势调用栈里 speak 一个静音短句。 */
let TTS_UNLOCKED = false;
function ttsUnlock() {
  if (TTS_UNLOCKED || !TTS.supported) return;
  TTS_UNLOCKED = true;
  try {
    const u = new SpeechSynthesisUtterance('。');
    u.volume = 0; u.rate = 2; u.pitch = 1; u.lang = 'zh-CN';
    if (TTS.voice) u.voice = TTS.voice;
    speechSynthesis.speak(u);
  } catch (e) { /* 解锁失败不致命，后续手动点播音仍可用 */ }
  ttsPickVoice();
}
function ttsBindUnlock() {
  if (typeof document === 'undefined') return;
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
    try { document.addEventListener(ev, ttsUnlock, { once: true, passive: true }); } catch (e) {
      document.addEventListener(ev, ttsUnlock, { once: true });
    }
  });
  // 切到后台就闭嘴，避免切回来还在念
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { ttsHalt(); if (typeof ttsSyncBtns === 'function') ttsSyncBtns(); }
  });
}

/* ---------- 停止 ---------- */
function ttsHalt() {
  TTS._tok++;
  TTS._speaking = false; TTS._paused = false;
  clearTimeout(TTS._timer); TTS._timer = null;
  clearTimeout(TTS._wd); TTS._wd = null;
  if (TTS.supported) { try { speechSynthesis.cancel(); } catch (e) {} }
  ttsMark(-1);
}
/* ---------- 短语切分：标点不念，但"换气"要留下 ----------
   把逗号从文本里剥掉之后，引擎多半只会把空格一带而过，
   长句子就变成一马平川地念下来，反而更像机器人。
   所以按逗号级标点把长卡切成短语，逐个念、中间留一小口气——
   就像老师念课文：句子中间该喘气的地方喘一下。
   注意：顿号不切，「1、2、3」要保持一口气。 */
function ttsPhrases(t) {
  const s = String(t || '');
  const A = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '，' || c === ',' || c === '；' || c === ';' || c === '：' || c === ':') {
      if (buf.trim()) A.push({ t: buf.trim(), mark: c });
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) A.push({ t: buf.trim(), mark: '' });
  /* 只有一两个字的短语不能单独成段——「第几…表示位置」会被读成一顿一顿。
     把它们并给下一段，读出来就是「第几 表示位置」这种自然的说法。 */
  const out = [];
  let hold = null;
  A.forEach((p, i) => {
    if (hold) { p = { t: hold.t + ' ' + p.t, mark: p.mark }; hold = null; }
    if (ttsLetterCount(p.t) < 3 && i < A.length - 1) { hold = p; return; }
    out.push(p);
  });
  if (hold) { if (out.length) out[out.length - 1].t += ' ' + hold.t; else out.push(hold); }
  return out.length ? out : [{ t: s, mark: '' }];
}

/* ---------- 朗读主体 ----------
   lines: 字符串数组，或 [{t:'文本', p:停顿毫秒}]
   opts : { hl:[DOM…] 高亮目标, onLine(i,on), onDone() } */
function ttsSpeak(lines, opts) {
  opts = opts || {};
  if (typeof lines === 'string') lines = ttsSplit(lines);
  const arr = (lines || []).filter(x => x && (typeof x === 'string' ? x.trim() : x.t));
  ttsHalt();
  if (!TTS.supported || !TTS.on || !arr.length) { if (opts.onDone) opts.onDone(); return; }
  const tk = TTS._tok;
  /* 内容主语种：英语关里的拉丁字母按英文读，其它（语文关等）按拼音读。
     显式传 opts.lang 可覆盖，没传就用当前场景（TTS.scene）。 */
  const langHint = (opts.lang === 'en' || opts.lang === 'zh') ? opts.lang
                 : (TTS.scene === 'english' ? 'en' : 'zh');
  /* 一行文字可能中英混排，先拆成同语种小段；
     每小段仍记着它属于哪一行（line），所以高亮不会错位。 */
  const runs = [];
  arr.forEach((item, li) => {
    const txt = ttsText(item);
    if (!txt) return;
    const gap = ttsGapOf(item);
    /* 长卡才切短语：短卡本来就一口气读完，切了反而磕巴 */
    const phs = (txt.length >= 12) ? ttsPhrases(txt) : [{ t: txt, mark: '' }];
    phs.forEach((ph, pi) => {
      const phLast = (pi === phs.length - 1);
      const rs = ttsRuns(ph.t, langHint);
      rs.forEach((r, k) => {
        if (!r.t) return;
        const isLast = phLast && (k === rs.length - 1);
        runs.push({
          t: r.t, lang: r.lang || 'zh', line: li, last: isLast,
          gap: isLast ? gap : 110          // 短语之间：一小口气（不能再长，否则像卡带）
        });
      });
    });
  });
  if (!runs.length) { if (opts.onDone) opts.onDone(); return; }
  TTS._lines = arr; TTS._runs = runs; TTS._opts = opts; TTS._i = 0;
  TTS._speaking = true; TTS._paused = false; TTS._fail = 0; TTS._curLang = '';
  TTS._timer = setTimeout(() => ttsSpin(tk), 90);   // cancel() 后立刻 speak 会哑掉，稍等一拍
}
function ttsGapOf(item) {
  if (item && typeof item === 'object') {
    if (item.p != null) return item.p;
    return ttsGap(item.t || '');     // 没指定停顿就按句尾标点自动判断
  }
  return ttsGap(item);
}
function ttsText(item) {
  const t = (item && typeof item === 'object') ? item.t : item;
  return String(t || '').replace(/[—]{2,}/g, '，').trim();
}

/* ---------- 朗读文本清洗：标点不念出来 ----------
   不少语音包会把中文标点"读出声"——念成"逗号""句号"，听起来像机器人在报菜单。
   停顿我们已经自己按标点算好了（ttsGap），不需要引擎再去念标点，所以送进
   引擎前一律剥掉标点，只留字。

   要点：
     · 标点换成**空格**而不是直接删——「1、2、3」直接删会粘成 123，被读成"一百二十三"；
       换成空格就还是"1 2 3"。
     · 小数点先保护起来（3.5 不能变成 35）。
     · 撇号只在**词内**才留（I'm / Let's）——中文字里的‘a’、末尾的’ 都是引号，必须去掉，
       否则会跟着字母一起被念出来。 */
function ttsClean(seg, lang) {
  let s = String(seg == null ? '' : seg);
  if (!s) return '';
  s = ttsDetone(s);                                                     // 声调符号归一为基字母，免得元音被删掉
  s = s.replace(/(\d)[.．](\d)/g, '$1\u0001$2');                       // 保护小数点
  s = s.replace(/([A-Za-z])['’‘]([A-Za-z])/g, '$1\u0002$2');           // 保护词内撇号 I'm / Let's
  s = s.replace(/[—–─]{1,}|[…⋯]+|\.{3,}/g, ' ');                       // 破折号 / 省略号
  if (lang === 'en') {
    s = s.replace(/[^A-Za-z0-9\u0001\u0002\s\u4e00-\u9fffüɡ]/g, ' ');  // 英文段：只留字母数字（ü/ɡ 也留，拼音保底）
  } else {
    s = s.replace(/[^0-9A-Za-z\u0001\u0002\s\u4e00-\u9fffüɡ]/g, ' ');  // 中文段：一切标点都去掉（含拼音 ü/ɡ）
  }
  s = s.replace(/\u0001/g, '.').replace(/\u0002/g, "'");
  return s.replace(/[ \t\u3000]+/g, ' ').trim();
}
/* 按语种挑音色：英文必须用英文音色，否则发音很怪 */
function ttsVoiceFor(lang) {
  if (lang === 'en') return TTS.enVoice || TTS.voice || null;
  return TTS.voice || TTS.enVoice || null;
}
function ttsSpin(tk) {
  if (tk !== TTS._tok) return;
  const o = TTS._opts || {};
  const R = TTS._runs || [];
  if (TTS._i >= R.length) {
    TTS._speaking = false;
    if (o.onLine) { try { o.onLine(-1, false); } catch (e) {} }
    if (o.onDone) { try { o.onDone(); } catch (e) {} }
    return;
  }
  const run = R[TTS._i], i = TTS._i, seg = run.t, li = run.line, lang = run.lang || 'zh';
  TTS._curLang = lang;
  if (!seg) { TTS._i++; TTS._timer = setTimeout(() => ttsSpin(tk), 40); return; }
  /* 剥掉标点再送给引擎，否则有些语音包会把"逗号""句号"念出来 */
  const speak = ttsClean(seg, lang);
  if (!speak) {                                  // 整段都是标点（如"——"）：空过，只留停顿
    if (run.last && o.onLine) { try { o.onLine(li, false); } catch (e) {} }
    TTS._i++;
    TTS._timer = setTimeout(() => ttsSpin(tk), run.gap != null ? run.gap : 120);
    return;
  }
  if (o.onLine) { try { o.onLine(li, true); } catch (e) {} }

  let u;
  try { u = new SpeechSynthesisUtterance(speak); } catch (e) { TTS._speaking = false; return; }
  const v = ttsVoiceFor(lang);
  if (v) u.voice = v;
  u.lang = (v && v.lang) || (lang === 'en' ? 'en-US' : 'zh-CN');
  u.rate = (lang === 'en') ? TTS.enRate : TTS.rate;   // 英文再慢一点，方便跟读
  u.pitch = TTS.pitch; u.volume = 1;

  const endLine = () => { if (run.last && o.onLine) { try { o.onLine(li, false); } catch (e) {} } };
  const finish = () => {
    TTS._speaking = false;
    if (o.onLine) { try { o.onLine(-1, false); } catch (e) {} }
    if (o.onDone) { try { o.onDone(); } catch (e) {} }
  };

  let started = false;
  u.onstart = () => { started = true; TTS._fail = 0; };
  u.onend = () => {
    if (tk !== TTS._tok) return;
    clearTimeout(TTS._wd); TTS._wd = null;
    endLine();
    TTS._i++;
    if (TTS._i >= R.length) {
      // 最后一句读完就立刻收尾：不要再多等一个句尾停顿，
      // 否则用户点完单句想马上再点「听小A讲」会被误判成「正在播放」。
      finish();
      return;
    }
    TTS._timer = setTimeout(() => ttsSpin(tk), run.gap != null ? run.gap : 220);
  };
  u.onerror = (ev) => {
    if (tk !== TTS._tok) return;
    clearTimeout(TTS._wd); TTS._wd = null;
    const err = (ev && ev.error) || '';
    if (err === 'interrupted' || err === 'canceled') return;        // cancel 的正常副作用
    TTS._fail = (TTS._fail || 0) + 1;
    if (TTS._fail <= 6 && ttsNextVoice(lang) && /unavailable|synthesis|language|not-allowed|no-voice/i.test(err)) {
      TTS._timer = setTimeout(() => ttsSpin(tk), 160);              // 换个音色再试
      return;
    }
    if (TTS._fail > 6) { finish(); return; }                        // 设备根本读不出声：安静收尾
    endLine();
    TTS._i++;                                                        // 单句失败不拖垮整段
    TTS._timer = setTimeout(() => ttsSpin(tk), 60);
  };
  try {
    speechSynthesis.speak(u);
    // 看门狗：部分移动浏览器会静默失败（既没有 onstart 也没有 onend），
    // 不给它兜底就会永远卡在这一句上，后面的内容全读不出来。
    clearTimeout(TTS._wd);
    TTS._wd = setTimeout(() => {
      if (tk !== TTS._tok || started) return;
      TTS._fail = (TTS._fail || 0) + 1;
      if (TTS._fail > 6) { finish(); return; }
      TTS._i++;
      ttsSpin(tk);
    }, 3600);
  }
  catch (e) { TTS._i++; TTS._timer = setTimeout(() => ttsSpin(tk), 80); }
}
/* 单句快读：小A 的鼓励语、提示语 */
function ttsSay(text, rate) {
  if (!TTS.supported || !TTS.on || !text) return;
  const old = TTS.rate;
  if (rate) TTS.rate = rate;
  ttsSpeak([String(text)], {});
  TTS.rate = old;
}
/* 当前是否在朗读（供 UI 切按钮状态） */
function ttsBusy() { return TTS._speaking; }

/* ---------- 高亮工具 ---------- */
let TTS_HL = [];
function ttsMark(i) {
  TTS_HL.forEach((el, k) => {
    if (!el || !el.classList) return;
    el.classList.toggle('hl', k === i);
  });
  if (i >= 0 && TTS_HL[i] && TTS_HL[i].scrollIntoView) {
    try { TTS_HL[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
  }
}

/* ---------- 一年级风格的播报脚本 ---------- */
function ttsStripSummary(s) { return String(s || '').replace(/小结[：:][^。！？]*[。！？]?/g, '').trim(); }
function ttsLearnLines(lv, n) {
  const body = ttsSplit(ttsStripSummary(lv.story));
  const sum = (String(lv.story || '').match(/小结[：:]([^。！？]*[。！？]?)/) || [])[1];
  const L = [];
  L.push({ t: '小朋友，我们一起来学第 ' + n + ' 关，' + lv.name + '。', p: 620 });
  L.push({ t: '先记住这一句。' + lv.one, p: 700 });
  if (body.length) {
    L.push({ t: '别着急，小A 慢慢讲给你听。', p: 560 });
    body.forEach(s => L.push({ t: s, p: ttsGap(s) }));
  }
  if (sum && sum.trim()) L.push({ t: '最后记住：' + sum.trim(), p: 560 });
  L.push({ t: '这一关你学会了吗？我们来做三道小题，试试看！', p: 300 });
  return L;
}
function ttsQuestionLines(lv, idx) {
  const q = lv.questions[idx];
  const L = ['题目是：' + q.q];
  const ci = 'ABCD'.indexOf(q.correct);
  const isTF = q.opts.length === 2 && q.opts[0] === '对';
  if (isTF) {
    L.push('你认为这句话，是对，还是错呢？');
  } else {
    q.opts.forEach((o, i) => L.push('第 ' + (i + 1) + ' 个：' + o));
    L.push('想一想，哪一个才是对的呢？');
  }
  return L;
}
function ttsFeedbackLines(q, picked, ci) {
  const L = [];
  if (picked === ci) {
    L.push({ t: ttsPraise(), p: 420 });
    if (q.ex) L.push('为什么呀？' + q.ex);
  } else {
    L.push({ t: '没关系，我们一起看看。', p: 400 });
    L.push('正确答案是：' + q.opts[ci] + '。');
    if (q.ex) L.push(q.ex);
    const ofb = (q.optFb && q.optFb[picked]) ? q.optFb[picked] : '';
    if (ofb) L.push(ofb);
  }
  return L;
}
const TTS_PRAISE = ['太棒了！', '答对啦，你真厉害！', '真聪明！', '完全正确，好厉害呀！', '又答对了，继续保持！'];
let _praiseI = 0;
function ttsPraise() { return TTS_PRAISE[(_praiseI++) % TTS_PRAISE.length]; }

/* ---------- 按钮渲染工具 ---------- */
function ttsBtnHTML(id, label, onclick, extra) {
  if (!TTS.supported) return '';
  return '<button class="ttsbtn ' + (extra || '') + '" id="' + id + '" onclick="' + onclick + '">' + label + '</button>';
}
function ttsSyncMain(btn, speaking) {
  const b = (typeof btn === 'string') ? document.getElementById(btn) : btn;
  if (b) b.classList.toggle('playing', !!speaking);
}
