---
name: knowledge-to-agent
description: "Turn any knowledge-base files (HTML/Markdown) into a gamified, agent-capable single-file H5 web app — with built-in AI text-to-speech (per-language voice switching), offline RAG, L3 autonomous quiz generation, learner profile, spaced-repetition star map, pluggable AIPlugin layer, a responsive layout for both PC and mobile, WeChat-compatible in-app-browser handling, and a one-shot delivery pipeline that defaults to a permanent public cloud link (https://<id>.app.workbuddy.link) + WeChat-scannable QR poster + offline single-file + PDF + demo video, with a built-in WeChat readiness checker (wechat_check.py)."
description_zh: "把任意知识库文件（HTML/Markdown）转成游戏化、可运行智能体的单文件 H5。含 AI 语音朗读（按语言自动切音色、中英文语速分档）、离线 RAG、L3 自治出卷、学习者画像、遗忘曲线星图、可插拔 AIPlugin；PC 与手机双端自适应；微信生态适配（内置浏览器兼容 + 微信可识别二维码 + 微信可打开性体检）；并默认交付永久公开的云端链接（https://<id>.app.workbuddy.link）+ 二维码海报 + 离线单文件 + PDF + 演示视频。"
description_en: "Convert knowledge files into a gamified, agent-capable single-file H5 with AI speech (per-language voice switching), offline RAG, autonomous quiz, spaced repetition, PC+mobile responsive layout, WeChat in-app-browser compatibility, WeChat-scannable QR posters, and a delivery pipeline that defaults to a permanent public cloud link plus QR poster and offline build."
version: 2.2.0
---

# Knowledge → Agent（知识库→游戏化智能体 H5）

把一套"知识文件"变成一个可玩、可听、可对话、可自学习的游戏化智能体 H5。**引擎与知识完全解耦**：换一份知识库 = 换一个学科，引擎代码零改动。这是该技能最核心的卖点，也是向评审方/用户证明"通用性"的最佳方式。

## When to Use

- 用户有知识库/题库（课程、科普、规章、产品知识、内部培训等），想做成闯关式学习产品
- 需要**听读能力**（语言学习、儿童/长者用户、开车或做家务时学）→ 用内置 AI 语音朗读
- 需要在 **WorkBuddy 静态托管** 上交付一个零后端、可分享的 H5 → **默认就发布成 `https://<id>.app.workbuddy.link`**（永久公开、不依赖本机开关机）
- **重点：要发到微信里传播**（群里发链接、朋友圈发海报）→ 必须过「微信生态交付」两段验收：
  二维码微信扫得出 + 链接微信打得开。注意默认宿主会拦微信 UA，详见该章节
- 需要**PC 与手机都能正常看**的成品 → 模板已内建响应式布局（见「跨端适配」章节）
- 想要"智能体"体验但又不想/不能暴露 API Key 时 → 默认走预生成兜底，填 Key 即升级真对话
- 参加"AI 智能体 / 知识游戏化"类活动征集，需要快速产出可演示成品
- 需要配套的**对外物料**：在线链接、**据内容生成的二维码海报**、可转发的离线单文件、PDF 文档、演示视频

## 架构（三层解耦）

```
kb_parse.py    → 解析源文件，输出 levels_<scene>.json（统一 Schema）
kb_enrich.py   → 补全 alt(换种说法) / 逐选项反馈 optFb / 缺解析题 ex
gen_questions.py→ 题型转换为少题关卡补到 3 题（凑满配题数）
merge_kb.py    → 合并所有场景 + 既有关卡 → levels_all.json
build_index.py  → 把 KB + app_core.js + app_ui.js + template.html 拼成单文件 index.html
test_harness.js → Node + DOM 桩跑全流程冒烟测试
```

运行时三层：
1. **数据层** `KB / SCENES / RANKS` 全局变量（由 build_index 内联进 HTML）
2. **核心引擎** `app_core.js`：AIPlugin 三实现、RAG 倒排索引、学习者画像、遗忘曲线、星图衰减、XP、连续学习、L3 出卷 `generatePaper` / `recommendPath`
3. **UI 层** `app_ui.js`：首页/场景地图/星图/学习/答题/反馈/对话面板/设置

## 统一关卡 Schema（levels_*.json）

```jsonc
{
  "<scene>:<n>": {
    "id": 1, "name": "关卡名",
    "one": "一句话解释",
    "story": "大白话讲解（多句，可含类比/举例）",
    "examples": ["生活例子1", "生活例子2"],
    "alt": "换一种说法（预生成兜底用）",
    "questions": [
      {
        "q": "题干",
        "opts": ["A…","B…","C…","D…"],   // 2~4 项
        "correct": "A",                   // 正确选项字母
        "ex": "解析（为什么对/错）",
        "optFb": ["","「B」不对——…","…","…"]  // 逐选项反馈，正确项空串
      }
    ]
  }
}
```

源文件普遍**没有 `alt` 字段**，且部分关卡 `questions` 不足 3 题、缺 `ex`——这两个缺口必须由 `kb_enrich.py` / `gen_questions.py` 在构建期补，不要指望运行时生成。

## AI 语音朗读（TTS，按语言自动切音色）

语言类学科（英语等）内容多为**中英混排**，如 `red红色，blue蓝色`。整段丢给 TTS 会用中文腔读英文，体验极差。做法是**先按语言分段，再逐段指定音色朗读**。

用**系统 TTS（Web Speech API）**而非云端合成：零依赖、零成本、可离线、无 Key 泄露风险，单文件 H5 必须如此。

### 1. 分段 `splitByLang(text) → [{t, lang}]`

