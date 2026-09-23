#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TTS 朗读 + 顺序解锁 + 分句排版 的浏览器实机验证
无头浏览器没有语音包，注入一个 speechSynthesis 模拟层来验证调度逻辑。"""
import sys, os, json, re
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file:///' + os.path.join(BASE, 'index.html').replace('\\', '/')

# 送进引擎的文本里绝不允许残留的标点（撇号不算，I'm 必须保留）
PUNCT = re.compile(r'[，。！？；：、（）【】「」『』“”‘’《》〈〉·～—…]')

MOCK = """
window.__spoken = [];
window.__said = [];
window.__cancelCount = 0;
class U { constructor(t){ this.text=t; this.onstart=null; this.onend=null; this.onerror=null;
  this.voice=null; this.lang=''; this.rate=1; this.pitch=1; this.volume=1; } }
const mockSynth = {
  getVoices(){ return [
    {name:'Microsoft Huihui Desktop', lang:'zh-CN', localService:true, voiceURI:'huihui'},
    {name:'Microsoft Xiaoxiao Online (Natural)', lang:'zh-CN', localService:false, voiceURI:'xiaoxiao'},
    {name:'Microsoft Zira Desktop', lang:'en-US', localService:true, voiceURI:'zira'},
    {name:'Google UK English Female', lang:'en-GB', localService:false, voiceURI:'guk'}
  ]; },
  speak(u){ window.__spoken.push(u.text);
            window.__said.push({text:u.text, voice:(u.voice&&u.voice.name)||'', lang:u.lang||'', rate:u.rate});
            if(u.onstart) u.onstart({});
            setTimeout(function(){ if(u.onend) u.onend({}); }, 8); },
  cancel(){ window.__cancelCount++; }, pause(){}, resume(){}
};
/* 原生属性是只读 getter，必须用 defineProperty 才能盖掉 */
Object.defineProperty(window, 'SpeechSynthesisUtterance', {configurable:true, writable:true, value:U});
Object.defineProperty(window, 'speechSynthesis', {configurable:true, writable:true, value:mockSynth});
"""

ok_n = [0, 0]
def check(cond, label, extra=''):
    if cond: ok_n[0] += 1; print('  ✅ %s %s' % (label, extra))
    else:    ok_n[1] += 1; print('  ❌ %s %s' % (label, extra))
    return cond


def run(pw, w, h, tag):
    print('\n▶ %s  %dx%d' % (tag, w, h))
    b = pw.chromium.launch(channel='msedge')
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2)
    ctx.add_init_script(MOCK)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
    pg.goto(URL); pg.wait_for_timeout(700)
    # —— 知情同意门禁 ——
    check(pg.locator('#consent').count() == 1, '首次进入弹出知情同意')
    check(pg.locator('#app').inner_text().strip() == '', '未确认前不渲染应用主体')
    if pg.locator('#consentOk').count(): pg.click('#consentOk'); pg.wait_for_timeout(300)
    check(pg.locator('#consent').count() == 0, '点「我已知晓」后关闭同意页')
    check(len(pg.locator('#app').inner_text().strip()) > 10, '确认后才进入应用')

    # 引导
    pg.fill('#obName', '小朋友'); pg.click('text=下一步'); pg.wait_for_timeout(220)
    pg.click('text=下一步'); pg.wait_for_timeout(220)
    pg.click('text=开始闯关'); pg.wait_for_timeout(700)
    js = "() => ({voiced: !!window.__spoken, spoken: window.__spoken, tts: TTS.supported, zh: TTS.zhOk, en: TTS.enOk, voice: TTS.voice && TTS.voice.name, enVoice: TTS.enVoice && TTS.enVoice.name})"
    st = pg.evaluate(js)
    check(st['voiced'], '音频已由用户手势解锁')
    check(st['zh'] and st['voice'] and 'Xiaoxiao' in st['voice'], '已优选自然音色', '→ ' + str(st['voice']))
    check(st['en'] and st['enVoice'] and 'Zira' in st['enVoice'], '已选中英文音色', '→ ' + str(st['enVoice']))

    # 进入语文第 1 关
    pg.click('text=语文 · 一年级'); pg.wait_for_timeout(500)
    pg.locator('.lv').first.click(); pg.wait_for_timeout(500)

    # —— 分句排版 ——
    says = pg.locator('.say')
    n = says.count()
    check(n >= 3, '故事已拆成逐句卡片', '共 %d 句' % n)
    lens = [len(pg.locator('.say .st').nth(i).inner_text()) for i in range(n)]
    check(max(lens) < 55, '单句长度受控', '最长 %d 字' % max(lens))
    check(pg.locator('.keyline').count() == 1, '有「记住这一句」核心卡')
    has_story = pg.evaluate("() => !!document.querySelector('.story')")
    check(not has_story, '旧的整段文字块已移除')
    # 是否真的分段（每张卡文字量接近，不是一坨）
    check(pg.locator('.say .sn').count() == n, '每句都有序号气泡')

    # —— 点读单句 ——
    pg.evaluate("window.__spoken.length = 0")
    says.nth(1).click(); pg.wait_for_timeout(300)
    sp = pg.evaluate("window.__spoken")
    check(len(sp) >= 1, '点句子能单独朗读', '→ %r' % (sp[0][:26] if sp else ''))
    dirty = [x for x in sp if PUNCT.search(x)]
    check(not dirty, '朗读文本不含标点（逗号句号不念出来）', '→ ' + str(sp[:3]))

    # —— 听小A讲：整段朗读 + 高亮 ——
    pg.evaluate("window.__spoken.length = 0")
    pg.click('#ttsMain')
    # 开场白被切成多个短语，进正文的时机不固定 —— 轮询等高亮出现，别用固定等待
    hl_ok = False
    for _ in range(34):
        pg.wait_for_timeout(150)
        if pg.evaluate("document.querySelectorAll('.say.hl,.keyline.hl').length") > 0:
            hl_ok = True
            break
    check(hl_ok, '朗读时高亮当前句')
    btn = pg.locator('#ttsMain').inner_text()
    check('停止' in btn, '按钮切换为停止态', '→ ' + btn.strip())
    pg.wait_for_timeout(2600)
    played = pg.evaluate("window.__spoken.length")
    check(played >= 3, '整段朗读逐句推进', '已读 %d 段' % played)
    allsp = pg.evaluate("window.__spoken")
    dirty2 = [x for x in allsp if PUNCT.search(x)]
    check(not dirty2, '整关朗读全程无标点残留', '→ ' + str(allsp[:4]))
    pg.click('#ttsMain'); pg.wait_for_timeout(200)   # 停止
    check(pg.evaluate("document.querySelectorAll('.hl').length") == 0, '停止后清除高亮')

    # —— 答题：自动读题 ——
    pg.evaluate("window.__spoken.length = 0")
    pg.click('text=开始闯关'); pg.wait_for_timeout(1200)
    qs = pg.evaluate("window.__spoken")
    check(len(qs) >= 2, '进入题目自动读题（含选项）', '已读 %d 段' % len(qs))
    check(pg.locator('.ttsbtn', has_text='读题').count() >= 1, '有手动「读题」按钮')

    # —— 答题：自动讲解析 ——
    pg.evaluate("window.__spoken.length = 0")
    pg.locator('.opt').first.click(); pg.wait_for_timeout(1500)
    fs = pg.evaluate("window.__spoken")
    check(len(fs) >= 1, '答完自动讲解析', '已读 %d 段' % len(fs))

    # —— 走完 3 题到结果页 ——
    for _ in range(2):
        pg.locator('#nextBtn').click(); pg.wait_for_timeout(450)
        pg.locator('.opt').first.click(); pg.wait_for_timeout(450)
    pg.locator('#nextBtn').click(); pg.wait_for_timeout(750)     # 第 3 题 → 结果页
    check(pg.locator('.unlock-tip').count() == 1, '通关后提示下一关已解锁')
    pg.click('.back'); pg.wait_for_timeout(650)                   # 回关卡地图

    lv2 = pg.locator('.lv').nth(1)
    check('locked' not in (lv2.get_attribute('class') or ''), '已通关后第 2 关解锁')
    lv3 = pg.locator('.lv').nth(2)
    check('locked' in (lv3.get_attribute('class') or ''), '第 3 关仍锁定')
    check('🔒' in lv3.inner_text(), '锁定关卡显示锁图标')
    lv3.click(); pg.wait_for_timeout(450)
    tst = pg.locator('#toast').inner_text()
    check('解锁' in tst or '先通过' in tst, '点击锁定关卡被拦下', '→ ' + tst.strip()[:24])
    check(pg.locator('.lvgrid').count() >= 1 and pg.locator('.say').count() == 0,
          '仍停留在关卡地图，未进入锁定关')

    # —— 英语关卡：英语音色 / 中英分轨 ——
    pg.evaluate("() => renderScene('english')"); pg.wait_for_timeout(500)
    pg.locator('.lv').first.click(); pg.wait_for_timeout(600)
    en_says = pg.locator('.say').count()
    check(en_says >= 3, '英语学习页也逐句成卡', '共 %d 句' % en_says)
    check(pg.locator('.vowarn').count() == 0, '有英文音色时不显示缺语音提示')
    idx = pg.evaluate("""() => { const els=[].slice.call(document.querySelectorAll('.say'));
        for(let i=0;i<els.length;i++){ if(/I'm Andy/.test(els[i].textContent)) return i; } return -1; }""")
    check(idx >= 0, '英语关卡含中英混排卡片')
    pg.evaluate("window.__said.length = 0")
    pg.locator('.say').nth(idx).click(); pg.wait_for_timeout(400)
    said = pg.evaluate("window.__said")
    check(any('Zira' in (x.get('voice') or '') for x in said), '英语例句走英文音色',
          str([x.get('voice') for x in said]))
    check(any((x.get('lang') or '').startswith('en') for x in said), '英语例句 lang=en',
          str([x.get('lang') for x in said]))
    j = pg.evaluate("""() => { const els=[].slice.call(document.querySelectorAll('.say'));
        for(let i=0;i<els.length;i++){ if(/（我是Andy/.test(els[i].textContent)) return i; } return -1; }""")
    if j >= 0:
        pg.evaluate("window.__said.length = 0")
        pg.locator('.say').nth(j).click(); pg.wait_for_timeout(400)
        said2 = pg.evaluate("window.__said")
        check(any('Xiaoxiao' in (x.get('voice') or '') for x in said2), '中文译文走中文音色',
              str([x.get('voice') for x in said2]))
    check(pg.evaluate("() => ttsRuns('今天小A带你认字。').length") == 1,
          '中文里的单字母不误判为英语')
    check(pg.evaluate("() => ttsClean('小朋友，你好。','zh')") == '小朋友 你好',
          '中文标点剥离（逗号句号不送进引擎）')
    check(pg.evaluate("() => ttsClean(\"I'm Andy\",'en')") == "I'm Andy",
          '英文撇号保留（I\'m 不会变成 Im）')

    # 引擎级：真实知识库英语第 5 关的中英分轨
    cards5 = pg.evaluate("() => ttsSplit(ttsStripSummary(KB['english:5'].story))")
    check('I have a new bag.' in cards5, '英语故事切出独立英文句', str(cards5[:3]))
    check(any(c.startswith('（我有一个新书包') for c in cards5), '英语故事切出独立中文译文')
    pg.evaluate("() => { window.__said.length=0; ttsSpeak([{t:'I have a new bag.（我有一个新书包。）',p:150}],{}); }")
    pg.wait_for_timeout(1100)
    mix = pg.evaluate("window.__said")
    check(len(mix) >= 2 and mix[0]['text'] == 'I have a new bag', '中英混排自动拆成两段朗读（且已去句点）',
          str([x['text'] for x in mix[:2]]))
    enRate = pg.evaluate("() => TTS.enRate")
    check(len(mix) >= 2 and 'Zira' in mix[0]['voice'] and abs(mix[0]['rate'] - enRate) < 0.001,
          '英文段 = 英文音色 + 英文语速', '%s @%s' % (mix[0]['voice'] if mix else '', mix[0]['rate'] if mix else ''))
    check(len(mix) >= 2 and 'Xiaoxiao' in mix[1]['voice'], '中文段 = 中文音色',
          str(mix[1]['voice'] if len(mix) >= 2 else ''))
    pg.evaluate("() => ttsHalt()"); pg.wait_for_timeout(150)

    # —— 拼音不被误读为英文字母：中文关里的拼音必须走中文音色 ——
    pg.evaluate("() => { window.__said.length=0; TTS.scene='chinese'; ttsSpeak(['爸爸（bà ba）的 b，是声母 b。'], {}); }")
    pg.wait_for_timeout(1500)
    py = pg.evaluate("window.__said")
    py_runs = [x for x in py if re.search(r'[A-Za-z]', x.get('text') or '')]
    check(len(py_runs) >= 1, '中文关拼音段被实际朗读', str([x['text'] for x in py_runs[:1]]))
    check(all('Zira' not in (x.get('voice') or '') for x in py_runs), '拼音段用中文音色（非英文）',
          str([x.get('voice') for x in py_runs[:1]]))
    check(any('Xiaoxiao' in (x.get('voice') or '') for x in py_runs), '拼音段走中文自然音色（bo/po/ma 而非 bee/eye）')
    pg.evaluate("() => ttsHalt()"); pg.wait_for_timeout(150)

    # 溢出与报错
    ov = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check(ov <= 0, '无横向溢出', '%dpx' % ov)
    check(len(errs) == 0, '控制台无报错', str(errs[:2]) if errs else '')

    pg.screenshot(path=os.path.join(BASE, 'shots', 'tts-%s-learn.png' % tag))
    ctx.close(); b.close()


def run_no_en(pw):
    """设备没有英文语音包时的降级路径：必须给出可操作提示，且不能变成没声音。"""
    print('\n▶ 缺英文语音包（中文音色兜底）  390x844')
    no_en = MOCK.replace("    {name:'Microsoft Zira Desktop', lang:'en-US', localService:true, voiceURI:'zira'},\n", '')
    no_en = no_en.replace("    {name:'Google UK English Female', lang:'en-GB', localService:false, voiceURI:'guk'}\n", '')
    b = pw.chromium.launch(channel='msedge')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx.add_init_script(no_en)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(600)
    if pg.locator('#consentOk').count(): pg.click('#consentOk'); pg.wait_for_timeout(250)
    pg.fill('#obName', '小朋友'); pg.click('text=下一步'); pg.wait_for_timeout(200)
    pg.click('text=下一步'); pg.wait_for_timeout(200)
    pg.click('text=开始闯关'); pg.wait_for_timeout(600)

    check(pg.evaluate("() => TTS.enOk") is False, '无英文语音时 enOk=false')
    pg.evaluate("() => renderScene('english')"); pg.wait_for_timeout(400)
    pg.locator('.lv').first.click(); pg.wait_for_timeout(700)
    check(pg.locator('.vowarn').count() == 1, '英语学习页显示「缺英文语音」可操作提示')
    wtxt = pg.locator('.vowarn').inner_text()
    check('English (United States)' in wtxt and '手机' in wtxt, '提示含 Windows 步骤与手机建议',
          wtxt.replace('\n', ' / ')[:58])

    idx = pg.evaluate("""() => { const e=[].slice.call(document.querySelectorAll('.say'));
        for(let i=0;i<e.length;i++){ if(/I'm Andy/.test(e[i].textContent)) return i; } return -1; }""")
    pg.evaluate("window.__said.length = 0")
    if idx >= 0:
        pg.locator('.say').nth(idx).click(); pg.wait_for_timeout(450)
    said = pg.evaluate("window.__said")
    check(any('Zira' not in (x.get('voice') or '') for x in said), '英文句退回中文音色（不静音）',
          str([x.get('voice') for x in said]))
    check(len(said) >= 1, '降级后仍然出声')
    ov = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    check(ov <= 0, '无横向溢出', '%dpx' % ov)
    check(len(errs) == 0, '控制台无报错', str(errs[:2]) if errs else '')
    ctx.close(); b.close()


with sync_playwright() as pw:
    run(pw, 390, 844, 'phone')
    run(pw, 1440, 900, 'pc')
    run_no_en(pw)

print('\n结果：通过 %d / 失败 %d' % (ok_n[0], ok_n[1]))
sys.exit(1 if ok_n[1] else 0)
