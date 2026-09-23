# -*- coding: utf-8 -*-
"""合并：新解析的 185 关 + Demo 已有的 226 关 -> levels_all.json (411 关)
统一 Schema: {scene,id,map,name,one,story,examples[],alt,source,questions[{q,opts,correct,ex,optFb[]}]}
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kb_enrich import clean_name, related_sentence

BASE = os.path.dirname(os.path.abspath(__file__))
KB = os.path.join(BASE, 'kb')
NEW = {'ai_knowledge': 'enriched_ai_knowledge.json',
       'first_aid': 'enriched_first_aid.json',
       'stock': 'enriched_stock.json',
       'tax': 'enriched_tax.json'}

scenes = json.load(open(os.path.join(KB, 'scenes.json'), encoding='utf-8'))


def map_of(scene, lid):
    for m in scenes[scene]['maps']:
        if m['range'][0] <= lid <= m['range'][1]:
            return m['id']
    return scenes[scene]['maps'][-1]['id']


def norm_questions(lv):
    """补齐 optFb / ex，确保结构一致"""
    story = lv.get('story') or ''
    core = clean_name(lv.get('name') or '')
    keys = [core, core[:3] if len(core) > 3 else core]
    sent = related_sentence(story, keys) if story else ''
    for q in lv.get('questions', []):
        ci = 'ABCD'.index(q['correct'])
        if not q.get('ex'):
            q['ex'] = ('正确答案是「%s」。%s' % (q['opts'][ci], sent or lv.get('one', ''))).strip()
        if not q.get('optFb'):
            fb = []
            for i, op in enumerate(q['opts']):
                fb.append('' if i == ci else '「%s」不是答案——%s' % (op, sent or lv.get('one', '')))
            q['optFb'] = fb
    return lv


all_lv = {}

# 1) 新解析的 185 关
for scene, fn in NEW.items():
    src = json.load(open(os.path.join(KB, fn), encoding='utf-8'))
    for x in src:
        lv = {'scene': scene, 'id': x['id'], 'map': map_of(scene, x['id']),
              'name': x['name'], 'one': x['one'], 'story': x['story'],
              'examples': x.get('examples') or [], 'alt': x.get('alt') or '',
              'source': scenes[scene].get('source', ''),
              'questions': x.get('questions') or []}
        norm_questions(lv)
        all_lv['%s:%d' % (scene, x['id'])] = lv

# 2) Demo 已有的 226 关（小学 + 初中）
exist = json.load(open(os.path.join(KB, 'existing_lv.json'), encoding='utf-8'))
for k, x in exist.items():
    x['alt'] = x.get('alt') or x.get('one', '')
    x['source'] = x.get('source') or scenes[x['scene']].get('source', '')
    norm_questions(x)
    all_lv[k] = x

out = os.path.join(KB, 'levels_all.json')
json.dump(all_lv, open(out, 'w', encoding='utf-8'), ensure_ascii=False)

print('合并完成: %d 关' % len(all_lv))
stat, qs, noex, short = {}, 0, 0, 0
for k, v in all_lv.items():
    s = v['scene']
    stat[s] = stat.get(s, 0) + 1
    qs += len(v['questions'])
    noex += sum(1 for q in v['questions'] if not q.get('ex'))
    if len(v['questions']) < 3:
        short += 1
for s in scenes:
    print('  %-14s %3d 关' % (s, stat.get(s, 0)))
print('总题数 %d，缺解析 %d，题目<3道 %d 关' % (qs, noex, short))
print('文件大小 %.0f KB' % (os.path.getsize(out) / 1024))