逐字符判定，连续同类字符累积成段；**空格与标点归属当前段**（保证 `A B C` 不断成三段、`don't` 不被撇号切断）；数字跟随上下文语言。

```js
const isZH=c=>/[\u4e00-\u9fa5\u3001\u3002\uff0c\uff01\uff1f\u201c\u201d\uff08\uff09]/.test(c);
const isEN=c=>/[A-Za-z]/.test(c);
// 逐字符：isZH→"zh"；isEN→"en"；数字→沿用 bufLang；其他(空格/标点)→沿用 bufLang
// 语言切换时 push 前一段并开新段
```

实测效果：
- `red红色，blue蓝色` → `[en]red | [zh]红色， | [en]blue | [zh]蓝色`
- `don't worry，慢慢来。` → `[en]don't worry | [zh]，慢慢来。`
- `A B C D E…Z。` → `[en]A B C … Z | [zh]。`

### 1.5 ⚠️ 拼音字母不能按英文字母念（母语启蒙类必须处理）

**实测踩坑**：小学语文拼音题库里，点读 `b` 时被判为英文 → TTS 念 /biː/（"比"），而小学教学要求念 /bo/（"玻"）。`p/m/f/d/t/n/l/zh/ch/sh` 全部同理。**这是母语启蒙产品的致命错误**，必须专门处理。

**实现机制（已在 `assets/tts.js` 落地，实测通过）**：

拼音修复的核心**不在"猜这段 Latin 是不是拼音"**，而是**按场景门禁**——

- 每个关卡带入 `TTS.scene`：`openLevel(id,n)` 里设 `TTS.scene = lv.scene || 'zh'`（语文/数学类场景 lv.scene 为 'chinese'/'math'，英语场景为 'english'）。语文类场景（含拼音）里，所有 Latin 字母一律当**拼音**走中文音色；英语场景里，Latin 一律当**英文**走英文音色。
- `ttsRuns(seg, defaultLang)`：`defaultLang` 取 `TTS.scene==='english' ? 'en' : 'zh'`，也可由 `ttsSpeak(...,{lang})` 显式覆盖。分段后对每段做拼音识别：
  - 含声调符号（`āáǎà ōóǒò ēéěè īíǐì ūúǔù ǖǘǚǜ ü ǹ ḿ ɡ`）→ 必是拼音 → 强制 `zh`；
  - 否则 `defaultLang==='zh' && 含字母` → 拼音 → `zh`；英文场景则保持 `en`。
- `ttsClean` 里先 `ttsDetone`：声调符号归一为基字母（`bà`→`ba`），否则清洗会把元音整个删掉、读成 "b" 丢了 "a"。`ü / ɡ` 也保留在清洗白名单里。
- 中文 TTS 朗读 Latin 字母时会按**汉语拼音字母表**发音（b=玻 / p=坡 / m=摸 / f=佛 / a=啊 …），正好是孩子要学的；英文音色才会念成 "bee / eye"。所以"拼音 → 中文音色"即天然正确。

**为什么用场景门禁而非内容启发式**：纯靠字符/长度猜是否拼音，会遇到 `apple`(5 个合法拼音字母) 误判成拼音、`zhuang`(6 字符) 误判成英文、`he/she/it` 与拼音冲突等**无解歧义**。按场景门禁后这些反例**根本不出现**——英语场景的 Latin 永远是英文，语文场景的 Latin 永远是拼音，零误判。（若未来要在同一关内混入英文词与拼音，再升级为音节白名单判定。）

**回归测试**：`assets/test_harness.js` 第 23 项断言——① 带声调拼音必走中文音色 ② 单字母拼音（a o e i u ü b p m f）在中文关必走中文音色 ③ 全库 `chinese:*` 故事里任何含 Latin 的朗读段都不得误分英文 ④ `bà ba` 清洗后不丢元音（`ba ba`）⑤ 英文场景的英文仍走英文音色（不被误伤）。`scripts/tts_check.py` 浏览器实机另加"拼音段用中文自然音色（非 Zira）"断言。当前 **单元 24/24 + 浏览器 101/101** 全过。

### 2. 音色选择 `pickVoice(lang)`

`_voices.find(v => v.lang.toLowerCase().startsWith(lang))`，找不到再按名字兜底（中文 `Chinese|Yaoyao|Xiaoxiao`，英文 `English|Samantha|Karen`）。
⚠️ `getVoices()` 首次常返回空数组，必须监听 `speechSynthesis.onvoiceschanged` 重新加载。

### 3. 全局语速（在【设置】里调，0.5x–2x）

单一全局变量 `voiceRate`，写 localStorage，**全应用统一生效**：

```js
let voiceRate = parseFloat(localStorage.getItem("xiaoA_rate")||"1");
// 应用时叠加基准：中文 1.0、英文 0.9（英文略慢便于听清）
u.rate = (sg.lang==="zh" ? 1 : 0.9) * voiceRate;
```

设置面板用 `<input type="range" min="0.5" max="2" step="0.1">`。
⚠️ 拖拽时**不要重渲染面板**（会打断拖拽），`setRate()` 只更新数值显示；也不要弹 toast（拖拽会刷屏）。

### 4. 打断控制

用递增 token 作废旧播放序列，避免切页后旧语音继续念：

```js
let _speakToken=0;
function stopSpeak(){ _speakToken++; try{speechSynthesis.cancel();}catch(e){} }
function speakText(text,btn){ stopSpeak(); const token=++_speakToken; /* 每段 next() 首行校验 token */ }
```

### 5. 接入点

