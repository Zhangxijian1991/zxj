# -*- coding: utf-8 -*-
"""题目补齐：用「题型转换」为题目不足 3 道的关卡补题，目标 411 关 x 3 = 1233 题。
素材全部取自本关真实的 one / story / examples / 既有题目，
干扰项取自同场景其他关卡的真实内容 —— 有区分度，且绝不编造新事实。
"""
import json, os, re, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kb_enrich import clean_name, related_sentence

BASE = os.path.dirname(os.path.abspath(__file__))
KB = os.path.join(BASE, 'kb')
PATH = os.path.join(KB, 'levels_all.json')
random.seed(20260831)

kb = json.load(open(PATH, encoding='utf-8'))

# 按场景归拢，供干扰项取材
by_scene = {}
for k, v in kb.items():
    by_scene.setdefault(v['scene'], []).append(v)


def short(s, n=34):
    s = re.sub(r'\s+', '', str(s or ''))
    return s if len(s) <= n else s[:n] + '…'


def pick_distractors(scene, name, pool_key, need):
    """从同场景其他关卡取干扰项，优先取内容差异大的"""
    cands = [x for x in by_scene.get(scene, [])
             if x['name'] != name and x.get(pool_key)]
    out, seen = [], set()
    random.shuffle(cands)
    for x in cands:
        val = x[pool_key] if pool_key != 'examples' else (x['examples'][0] if x['examples'] else '')
        if not val:
            continue
        v = short(val, 30)
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
        if len(out) >= need:
            break
    while len(out) < need:
        out.append('以上都不是' if len(out) == need - 1 else '与本题无关')
    return out


def q_identify(lv):
    """模式A · 概念归属：哪个说法描述的是本概念"""
    core = clean_name(lv['name'])
    right = short(lv['one'], 30)
    ds = pick_distractors(lv['scene'], lv['name'], 'one', 2)
    opts = [right] + ds
    random.shuffle(opts)
    ci = opts.index(right)
    sent = related_sentence(lv.get('story') or '', [core, core[:3] if len(core) > 3 else core])
    return {'q': '下面哪个说法说的是「%s」？' % core,
            'opts': opts, 'correct': 'ABCD'[ci],
            'ex': '「%s」说的就是%s。%s' % (right, core, sent or lv['one']),
            'optFb': ['' if i == ci else '「%s」说的是另一个概念，不是%s。' % (o, core)
                      for i, o in enumerate(opts)],
            '_gen': True}


def q_example(lv):
    """模式B · 案例归属：哪个生活场景体现了本概念"""
    core = clean_name(lv['name'])
    exs = lv.get('examples') or []
    right = short(exs[0], 26) if exs else short(lv['one'], 26)
    ds = pick_distractors(lv['scene'], lv['name'], 'examples', 2)
    opts = [right] + ds
    random.shuffle(opts)
    ci = opts.index(right)
    return {'q': '下面哪个场景用到了「%s」？' % core,
            'opts': opts, 'correct': 'ABCD'[ci],
            'ex': '「%s」正是%s在生活中的样子。%s' % (right, core, short(lv['one'], 40)),
            'optFb': ['' if i == ci else '「%s」不属于%s的典型场景。' % (o, core)
                      for i, o in enumerate(opts)],
            '_gen': True}


def q_reverse(lv):
    """模式C · 反向判断：哪个说法是错的"""
    core = clean_name(lv['name'])
    wrong = '把%s理解成完全相反的东西' % core
    truths = pick_distractors(lv['scene'], lv['name'], 'one', 2)
    opts = [wrong] + truths
    random.shuffle(opts)
    ci = opts.index(wrong)
    return {'q': '关于「%s」，下面哪个说法是错的？' % core,
            'opts': opts, 'correct': 'ABCD'[ci],
            'ex': '「%s」才是错的——%s' % (wrong, short(lv['one'], 40)),
            'optFb': ['' if i == ci else '「%s」这个说法本身是对的，所以不是答案。' % o
                      for i, o in enumerate(opts)],
            '_gen': True}


GEN = [q_identify, q_example, q_reverse]
added = 0
detail = []
for k in sorted(kb.keys(), key=lambda x: (x.split(':')[0], int(x.split(':')[1]))):
    lv = kb[k]
    need = 3 - len(lv['questions'])
    if need <= 0:
        continue
    used = 0
    for i in range(need):
        fn = GEN[i % len(GEN)]
        try:
            q = fn(lv)
        except Exception:
            q = q_identify(lv)
        # 避免与本关已有题干重复
        if any(q['q'] == o['q'] for o in lv['questions']):
            q = q_reverse(lv) if fn != q_reverse else q_identify(lv)
        lv['questions'].append(q)
        added += 1
        used += 1
    detail.append((k, lv['name'], used))

total = sum(len(v['questions']) for v in kb.values())
short_left = sum(1 for v in kb.values() if len(v['questions']) < 3)
json.dump(kb, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False)

print('补齐题目 %d 道，参与关卡 %d 个' % (added, len(detail)))
print('总题数 %d / 目标 1233   仍不足3题的关 %d 个' % (total, short_left))
print()
print('抽样：')
for k, nm, u in detail[:3] + [d for d in detail if '46' == d[0].split(':')[1]][:1]:
    lv = kb[k]
    print('  [%s] %s  补 %d 题' % (k, nm, u))
    for q in lv['questions']:
        mark = '  *新' if q.get('_gen') else '    '
        print('%s %s' % (mark, q['q']))
        print('        %s' % ' / '.join('%s.%s' % ('ABCD'[i], o) for i, o in enumerate(q['opts'])))
