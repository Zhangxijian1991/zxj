# 小A · 一年级闯关乐园

本仓库包含两部分内容。

## 一、在线闯关 H5（根目录 `index.html`）

单文件、可离线运行的闯关式学习 demo，用浏览器直接打开即可。

- 学科：语文 / 数学 / 英语（一年级）
- 玩法：逐关答题，通过当前关才解锁下一关
- 语音：内置 AI 朗读（浏览器原生 Web Speech API，零成本、可离线）。中文按标点断开、不读标点；英语长句自动切英文音色；语文拼音字母按拼音读，不会被当成英文字母
- 自适应：手机（≤380px 小屏）与 PC（≥1440px）双端适配
- 合规：首次进入有知情同意门禁，提示内容由 AI 生成、注意用眼与防沉迷
- 在线地址（启用 GitHub Pages 后生效）：<https://zhangxijian1991.github.io/zxj/>

> 内容由 AI 生成，仅用于学习演示。

## 二、「小A · 知识闯关教练」专家技能包（`xiaoa-knowledge-coach/`）

把任意知识库（HTML / Markdown / JSON）转换成单文件闯关 H5 的完整技能包。

```
.codebuddy-plugin/plugin.json     插件定义
agents/xiaoa-knowledge-coach.md   专家角色定义
skills/knowledge-to-agent/
  SKILL.md                        技能说明（工作流与硬约束）
  assets/   tts.js  app_core.js  app_ui.js  template.html  test_harness.js
  scripts/  build_index.py  kb_parse.py  kb_enrich.py  merge_kb.py
            make_qr_poster.py  tts_check.py  wechat_check.py
```

能力要点：

- **知识库 → H5**：`build_index.py` 把知识库与引擎打包成单个 `index.html`，产出可直接分发
- **语音引擎 `tts.js`**：语言感知路由（中文 / 英文 / 拼音各归正确音色）+ 标点清洗 + 长句换气停顿
- **交付门禁**：在线链接公开性体检、微信内置浏览器可打开性体检（`wechat_check.py`）、二维码海报、离线单文件
- **自测**：`node assets/test_harness.js` 应 24/24 通过