| 位置 | 行为 |
|------|------|
| 顶栏 🔈 | 语音总开关（存 localStorage，默认开）——**顶栏只放这一个声音按钮** |
| 顶栏 ⚙️ | 打开设置（分组呈现：🔊 声音 = 语音开关/语速/小提示音；👀 显示 = 长辈模式） |
| LEARN 页 | 进关自动朗读 `name+one+story`；讲解与故事各有小喇叭；底部"⚙️ 语音设置（语速 Nx）" |
| QUIZ 页 | 题干喇叭自动朗读；**每个选项独立喇叭**（点单词听发音，语言学习刚需） |
| 答题后 | 解析区"🔊 听解析"，朗读"答对了/正确答案是 X" + 解析 |

⚠️ 选项喇叭必须 `event.stopPropagation()`，否则点了喇叭会误触发答题。

⚠️ **顶栏绝不能同时出现「🔊 音效」和「🔈 语音」两个声音按钮** —— 用户实测反馈"引起使用混乱"，会分不清哪个管什么。正确分工：

- **AI 语音朗读**（TTS，念知识内容）→ 唯一的声音图标留在顶栏，因为它是核心功能、使用频率最高
- **简易提示音**（点击/对错音效）→ 收进「设置 → 🔊 声音 → 🔔 小提示音」，不进顶栏
- 设置面板里用**分组标题**（🔊 声音 / 👀 显示）把两类开关隔开，并把音效改名为"小提示音"（不要叫"答题音效"，与"语音朗读"字面太近），副标题写清"不影响语音朗读"

⚠️ **带文字的朗读按钮不要复用 `.spk`**：`.spk` 是 `26×26` 的纯图标方按钮，塞「🔊 听解析」这种文字会换行错乱（实测截图可见）。另设一个 `.spk-wide`（inline-flex + `white-space:nowrap` + padding），保持同色系但能容纳文字。

## 跨端适配（PC / 手机必须同时可用）

交付给客户时手机和 PC 都会被打开，而且**扫码的人几乎都在手机上**，所以两端都得真跑一遍，不能只按手机比例做。

`assets/template.html` 已内建**移动优先**的响应式布局，**引擎代码零改动**（换知识库/学科不用碰布局）：

| 断点 | 布局 |
|------|------|
| `≤380px` | 小屏压缩：网格列数与字号同步收紧 |
| `<600px` | 单列手机原生观感（弹层为底部抽屉） |
| `≥600px` | 平板双列；`.scene` / `.map-block` 自动并排 |
| `≥900px` | 桌面三列主网格，阅读区（`.level/.note/.path-box`）收窄居中；`.opts` 选择题双列；弹层改居中卡片 |
| `≥1440px` | 超宽屏再放宽画布 |
| 横屏矮屏 | `max-height:460px and orientation:landscape` 收紧纵向留白 |

### 三个必踩的坑

1. **响应式只写 CSS，不在 JS 里判断屏幕宽度**：`.screen{display:grid}` + `.screen>*{grid-column:1/-1}` 让所有区块默认通栏，再单独放行要并排的元素（`.screen>.scene,.screen>.map-block{grid-column:auto}`）；用 `:has()` 让**不同页面自动选布局**（`.screen:has(.lvgrid)` 走两栏、`.screen:has(.level)` 垂直居中）。**新增区块因此不需要写任何响应式代码**。
2. **flex 子元素该定宽的要 `flex:none`**：`.iconbtn{width:34px}` 不写 `flex:none`，窄屏会被 flex 压成 22px（图标变形）。凡"固定尺寸且不该缩"的（logo、图标按钮、开关）都要显式 `flex:none`。
3. **藏按钮前先把入口搬走**：手机端顶栏放不下时，把次要入口（音效、轨迹）收进【设置】面板，**先确认面板里已有该入口，没有就补一个**，否则功能静默丢失；被隐藏的按钮若会被 JS 按 id 取用，必须保留 `if(el)` 空值保护。

### 收敛而不砍功能的手法

- 长文字 chip 拆成 `<span>图标</span><span class="lv-name"> 名字</span>`，窄屏只 `display:none` 隐藏 `.lv-name`，信息线索还在
- 次要按钮加 `.iconbtn.aux`，窄屏整体 `display:none`
- 悬停反馈只装在 `@media (hover:hover) and (pointer:fine)` 里，触屏不残留高亮；并保留 `@media (prefers-reduced-motion:reduce)` 降级

### 验收：不能只看截图，要量出来

⚠️ **必做**：Playwright 分别以 **390×844（手机）** 与 **1440×900（PC）** 打开成品，断言
`document.documentElement.scrollWidth <= window.innerWidth`、无元素重叠（逐元素比 `getBoundingClientRect()`）、主按钮可点。
仅凭"我在 PC 上打开看着正常"不算双端验证。

- 覆盖 **4 档视口**：1440×900 / 820×1000 / 390×844 / 360×780
- 断言 **无横向溢出**：`body.scrollWidth === window.innerWidth`，并逐个元素查 `right > innerWidth + 1.5`
- 断言 **元素未被压竖**：`logo.width >= logo.height`、`iconbtn.width === 34`（或窄屏 30）
- 覆盖 **3 类页面**：首页 / 场景页（查 `.lvgrid` 列宽与 `.lv` 尺寸）/ 学习页（查卡片宽度）——只验首页会漏掉内页问题
- 顺带断言 **零控制台错误**（`page.on('pageerror')`）

## 工作流（标准步骤）

1. **解析**：`python kb_parse.py` 切分各场景源 HTML → `kb/levels_<scene>.json`。
   - 源文件常见坑：题干与选项挤在同一行（`1. 税的本质？ A.…`），解析器必须先拆行再分选项，否则 A 选项会丢失。
