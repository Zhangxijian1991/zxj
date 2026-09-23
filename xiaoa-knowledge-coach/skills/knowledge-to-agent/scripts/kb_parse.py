# -*- coding: utf-8 -*-
"""解析「小A」四份知识库 HTML 源文件 -> 统一 Schema 的 JSON
输出: kb/levels_<scene>.json
Schema: {scene, id, name, one, story, examples:[], questions:[{q, opts:[], correct:'A', ex}]}
"""
import re, json, os, sys

KB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kb')
OUT_DIR = KB_DIR

FILES = {
    'ai_knowledge': 'AI知识.html',
    'first_aid':    '急救知识.html',
    'stock':        '股市知识.html',
    'tax':          '税法知识.html',
}
CLAIM = {'ai_knowledge': 70, 'first_aid': 25, 'stock': 50, 'tax': 40}


def to_text(path):
    h = open(path, encoding='utf-8').read()
    h = re.sub(r'<script[\s\S]*?</script>', '', h)
    h = re.sub(r'<style[\s\S]*?</style>', '', h)
    h = h.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    t = re.sub(r'<[^>]+>', '\n', h)
    t = t.replace('\u3000', ' ')
    lines = [l.strip() for l in t.split('\n')]
    return [l for l in lines if l]


def split_levels(lines):
    """按关卡起始标记切分。返回 [(level_no, [lines...]), ...]"""
    idx = []
    for i, l in enumerate(lines):
        if re.fullmatch(r'第?\s*\d+\s*关?', l):
            n = int(re.search(r'\d+', l).group())
            idx.append((i, n))
    # 只保留递增序列的起点（避免目录里的"第1-15关"之类）
    keeps = []
    for i, n in idx:
        if not keeps:
            keeps.append((i, n)); continue
        pi, pn = keeps[-1]
        if n == pn + 1 and i > pi:
            keeps.append((i, n))
        elif n == 1 and i > pi:
            keeps.append((i, n))
    blocks = []
    for j, (i, n) in enumerate(keeps):
        end = keeps[j + 1][0] if j + 1 < len(keeps) else len(lines)
        blocks.append((n, lines[i + 1:end]))
    return blocks


def parse_questions(lines):
    """解析题目区：返回 [{q, opts, correct, ex}]"""
    qs = []
    cur = None
    for l in lines:
        m = re.match(r'^(\d+)[.、]\s*(.+)$', l)
        if m:
            if cur:
                qs.append(cur)
            body = m.group(2).strip()
            # 题干与首个选项常挤在同一行，需拆分：题干进 q，选项部分进 raw
            mm = re.search(r'(?:^|\s)([A-D])[.、]', body)
            if mm:
                st = mm.start()
                if body[st] in ' \t':
                    st += 1
                qtext = body[:st].strip()
                inline = body[st:]
            else:
                qtext, inline = body, ''
            cur = {'q': qtext, 'raw': inline}
            continue
        if cur is not None:
            cur['raw'] += ' ' + l
    if cur:
        qs.append(cur)

    out = []
    for it in qs:
        raw = it['raw'].strip()
        m = re.search(r'解析[：:]([\s\S]*)$', raw)
        ex = m.group(1).strip() if m else ''
        body = raw[:m.start()] if m else raw
        body = re.sub(r'\s+', ' ', body)

        # 切出选项：A. B. C. D.
        parts = re.split(r'(?:^|\s)([A-D])[.、]\s*', ' ' + body)
        opts, letters = [], []
        for k in range(1, len(parts) - 1, 2):
            letters.append(parts[k])
            opts.append(parts[k + 1].strip())

        # 同一字母重复出现时保留带 ✓ 的那个（源文件排版错位）
        if len(letters) != len(set(letters)):
            merged = {}
            for lt, op in zip(letters, opts):
                if lt not in merged or ('✓' in op and '✓' not in merged[lt]):
                    merged[lt] = op
            letters = list(merged.keys())
            opts = [merged[x] for x in letters]

        # 清理 ✓ 标记并定位正确项
        correct = None
        clean = []
        for lt, op in zip(letters, opts):
            if '✓' in op:
                correct = lt
            op = op.replace('✓', '').replace('√', '').strip()
            op = re.sub(r'[→>]\s*$', '', op).strip()
            clean.append(op)

        if correct is None or len(clean) < 2:
            continue
        out.append({'q': it['q'], 'opts': clean, 'correct': correct, 'ex': ex})
    return out


def parse_level(lines):
    name, one, story, examples = '', '', '', []
    qstart = len(lines)
    for i, l in enumerate(lines):
        if re.match(r'^\d+[.、]\s*\S', l):
            qstart = i
            break
    head = lines[:qstart]

    skip_next = False
    for i, l in enumerate(head):
        if skip_next:
            skip_next = False
            continue
        if l.startswith('一句话解释'):
            if i + 1 < len(head):
                one = head[i + 1]
                skip_next = True
            continue
        if l.startswith('⭐') or re.fullmatch(r'[⭐★]+\s*\S*', l):
            continue
        if not name:
            name = l
        elif '·' in l and len(l) < 60:
            examples = [x.strip() for x in l.split('·') if x.strip()]
        elif len(l) > 25:
            story = (story + ' ' + l).strip()
    return name, one, story, examples, parse_questions(lines[qstart:])


def main():
    total = {}
    for scene, fn in FILES.items():
        path = os.path.join(KB_DIR, fn)
        lines = to_text(path)
        blocks = split_levels(lines)
        levels, bad = [], []
        for n, bl in blocks:
            name, one, story, ex, qs = parse_level(bl)
            if not name or len(qs) < 3 or not one:
                bad.append((n, name, len(qs)))
            levels.append({'scene': scene, 'id': n, 'name': name, 'one': one,
                           'story': story, 'examples': ex, 'questions': qs})
        total[scene] = {'claim': CLAIM[scene], 'parsed': len(levels), 'bad': bad,
                        'qsum': sum(len(l['questions']) for l in levels)}
        out = os.path.join(OUT_DIR, 'levels_%s.json' % scene)
        json.dump(levels, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('%-14s 解析 %2d/%2d 关  题目 %3d  异常 %s' %
              (scene, len(levels), CLAIM[scene], total[scene]['qsum'], bad if bad else '无'))
    print('\n合计: %d 关 / %d 题' % (sum(v['parsed'] for v in total.values()),
                                     sum(v['qsum'] for v in total.values())))


if __name__ == '__main__':
    main()
