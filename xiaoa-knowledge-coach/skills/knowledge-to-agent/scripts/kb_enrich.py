# -*- coding: utf-8 -*-
"""知识库增强：规则化生成 alt(换一种说法) / 补全缺失解析 / 生成逐选项反馈
原则：只从源文件真实素材（one / story / examples / 题目解析）重组，绝不编造新事实。
"""
import re, json, os

BASE = os.path.dirname(os.path.abspath(__file__))
KB = os.path.join(BASE, 'kb')
SCENES = ['ai_knowledge', 'first_aid', 'stock', 'tax']

ANALOGY_PAT = re.compile(r'(就像[^。！？；]*|好比[^。！？；]*|想象[^。！？；]*|相当于[^。！？；]*|类似于[^。！？；]*)')

STOP = re.compile(r'^(什么是|什么叫|如何|怎么|怎样|为什么|哪些|哪些是)')


def clean_name(name):
    """把「什么是Token」洗成「Token」，用于自然语言拼接"""
    n = re.sub(r'（[^）]*）|\([^)]*\)', '', name).strip()
    n = STOP.sub('', n).strip()
    return n or name


def related_sentence(story, keys):
    """在 story 里找与关键词最相关的一句，用于生成有信息量的解析"""
    sents = [s.strip() for s in re.split(r'[。！？]', story) if len(s.strip()) > 8]
    best, best_score = '', 0
    for s in sents:
        score = sum(1 for k in keys if k and k in s)
        if score > best_score:
            best, best_score = s, score
    return best + '。' if best else ''


def pick_analogy(story):
    """从 story 抽取类比句（信息量最高，优先用于换一种说法）"""
    ms = ANALOGY_PAT.findall(story)
    out = []
    for m in ms:
        m = m.strip()
        if 8 <= len(m) <= 60:
            out.append(m.rstrip('，,。'))
    return out


def gen_alt(lv):
    """换一种说法：类比 > 举例 > 考题反推"""
    name = clean_name(lv['name'])
    one, story = lv['one'], lv['story']
    ex = lv.get('examples') or []
    qs = lv.get('questions') or []

    ans = pick_analogy(story)
    if ans:
        a = ans[0]
        return '换个说法：%s。%s，说白了就是这个道理。' % (a, name)

    if ex:
        e = '、'.join(ex[:2])
        return '换个说法：%s——这些你多半见过，背后其实就是%s。%s' % (e, name, one)

    if qs:
        q = qs[0]
        try:
            ci = 'ABCD'.index(q['correct'])
            ct = q['opts'][ci]
        except Exception:
            ct = q['correct']
        tail = ('。' + q['ex']) if q['ex'] else ''
        return '换个说法：记住这句话就够了——%s 里，正确答案是「%s」%s' % (q['q'].rstrip('？?'), ct, tail)

    return '换个说法：%s' % one


def fill_explanation(lv):
    """为缺解析的题目生成解析：优先引用 story 中与核心概念相关的原句"""
    story = lv['story']
    core = clean_name(lv['name'])
    for q in lv.get('questions', []):
        if q.get('ex'):
            continue
        try:
            ci = 'ABCD'.index(q['correct'])
            ct = q['opts'][ci]
        except Exception:
            continue
        keys = [core, core[:3] if len(core) > 3 else core,
                re.sub(r'[^\u4e00-\u9fa5A-Za-z0-9]', '', ct)[:4]]
        sent = related_sentence(story, keys)
        q['ex'] = ('正确答案是「%s」。%s' % (ct, sent or lv['one'])).strip()
        q['_gen'] = True
    return lv


def build_option_feedback(lv):
    """逐选项反馈：答错时针对用户所选干扰项给出解释"""
    story = lv['story']
    core = clean_name(lv['name'])
    for q in lv.get('questions', []):
        ci = 'ABCD'.index(q['correct'])
        keys = [core, core[:3] if len(core) > 3 else core]
        sent = related_sentence(story, keys) or lv['one']
        fb = []
        for i, op in enumerate(q['opts']):
            if i == ci:
                fb.append('')
            else:
                fb.append('「%s」不是答案——%s' % (op, sent))
        q['optFb'] = fb
    return lv


def main():
    stat = {'alt': 0, 'ex': 0, 'optfb': 0}
    merge = {}
    for s in SCENES:
        p = os.path.join(KB, 'levels_%s.json' % s)
        lv = json.load(open(p, encoding='utf-8'))
        for x in lv:
            if not x.get('alt'):
                x['alt'] = gen_alt(x); stat['alt'] += 1
            before = sum(1 for q in x['questions'] if not q.get('ex'))
            x = fill_explanation(x)
            stat['ex'] += before
            x = build_option_feedback(x)
            stat['optfb'] += sum(len(q['questions']) if False else len(x['questions']) for q in [x])
        merge[s] = lv
        out = os.path.join(KB, 'enriched_%s.json' % s)
        json.dump(lv, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        short = sum(1 for x in lv if len(x['questions']) < 3)
        print('%-14s %2d 关 %3d 题  生成alt %2d  补解析 %3d  (题目<3的关 %d)'
              % (s, len(lv), sum(len(x['questions']) for x in lv), len(lv), before if False else sum(1 for x in lv for q in x['questions'] if q.get('_gen')), short))
    print()
    print('alt 生成 %d 条，解析补全 %d 条，逐选项反馈 %d 条' % (stat['alt'], stat['ex'], stat['optfb']))
    # 抽样
    a = merge['ai_knowledge'][25]
    print('\n--- 抽样 ai_knowledge 第26关 ---')
    print('名称:', a['name'])
    print('alt :', a['alt'])
    for q in a['questions'][:2]:
        print('  题:', q['q'])
        print('  解析:', q['ex'], '(生成)' if q.get('_gen') else '(原文)')
        print('  干扰项反馈:', [f for f in q['optFb'] if f][:2])


if __name__ == '__main__':
    main()
