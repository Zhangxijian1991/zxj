#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 数据(KB/SCENES/RANKS) + 核心引擎(app_core.js) + UI(app_ui.js) 拼成单文件 index.html"""
import json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))   # scripts/
ROOT = os.path.dirname(BASE)                        # 工作区根
KB = os.path.join(ROOT, 'kb')
ASSETS = os.path.join(ROOT, 'assets')               # 打包布局：引擎在 assets/


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def read_engine(name):
    """引擎文件优先取脚本同级（项目布局），回退到 assets/（专家包布局）。
    两种布局都要能跑，否则打包进技能后 build_index 直接 FileNotFoundError。"""
    for d in (BASE, ASSETS):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return read(p)
    raise FileNotFoundError('找不到 %s，已尝试：%s' % (name, [BASE, ASSETS]))


kb = read(os.path.join(KB, 'levels_all.json')).strip()
scenes = read(os.path.join(KB, 'scenes.json')).strip()
ranks = read(os.path.join(KB, 'ranks.json')).strip()
core = read_engine('app_core.js')
tts = read_engine('tts.js')
ui = read_engine('app_ui.js')
tpl = read_engine('template.html')

# 内联 JSON 里的 </script> 会提前闭合脚本标签，必须转义
def safe_js(s):
    return s.replace('</', '<\\/')


html = (tpl
        .replace('__KB__', safe_js(kb))
        .replace('__SCENES__', safe_js(scenes))
        .replace('__RANKS__', safe_js(ranks))
        .replace('// __CORE__', core)
        .replace('// __TTS__', tts)
        .replace('// __UI__', ui))

out = os.path.join(ROOT, 'index.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)

# 校验
assert '__KB__' not in html and '__CORE__' not in html and '__UI__' not in html, '占位符未替换完'
assert '__TTS__' not in html and '__SCENES__' not in html and '__RANKS__' not in html, '占位符未替换完'
assert 'function initApp' in html, 'initApp 缺失'
assert 'const KB =' in html
assert 'const TTS =' in html, '语音模块缺失'
# 语音模块必须在 UI 模块之前（UI 依赖它做朗读调度）
assert html.index('const TTS =') < html.index('function initApp'), '语音模块注入顺序错误'

# head 结构校验：属性里的 data URI 若未转义，会把 <head> 提前闭合，
# 导致 <title>/<style> 与残余文本被浏览器搬进 <body>（页面顶部出现游离字符）
head = html.split('<body')[0]
assert '<title>' in head, 'head 结构异常：<title> 不在 <head> 内'
assert html.count('<style>') == 1 and html.index('<style>') < html.index('<body'), 'head 结构异常：<style> 落入 body'
assert 'data:image/svg+xml,<' not in html, 'favicon data URI 未转义（会撑破 head）'
assert html.count('<head') == 1 and html.count('</head>') == 1, 'head 标签不成对'

# 数据可被 JS 解析校验
KB = json.loads(kb)
SC = json.loads(scenes)
RK = json.loads(ranks)

# 每个场景地图覆盖的关卡必须真实存在
missing = []
for sid, meta in SC.items():
    for m in meta['maps']:
        for n in range(m['range'][0], m['range'][1] + 1):
            if '%s:%d' % (sid, n) not in KB:
                missing.append('%s:%d' % (sid, n))
ntotal = sum(len(v['questions']) for v in KB.values())
print('index.html 生成成功  %.0f KB' % (os.path.getsize(out) / 1024))
print('   场景 %d · 关卡 %d · 题目 %d · 段位 %d' % (len(SC), len(KB), ntotal, len(RK)))
if missing:
    print('   ⚠️ 地图缺口: %s' % missing[:10])
else:
    print('   ✅ 地图 100% 覆盖，无空关')