2. **增强**：`python kb_enrich.py` 生成 `alt`、逐选项 `optFb`、补齐缺的 `ex`（素材取自 `one/story/examples`，绝不编造）。
3. **补题**：`python gen_questions.py` 把不足 3 题的关卡用"题型转换（判断/填空）+ 同场景真实内容作干扰项"补齐。
4. **合并**：`python merge_kb.py` → `kb/levels_all.json`。
5. **拼装**：`python build_index.py` → `index.html`（单文件，可直接静态托管）。
6. **测试**：`node test_harness.js`（应 **23/23** 全过）。改过断句/清洗/音色/布局后**必须重跑**——
   这类问题不会报错，只会静默读错或静默溢出。
7. **部署**：发布为 `https://<id>.app.workbuddy.link`（**默认推荐动作、永久公开、不依赖本机开关机**，见下节）。
   ⚠️ 该宿主**不支持微信内打开**（实测 403），微信场景见「微信生态交付」。
8. **出物料**：据成品内容自动生成二维码海报 + 离线单文件（**默认动作，见下节**）。
9. **双端自检**：手机 390×844 与 PC 1440×900 各实测一遍（见「跨端适配」章节）。
10. **微信体检**：`python scripts/wechat_check.py --url <链接> --html index.html --poster 扫码海报.png`
    —— 决定海报能不能写"微信扫码即玩"，也决定要不要换宿主。**没跑过这一步就不要对外承诺微信可用。**

## 交付链路（强制门禁，不是可选项）

⚠️ **每次生成/更新成品后，以下动作是默认必做项，不需要用户开口要**。少一件都算交付不完整——"能发出去给人玩"才是这个技能的终点，本地能打开不算完成。

**默认推荐形态 = 一条永久公开的在线链接。** 成品一律优先发布为 `https://<id>.app.workbuddy.link`（WorkBuddy 内置静态托管），并**根据这份成品的内容**自动生成配套二维码海报（标题、副标题、统计数字、卖点文案都取自成品本身，不要套别的项目模板）。这条链接托管在云端、**永久公开、与本机开关机无关**：用户关机、退出程序、换电脑、断网都不影响别人访问，只有用户在「设置 - 数据管理 - 我发布的应用」里主动删除才会失效。离线单文件是**双保险**，不是在线链接的替代品——不要拿"给个本地文件"糊弄过去。

### 交付门禁清单（全部 ✅ 才算完成）

| # | 动作 | 工具 | 判定标准 |
|---|------|------|----------|
| 1 | **在线链接（默认推荐形态）** | 部署工具（见下） | 产出 `https://<id>.app.workbuddy.link`；`curl -sL <链接>` HTTP 200 且内容含最新特征串 |
| 2 | **链接公开性体检** | `curl -s -o /dev/null -w "%{http_code}" -L <链接>` | **必须 200**。401/403/密码页/跳登录页 → **拒绝烧二维码**，退回让用户换链接 |
| 3 | **微信 UA 体检（本次重点）** | `python scripts/wechat_check.py --url <链接> --html index.html --poster 扫码海报.png` | 用真微信 UA 复测。**`*.app.workbuddy.link` 实测返回 403**（宿主策略，详见「微信生态交付」）→ 必须降级文案或换宿主，**不得在海报上写"微信扫码即玩"** |
| 4 | **二维码海报（据内容生成）** | `python scripts/make_qr_poster.py` | 指向第 1 步链接；脚本内置**原图反解 + 微信压缩链路反解**双校验，任一不过 `exit 1`；海报数字 = 成品真实可玩数 |
| 5 | **双端自适应** | Playwright 手机 390×844 + PC 1440×900 | 两档视口都无横向滚动、无重叠、按钮可点（详见「跨端适配」章节） |
| 6 | 离线单文件 | `cp index.html XXX-离线版.html` | Playwright `offline:true` + `file://` 实测可玩 |

### 1. 云端部署链接
把干净的 `index.html` 单独放进一个 deploy 目录（**不要**带构建脚本/视频等无关文件），发布后拿到 `https://<id>.app.workbuddy.link`。
- **默认就做这一步，不用等用户说"帮我部署"**——"本地能打开"不是交付完成。
- 链接托管在云端沙箱，**永久公开、与本机开关机无关**；用户关机、退出程序、换电脑都不影响访问，只有在「设置 - 数据管理 - 我发布的应用」中主动删除才会失效。
- 改了内容 → 重新发布**同一目录**，链接不变、内容即时生效（海报二维码无需重做）。
- 若部署工具临时不可用：①先用本地 `python -m http.server` 给用户可玩的演示地址；②交付离线单文件作为兜底；③在最终回复里明确说明"云端链接待部署工具恢复后补发"。

### 1.5 链接公开性体检（烧二维码前的硬闸门）
**用户给的链接一律先体检再烧码。用户在浏览器里能打开 ≠ 公开可访问**——登录态会掩盖访问门禁，
用户自己点得开、别人扫码撞密码墙，是这类交付最容易翻车的地方。

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L "https://待验链接"
```

- 必须 `200`。出现 `401/403`、密码页、跳登录页、跳 `app.netlify.com/edge-access` → **停止出海报**，
  把真实响应原样贴给用户，让他换链接或改公开设置。**不要**照用户给的命令硬跑 `make_qr_poster.py`。
- 已知"看起来成功、其实发不出去"的托管形态：Netlify 匿名拖拽（加访问门禁 + 只活 1 小时）、
  Netlify 新团队默认 **private**（访客一律 401，点一下 **Make public** 即可修复，不必重传）、
  Vercel Drop（强制登录后才给 URL）。
- 本技能约定的正式云端链接只有 `*.app.workbuddy.link`（内置发布工具产出），这个形态天然公开。

### 2. 二维码海报（一键脚本，文案取自成品内容）
**海报是对外物料的第一眼**，标题/副标题/统计数字/卖点都要**从这份成品里取真实值**，不要套别的项目模板。

```bash
python scripts/make_qr_poster.py --url <云端链接> \
  --title "小A · 知识闯关" --subtitle "AI 语音陪学 · 中英文自动切音色" \
  --stats "6|知识场景" "247|可玩关卡" "741|道题目" \
  --points "扫开即玩，无需下载注册" "AI 语音朗读，中英文自动切换音色" \
           "语速 0.5x-2x 自由调节" "断网也能玩，离线单文件永久可用" \
  --out 扫码海报.png
