#!/usr/bin/env python3
"""给北线 fixture 补 transit 桥：任何无桥相邻对之间插 transit 节点（同 Critic patch 逻辑）。"""
import re

PATH = r'D:\Apps\traveller.xinjiang-travel\src\fixtures\xinjiang-7day-north-v2.ts'
src = open(PATH, encoding='utf-8').read()
lines = src.split('\n')

BRIDGE = {'transit', 'switch'}
node_re = re.compile(r'^\s*\{ time_block:')
type_re = re.compile(r"node_type: '([a-z_]+)'")

# 收集节点行索引 + node_type
node_idx = []  # (line_idx, node_type)
for i, ln in enumerate(lines):
    if node_re.match(ln):
        m = type_re.search(ln)
        node_idx.append((i, m.group(1) if m else ''))

# 找无桥对，在后一个节点行前插入 transit
inserts = []  # (line_idx, text)
for k in range(len(node_idx) - 1):
    i_a, ta = node_idx[k]
    i_b, tb = node_idx[k + 1]
    if ta in BRIDGE or tb in BRIDGE:
        continue
    indent = '    '
    node = (f"{indent}{{ time_block: 'auto', action: '步行/区间车衔接', duration_min: 15, "
            f"node_type: 'transit', elasticity: 'non_compressible', cost: 10, "
            f"source: '攻略共识', source_trust: 0.7, state: ['in_transit'] }},")
    inserts.append((i_b, node))
    print(f'insert transit before line {i_b} ({ta} → {tb})')

# 从后往前插入，保持行号有效
inserts.sort(key=lambda x: x[0], reverse=True)
for i_b, node in inserts:
    lines.insert(i_b, node)

open(PATH, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print(f'total inserts: {len(inserts)}')
