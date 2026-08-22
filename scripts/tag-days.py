#!/usr/bin/env python3
"""给 xinjiang-7day-north-v2.ts 每个节点行注入 day: N（按 // ── Dx ── 注释段）。"""
import re

PATH = r'D:\Apps\traveller.xinjiang-travel\src\fixtures\xinjiang-7day-north-v2.ts'
lines = open(PATH, encoding='utf-8').read().split('\n')
day = 0
out = []
node_re = re.compile(r'^\s*\{ time_block:')
for ln in lines:
    m = re.search(r'// ── D(\d)', ln)
    if m:
        day = int(m.group(1))
    if node_re.match(ln) and day > 0 and 'day:' not in ln:
        # 行尾 "}," → "}, day: N," 或 "}" → "}, day: N,"（已有 day 则跳过, 幂等）
        if ln.rstrip().endswith('},'):
            ln = ln.rstrip()[:-2] + f', day: {day}' + '},'
        elif ln.rstrip().endswith('}'):
            ln = ln.rstrip()[:-1] + f', day: {day}' + '},'
    out.append(ln)
open(PATH, 'w', encoding='utf-8', newline='\n').write('\n'.join(out))
print(f'day-tagged {sum(1 for l in out if "day:" in l)} nodes')