```
脚本内置的硬保障（不要绕过）：
- QR 容错等级 **H**（可遮挡/蹭脏 30% 仍可扫）
- **微信可识别的四项硬指标**（2026-09-10 加固，都是实测踩出来的）：
  | 指标 | 值 | 为什么 |
  |---|---|---|
  | 静区（border） | **≥ 4 模块** | ISO/IEC 18004 要求；旧版用 3，微信长按识别经常认不出来 |
  | 前景色 | **纯黑 (0,0,0)** | 品牌紫在屏幕反光 + 微信二次压缩下对比度不足；`--qr-fg` 可改但会明显降识别率 |
  | 模块尺寸 | **整数倍**，≥ 4px | 旧版 `resize(330)` 让模块忽 7px 忽 8px（混叠）；现按整数 box 直接出图，**不再 resize** |
  | 成品内尺寸 | **≥ 300px** | 太小微信会把码当"装饰图"直接忽略 |
- **两道反解校验**，任一不过 `exit 1`：① 原图反解（URL 一致）② **模拟微信压缩链路**（720px 宽 + JPEG q55 + 高斯模糊 0.8）后仍能解出
- 同时自动导出**独立二维码大图**（默认 `<海报名>-二维码.png`，约 795px）——视频、PPT、印刷、以及"没法长按识别"的场景都用它；`--no-qr-file` 可关
- 纯 PIL 绘制，零 Playwright 依赖；跨平台中文字体自动探测；emoji 会被渲染成方框，文案里**不要放 emoji**
- 输出约 66KB，微信转发无压力
- 海报上的数字（关卡/题目数）必须与成品真实值一致，否则扫码后观感落差大
- **烧码前必须先做链接公开性体检 + 微信 UA 体检**，别产出指向密码墙、或扫码后会被拦的二维码
- 海报上写"微信扫码即玩"**有前提**：必须先跑过微信 UA 体检；宿主被拦时改文案，见「微信生态交付」
- **宿主不支持微信内打开时**用这组文案：
  `--tip "扫码即玩 · 建议在浏览器打开" --tip2 "微信内请点右上角 ··· → 在浏览器打开"`

### 3. 离线单文件（永久双保险）
把 `index.html` 复制为独立文件（如 `XXX-离线版.html`）。成品天然 100% 自包含，可直接微信发送、拷 U 盘、丢任意静态托管。
- 交付前用 `grep -E '(src|href)="[^"]*"'` 确认**零外部资源引用**、用 `grep -o 'https\?://'` 确认**零网络请求**。
- 用 Playwright `newContext({offline:true})` + `file://` 协议实测一遍完整闯关，确认断网可玩。
- ⚠️ **微信里不能直接打开 `.html` 文件**（点开只有"用其他应用打开"）。所以离线单文件是"备给电脑/邮箱/网盘"的兜底，**不能当成微信可用的交付**。

### 附：PDF 与演示视频（按需）
- **PDF**：Playwright + Edge 内核，`printBackground:true` 保留卡片/表格背景；**渐变文字必须回退为实色**（打印时透明字会消失）；A4 + 14mm 边距。
- **视频**：Playwright 录屏（`recordVideo`）→ `edge-tts` 分段中文配音 → `numpy` 合成音效 → `ffmpeg` mux 成 1080P MP4。

## 微信生态交付（扫得出 + 打得开，两件都过才算数）

对外分享 90% 发生在微信里，所以"微信里能不能用"是**验收线**，不是加分项。这条线要分两段看：

| 环节 | 用户动作 | 失败表现 |
|------|---------|---------|
| ① 识别 | 扫一扫 / 长按识别海报 | 微信"没识别到二维码"，或识别成乱码 |
| ② 打开 | 点开识别结果 | 停在"请在浏览器中打开" / 微信拦截页 / 白屏 |

`scripts/wechat_check.py` 一次把两段都验掉：

```bash
python scripts/wechat_check.py --url <云端链接> --html index.html --poster 扫码海报.png
```

输出【A】链接 /【B】meta /【C】受限 API /【D】二维码 四段，任一 FAIL 就 `exit 1`。

### ⚠️ 已实测的硬约束：默认宿主不让微信内打开

**实测（2026-09-10，可复现）**：`*.app.workbuddy.link` **对任何含 `MicroMessenger` 的 UA 一律返回 HTTP 403**，
返回的是平台自己的页面，原文：

> 当前应用不支持在微信内打开，请复制链接后在浏览器（Safari / Chrome 等）中访问。

一条命令就能定性：

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L -A "MicroMessenger/8.0.49" "https://<id>.app.workbuddy.link"  # → 403
curl -s -o /dev/null -w "%{http_code}\n" -L -A "Mozilla/5.0 Chrome/120"  "https://<id>.app.workbuddy.link"  # → 200
```

- iPhone Safari 的 UA → 200；安卓微信 UA **去掉** `MicroMessenger` 字样 → 200。
  **只有带 `MicroMessenger` 才 403** → 是**宿主按 UA 主动拦**，不是微信拦域名，也不是链接失效。
- 平台侧没有开关（已查 `app.asar`：`enableWechatmp` 是"公众号 IM 通道"，与静态托管无关）。
- **影响**：二维码扫得出来（① 能过），但点开停在"请在浏览器中打开"。
  所以**默认链接在微信里等于打不开**，海报文案不能承诺"微信扫码即玩"。

**两条出路，交付时二选一，并在回复里说清选了哪条：**

**A. 换宿主** —— 唯一能让"微信里直接打开"成立的方案。`index.html` 不用改，只换托管。平台级实测：

| 托管 | 域名形态 | 微信 UA 实测 | 备注 |
|---|---|---|---|
| Cloudflare Pages | `*.pages.dev` | ✅ 200 | 需自有账号 |
| GitHub Pages | `*.github.io` | ✅ 200 | 需自有仓库 |
| Netlify | `*.netlify.app` | ✅ 200 | 注意访问门禁，见「1.5 链接公开性体检」 |
| Vercel | `*.vercel.app` | ⚠️ **未验证** | 本机沙箱未连通，用前必须自己跑一遍 `wechat_check` |

> 上表是**平台级**验证（探测平台自身域名），不等于你的站点一定通。
> 换完宿主**必须**再用 `wechat_check.py` 复验，通过才算数——没验过就不要在回复里写"微信可打开"。

**A2. 让「push 即上线」成立**（省掉每次手动上传，交付/迭代阶段强烈建议先做掉）

| 宿主 | 自动部署前提 | 实测结论 |
|---|---|---|
| GitHub Pages | 仓库 Settings → Pages → Source 选 `main` + 根目录（或 `/docs`） | ✅ 设置一次，之后 `git push` 自动重建 |
| Netlify | 站点必须**关联仓库**且**已装 Netlify GitHub App** | ⚠️ **匿名拖拽建的站点不会**随 `git push` 部署，必须补这一步 |

- **判定 Netlify 是否真接上**：`netlify api listSites` 看该站点 `repo` 字段——
  为 `null` 就是纯手动站点；`netlify api getSite` 再看 `build_settings.installation_id`，
  为 `null` 说明 GitHub App 未装。两者都齐才算真自动部署。
- **补装入口**：<https://github.com/apps/netlify/installations/new> → Only select repositories → 选中该仓库。
  注意 `updateSite` 写入 `repo_url`/`repo_branch` **不等于**接通（`repo` 仍为 `null`），必须走 App 授权。
- 先手工拖过一次、事后想转自动部署的站点，**链接域名不变**，不会废掉已发的二维码海报。

**A3. 往 Git 仓库推成品时的两个硬约束**

1. **必须**在仓库根加 `.gitattributes` 写 `index.html -text`。全局 `core.autocrlf=true` 会把成品的
   CRLF 归一成 LF（实测 377164→374850 字节），线上文件与"已验证过的构建"不再逐字节一致。
2. **核验远端内容要用 Git 对象 API**：`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`
   取 `index.html` 的 `size`/`sha`，与本地 `git hash-object` 比对。
   `raw.githubusercontent.com` 有 CDN 缓存，刚 push 完可能仍返回旧内容，**不要据此判定推送失败**。

**B. 留在默认宿主，改文案** —— 成本最低，但微信内仍需用户手动跳一次：
- 海报用：`--tip "扫码即玩 · 建议在浏览器打开" --tip2 "微信内请点右上角 ··· → 在浏览器打开"`
- 回复里必须写明微信内的实际表现，不能含糊过去。

### 微信内置浏览器适配（引擎已内置，改布局时别删）

| 位置 | 内容 | 不做的后果 |
|---|---|---|
| `<head>` meta | `format-detection=telephone=no` | 知识内容里的 `(2)`、`3:1` 被识别成电话/日期，点一下弹"呼叫" |
| `<head>` meta | `x5-orientation` / `x5-page-mode` / `x5-fullscreen` | 安卓微信（X5 内核）横屏错乱、上滑露底 |
| `<head>` meta | `og:title` / `og:description` | 转发出去的卡片没标题没描述 |
| CSS | `overscroll-behavior-y:contain` | 下拉回弹露出白底 |
| CSS | 小屏 `input{font-size:16px}` | iOS 微信聚焦输入框时**强制放大整页**，而且回不去 |
| CSS | `body{-webkit-touch-callout:none}` | 游戏页长按弹系统菜单；页面内需长按识别的 `<img>` 加 `.qr-inline` 把菜单放回来 |
| JS | **不出现 `confirm()/alert()/prompt()/window.open()`** | iOS 微信**静默屏蔽**（不报错、直接返回 false）——"清空进度"点了没反应 |
| JS | `navigator.share` 在微信里不可用 | 分享按钮变哑巴；已改为"点右上角 ···"引导弹层 |

`wechat_check.py` 的【C】段会在源码里扫这些禁用 API（先剥注释再扫），写新交互时别再引回来。

### 二维码渲染规范（微信侧）

已全部落在 `make_qr_poster.py`，这里只记"为什么"，改脚本前先看：

- **静区 ≥ 4 模块**：ISO/IEC 18004 要求。旧版 `border=3`，海报上的码经常扫不出。
- **纯黑前景 + 纯白底卡**：二维码必须落在一整块**纯白卡片**上，不能压在紫色渐变上——微信扫一扫对
  "码周围不是纯白"的图识别率明显下降（海报里为此专门画了白卡）。
- **整数倍模块、绝不 resize**：非整数缩放让模块宽度忽 7px 忽 8px，解码率下降。
- **必须过"模拟微信压缩链路"**：海报在微信里会被二次有损压缩，所以校验要走一遍
  「720px 宽 → JPEG q55 → 高斯模糊 0.8」仍能解出；只验原图不算过关。
- 另出一张 **795px 独立二维码**：视频 / PPT / 印刷 / "没法长按"的场景都用它。
- ⚠️ 不要在页面上用 CSS 背景图放二维码（长按识别不到），要用真实 `<img class="qr-inline">`。

### 交付话术模板（宿主被拦时照抄）

> ✅ 电脑 / 浏览器：直接扫码即可打开
> ⚠️ 微信内：会提示"请在浏览器中打开"，点右上角 `···` → 在浏览器打开即可
>　　（这是托管平台对微信 UA 的限制，不是链接坏了）
> 📄 离线版：`XXX-离线版.html` 断网可玩，但微信里打不开 `.html`，建议发到电脑或邮箱

## AIPlugin 三实现（降级链是重点）

```js
const PregenPlugin = { label:'离线预生成', id:'pregen', online:false,
  async chat(lv,msg){ /* 基于本关+跨关RAG检索，无网络 */ },
  async explain(lv){ return lv.alt||lv.one; },
  async quiz(lv){ … } };
const LLMPlugin  = { id:'llm', online:true, async chat(lv,msg){ /* fetch 直连大模型 */ } };
const CozePlugin = { id:'coze', online:true, async chat(lv,msg){ /* 扣子适配 */ } };

async function ai(kind, lv, ...args){
  const p = activePlugin();                 // 设置页切换
  if(!p.online) return await PregenPlugin[kind](lv, ...args);  // 默认兜底
  try { return await Promise.race([ p[kind](lv,...args),
        new Promise((_,rj)=>setTimeout(()=>rj(new Error('timeout')),8000)) ]); }
  catch(e){ return await PregenPlugin[kind](lv, ...args); }    // 2~8s 超时/失败 → 回落预生成
}
```

**关键约束**：WorkBuddy 静态托管**不支持服务端代理**。浏览器直连大模型 API 会暴露 Key 且跨域受限，因此：
- 不配 Key → 仅预生成（评审方打开即完整体验，零风险）
- 配 Key → 真对话（仅适合自用/演示）
- 正式对外部署建议另加一层 Vercel/云函数代理（引擎层已预留 `AIPlugin` 接口，换 provider 一行搞定）

## 离线 RAG（防幻觉，无需向量库）

`app_core.js` 里的 `RAG` 模块对全部关卡的 `name/one/story/examples/questions` 建**字符 bigram 倒排索引**，`retrieve(query,k,exclude)` 返回相关关卡并带来源引用；命中他关时在对话卡片里渲染**一键跳转**。精度够用，但非语义向量——如需更准可升级为 embedding 检索（仍是离线可行）。

## 学习者画像与遗忘曲线

- `LearnerProfile`：strengths / weaknesses / reviewQueue / consecCorrect / preferredDifficulty。
- **已修复的真实 bug**：复习队列原逻辑只在"连续错 2 次"时入队，导致单关答错 1 题不进队列。改为 `correctCount < total` 即把本关 key 推入 reviewQueue。
- 星图衰减：`markReviewed` 记 `lastReviewAt`，`starLevel` 按 1天/3天/7天 三档变暗，复习后重亮。

## 新增一个学科（最能体现"解耦"）

1. 把该学科知识文件丢进 `kb/`，跑 步骤 1–4 生成 `levels_<new>.json`；
2. 在 `kb/scenes.json` 加一项 `{ name, emoji, color, source, maps:[{name,range:[1,N]}] }`；
3. `merge_kb.py` 自动并入 `levels_all.json`；
4. 重新 `build_index.py` → 新学科即上线，**引擎代码零改动**。

## 关键经验教训（踩过的坑，必看）

### 数字口径
- 首页/海报宣称的关卡与题目数必须 = **真实可玩数**，不能用"地图规划数"充数。曾出现宣称 411 关却只注入 247 关，评审点开空关直接扣分。
- 正确算法：`关卡数 = Object.keys(LV).length`，`题目数 = Object.values(LV).reduce((a,v)=>a+v.questions.length,0)`——**不要**用 `关卡数×3` 估算（存在 2 选项题等不齐的情况）。
- 若地图规划数 > 已撰写数（有占位空关），务必：hero 显示已撰写数、场景卡显示 `可玩 X/Y 关`、页脚说明"其余持续上线中"、空关在地图上置灰加 🔒 且点击只弹 toast 不进入。

### 知识库解析
- **裸 `<` `>` 会被误吞**：数学/物理知识里常有 `0°<锐角<90°`，通用"去标签"正则会把内容和符号一起删掉。正确做法：**先**用正则提取 `<span class="correct">答案</span>`，**再**处理剩余文本，绝不对整块做通用 tag 剥离。
- **2 选项判断题要放行**：源库里有只有 A/B 两项的判断题。引擎用 `"ABC".indexOf(correct)` 判定，2 选项完全兼容，不要用"至少 3 选项"的门槛把整关丢掉。
- **解析文案别重复前缀**：渲染模板里已有"解析："，注入数据时不要再拼一次，否则出现"解析：解析：…"。
- **源文件小瑕疵**：偶有 `<p>…</div>` 标签不配对，正则要写成 `</(?:p|div)>` 兼容。
- 解析器对"题干选项同行"（`1. 题干？ A.…`）敏感，必须先拆行再分选项。

### 浏览器自动化
- **Playwright force click 对内部滚动容器无效**：若页面是 `overflow:auto` 的内滚容器（如 `.screen`），元素在视口外时 `click({force:true})` 仍失败。改用 `page.evaluate` 里 `el.scrollIntoView({block:'center'})` 或直接 `el.click()` / `dispatchEvent(new MouseEvent('click',{bubbles:true}))`。
- **顶层 `const` 不在 `window` 上**：`LV`、`cur` 等顶层 `const`/`let` 无法用 `window.LV` 访问，但 `page.evaluate` 的全局作用域里可直接引用标识符。
- **验证离线可用性**：`browser.newContext({offline:true})` + `file://` 协议，可真实模拟断网双击打开。
- **布局是否修好要「量」出来，不能只看截图**：截图看不出 `position:sticky` 已失效、元素是否被 flex 压扁。必须取 `getBoundingClientRect()` 在滚动前后对比，并断言 `window.scrollY === 0`、`scrollWidth - clientWidth === 0`。详见「跨端适配」章节的验收清单。
- **Node 路径会变**：managed node 版本目录可能是 `22.22.2-2` 这类带后缀的，写脚本前先 `ls` 确认，别硬编码。

### 数据与交付
- **交付默认给在线链接，不要给本地文件**：`file://` 双击打开只能自己看，"能发出去给人玩"才算交付。链接一律走内置托管拿 `https://<id>.app.workbuddy.link`。
- ⚠️ **"浏览器打得开" ≠ "微信打得开"**：`*.app.workbuddy.link` 对含 `MicroMessenger` 的 UA 一律 403（宿主策略）。
  交付给微信场景前，先跑 `wechat_check.py`；没验过就别在回复里写"微信可打开"。见「微信生态交付」。
- ⚠️ **二维码"能解出来" ≠ "微信能扫"**：静区 3 模块、彩色前景、非整数缩放这三样都能让 cv2 解出却让微信扫不出。
  必须按「静区 4 / 纯黑 / 整数模块 / ≥300px」出图，并过一遍模拟微信压缩链路的校验。
- **双端自适应别只测 PC**：扫码打开的人几乎全在手机上。只测 PC 会漏掉小屏横向滚动、弹层被软键盘顶飞、触屏点按残留高亮等问题。必须 390×844 + 1440×900 各跑一遍。
- **微信里不要用 `confirm()/alert()/prompt()/window.open()`**：iOS 微信 WKWebView 静默返回 false，
  "清空进度"会点了完全没反应且无任何提示（本次就是这样被发现的）。一律改应用内弹层。
- 顶层 `const`（LV/cur）不在 window 上，但 page.evaluate 全局作用域可直接引用。
- 管线顺序 `merge_kb → gen_questions → build_index`，顺序错了会静默丢题（曾丢 74 道）。
- Node 拼装用 `indexOf` 截 JSON 时注意文本含换行，`JSON.parse` 前先 trim 去尾分号。
- 测试用 vm 跑 DOM 桩时，`localStorage`/`document` 必须完整 mock。
- 对外交付前**脱敏**：清除内部文档名、赛事名、项目代称。注意联动——改了源文件后，PDF、演示视频画面、PPT 里的产品截图、交付 zip 都可能残留旧文案，需逐一重新生成。
- ⚠️ **改了 Demo 的 UI 或数据口径后，PPT 里的产品截图必然过期，必须重录**（哪怕只是顶栏少了一个按钮）。血泪教训：一处"去掉顶栏音效按钮"的改动，导致 7 张路演截图同时出现三个问题——①顶栏还是旧的 4 按钮 ②数据还写着旧的「185 关 / 555 题」（实际已 247 关 / 741 题，**违反数字口径铁律**）③截图里没有新加的语音喇叭。**重录清单**：首页 / 场景页 / 学习页 / 答题页 / 星图 / 各场景反馈页，逐张与当前 UI 比对。截图脚本要能直接 `openLevel(scene, 1)` → `renderQuiz()` → `dispatchEvent(click)` 走完流程，星图页用 localStorage 注入已通关状态（否则截出来是漆黑一片，毫无说服力）。
- **多副本必须逐一比对 md5**：同一 `index.html` 常同时存在于主目录、`deploy/`（部署源）、PPT 的 `demo/`、交付包内层 `小A-项目交付/小A-路演PPT/demo/`、离线版。打包前用脚本逐对算 md5，否则会打出"外层已更新、内层还是旧版"的混合包（本次就漏了内层一处）。
- **改完源码后 `shots/*.png` 产品截图会过期**（本次移动端顶栏按钮由 4 个收为 2 个），若截图已进入 PPT/文档，严格说需重截以保持图文一致。

## 文件清单（本技能自带）

- `scripts/kb_parse.py` `kb_enrich.py` `gen_questions.py` `merge_kb.py` `build_index.py` `make_qr_poster.py` `wechat_check.py`
- `assets/app_core.js` `tts.js` `app_ui.js` `template.html` `test_harness.js`
  - `tts.js` = 语音引擎，在 `template.html` 里由 `// __TTS__` 占位符注入，`build_index.py` 负责替换。
    ⚠️ 顺序必须是 TTS 在 UI 之前（UI 依赖它做朗读调度），`build_index.py` 已内置断言。
  - ⚠️ `assets/` 里的是**通用模板**（brand 文案、首页场景标签都从 `SCENES` 生成）。具体项目落地时
    不要把这些改成写死的学科名，否则换年级/学科会残留。
  - ⚠️ **引擎文件在专家包里位于 `assets/`，而 `build_index.py` 本身在 `scripts/`**：脚本已改为
    「脚本同级优先 → 回退 `../assets/`」，两种布局（项目布局 / 专家包布局）都能跑，改这个文件时别退回单一路径。
